/**
 * HTTP API (White Paper §39). Explicit operations only — clients never overwrite financial state.
 *
 *   GET  /v1/health                    service and API version
 *   POST /v1/installations             register an anonymous installation (§24.5); retry-safe
 *   POST /v1/sync/push        [auth]   submit pending operations, one result per operation
 *   GET  /v1/sync/state       [auth]   server balance / position for reconciliation (§25.4)
 *   GET  /v1/sync/pull        [auth]   transactions after a sequence number
 *   GET  /v1/pricing          [auth]   active pricing configuration (§27)
 *   POST /v1/pricing/quote    [auth]   token cost of a simulation, with its pricing snapshot
 *   GET  /v1/wallet           [auth]   token balances by category and recent ledger (§28)
 *
 * Authentication: each installation creates a random secret on the device and registers it; the server
 * stores only its SHA-256 hash. Requests send `Authorization: Bearer <secret>`.
 * Errors are structured: { error: { code, message } } (§39.3).
 */
import 'reflect-metadata';
import { createHash, timingSafeEqual } from 'node:crypto';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Module,
  Post,
  Query,
  Req,
  UseGuards,
  type CanActivate,
  type DynamicModule,
  type ExecutionContext,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { SYNC_API_VERSION, type SyncOperation, type SyncPushRequest } from '@paspesa/core';
import type { Database } from './database.js';
import { MonetizationError, MonetizationService } from './monetization.service.js';
import { SyncService } from './sync.service.js';

export const DATABASE = Symbol('DATABASE');
const MAX_OPERATIONS = 200;

const fail = (status: HttpStatus, code: string, message: string) => new HttpException({ error: { code, message } }, status);
const hash = (secret: string) => createHash('sha256').update(secret).digest('hex');

interface AuthedRequest {
  headers: Record<string, string | string[] | undefined>;
  installationId?: string;
}

@Injectable()
class InstallationAuthGuard implements CanActivate {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;
    const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) throw fail(HttpStatus.UNAUTHORIZED, 'UNAUTHORIZED', 'Missing installation token');
    const [row] = await this.db.query<{ id: string }>('SELECT id FROM installations WHERE token_hash = $1', [hash(token)]);
    if (!row) throw fail(HttpStatus.UNAUTHORIZED, 'UNAUTHORIZED', 'Unknown installation token');
    req.installationId = row.id;
    await this.db.query('UPDATE installations SET last_seen_at = now() WHERE id = $1', [row.id]);
    return true;
  }
}

@Controller('v1')
class HealthController {
  @Get('health')
  health() {
    return { ok: true, service: 'paspesa-backend', apiVersion: SYNC_API_VERSION };
  }
}

@Controller('v1/installations')
class InstallationsController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Idempotent: re-registering with the same secret succeeds; a different secret is refused. */
  @Post()
  @HttpCode(200)
  async register(@Body() body: { installationId?: unknown; token?: unknown }) {
    const { installationId, token } = body ?? {};
    if (typeof installationId !== 'string' || !/^[A-Za-z0-9-]{8,100}$/.test(installationId)) {
      throw fail(HttpStatus.BAD_REQUEST, 'VALIDATION', 'installationId is invalid');
    }
    if (typeof token !== 'string' || token.length < 32 || token.length > 200) throw fail(HttpStatus.BAD_REQUEST, 'VALIDATION', 'token is invalid');
    const tokenHash = hash(token);
    await this.db.query('INSERT INTO installations (id, token_hash) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING', [installationId, tokenHash]);
    const [row] = await this.db.query<{ token_hash: string }>('SELECT token_hash FROM installations WHERE id = $1', [installationId]);
    if (!row || !timingSafeEqual(Buffer.from(row.token_hash), Buffer.from(tokenHash))) {
      throw fail(HttpStatus.CONFLICT, 'ALREADY_REGISTERED', 'This installation is registered with another token');
    }
    return { installationId, apiVersion: SYNC_API_VERSION };
  }
}

@Controller('v1/sync')
@UseGuards(InstallationAuthGuard)
class SyncController {
  constructor(@Inject(SyncService) private readonly sync: SyncService) {}

  @Post('push')
  @HttpCode(200)
  async push(@Req() req: AuthedRequest, @Body() body: SyncPushRequest) {
    if (!body || body.apiVersion !== SYNC_API_VERSION) throw fail(HttpStatus.BAD_REQUEST, 'UNSUPPORTED_VERSION', `API version ${SYNC_API_VERSION} is required`);
    if (body.installationId !== req.installationId) throw fail(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'Operations belong to another installation');
    if (!Array.isArray(body.operations) || body.operations.length > MAX_OPERATIONS) {
      throw fail(HttpStatus.BAD_REQUEST, 'VALIDATION', `Send between 0 and ${MAX_OPERATIONS} operations`);
    }
    const ops = body.operations as SyncOperation[];
    for (const op of ops) {
      const known = ['ACCOUNT', 'TRANSACTION', 'FAVOURITE'].includes(op?.entityType)
        && ['CREATE_ACCOUNT', 'CREATE_SIMULATION', 'UPDATE_ACCOUNT_SETTINGS', 'UPSERT_FAVOURITE', 'DELETE_FAVOURITE'].includes(op?.operationType);
      if (!known || typeof op.operationId !== 'string' || !op.operationId || op.operationId.length > 100 || typeof op.payloadVersion !== 'number') {
        throw fail(HttpStatus.BAD_REQUEST, 'VALIDATION', 'Every operation needs an operationId, a known type and a payloadVersion');
      }
    }
    return this.sync.push(req.installationId!, ops);
  }

  @Get('state')
  async state(@Req() req: AuthedRequest) {
    return { server: await this.sync.state(req.installationId!) };
  }

  @Get('pull')
  async pull(@Req() req: AuthedRequest, @Query('afterSequence') after?: string) {
    const afterSequence = after === undefined ? 0 : Number(after);
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) throw fail(HttpStatus.BAD_REQUEST, 'VALIDATION', 'afterSequence must be a whole number');
    return this.sync.pull(req.installationId!, afterSequence);
  }
}

const SIMULATION_TYPES = ['RECHARGE', 'SEND_MONEY', 'POCHI', 'BUY_GOODS', 'PAYBILL', 'WITHDRAW', 'AIRTIME'] as const;

/**
 * Monetization, read-only for clients (§26–28). Pricing and wallet changes are server-side only
 * (admin CLI now, admin back office later); simulations stay free until activation.
 */
@Controller('v1')
@UseGuards(InstallationAuthGuard)
class MonetizationController {
  constructor(
    @Inject(MonetizationService) private readonly money: MonetizationService,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  private async accountId(installationId: string): Promise<string> {
    const [a] = await this.db.query<{ id: string }>('SELECT id FROM accounts WHERE installation_id = $1', [installationId]);
    if (!a) throw fail(HttpStatus.NOT_FOUND, 'NO_ACCOUNT', 'The account has not been synchronized yet');
    return a.id;
  }

  /** The active pricing configuration (devices keep it for offline pricing, §27.6). */
  @Get('pricing')
  async pricing() {
    return this.money.pricing();
  }

  @Post('pricing/quote')
  @HttpCode(200)
  async quote(@Req() req: AuthedRequest, @Body() body: { type?: unknown; amount?: unknown }) {
    if (!SIMULATION_TYPES.includes(body?.type as (typeof SIMULATION_TYPES)[number])) throw fail(HttpStatus.BAD_REQUEST, 'VALIDATION', 'Unknown transaction type');
    if (typeof body.amount !== 'number' || !Number.isSafeInteger(body.amount) || body.amount < 0) throw fail(HttpStatus.BAD_REQUEST, 'VALIDATION', 'amount must be whole shillings');
    try {
      return await this.money.quote(await this.accountId(req.installationId!), body.type as (typeof SIMULATION_TYPES)[number], body.amount);
    } catch (e) {
      if (e instanceof MonetizationError) throw fail(HttpStatus.UNPROCESSABLE_ENTITY, e.code, e.message);
      throw e;
    }
  }

  @Get('wallet')
  async wallet(@Req() req: AuthedRequest) {
    return this.money.wallet(await this.accountId(req.installationId!));
  }
}

@Module({})
class AppModule {
  static with(db: Database): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController, InstallationsController, SyncController, MonetizationController],
      providers: [
        { provide: DATABASE, useValue: db },
        { provide: SyncService, useFactory: () => new SyncService(db) },
        { provide: MonetizationService, useFactory: () => new MonetizationService(db) },
        InstallationAuthGuard,
      ],
    };
  }
}

/** Builds the Nest application around an opened database (used by main.ts and the tests). */
export async function createApp(db: Database) {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.with(db), { logger: ['error', 'warn', 'log'], bodyParser: true });
  app.enableCors(); // the web build (another origin) talks to the API too
  app.useBodyParser('json', { limit: '2mb' });
  return app;
}
