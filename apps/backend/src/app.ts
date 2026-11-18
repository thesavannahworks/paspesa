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
 *   GET  /v1/allocations/current  [auth]  this device's token allocation (§29)
 *   POST /v1/allocations          [auth]  set aside N more tokens on this device for offline use
 *   POST /v1/allocations/renew    [auth]  refresh the offline authorization (every sync also does this)
 *   POST /v1/allocations/release  [auth]  return unused tokens (only once the device is fully synced)
 *   GET  /v1/payments         [auth]   this account's payments (purchase history)
 *   POST /v1/payments/simulation [auth] pay one simulation directly (STK for its token cost in KSh, §32)
 *   POST /v1/payments/tokens  [auth]   buy tokens: STK prompt for KSh N → N tokens once verified (§31)
 *   GET  /v1/payments/:id     [auth]   payment status (re-checked with the provider while pending)
 *   GET  /v1/payments/providers [auth] payment providers switched on (Daraja, Kopo Kopo, IntaSend, Paystack, PayHero)
 *   POST /v1/payments/:provider/callback   result notice (Daraja: mpesa/callback): only triggers a verification
 *
 *   POST /v1/auth/code        [auth]   email a 6-digit sign-in code
 *   POST /v1/auth/verify      [auth]   check the code: signs this device in (moves the account here)
 *   GET  /v1/auth/me          [auth]   signed in? signed out by a sign-in on another device?
 *   POST /v1/auth/sign-out    [auth]   this device signs out (after uploading what it has)
 *   GET  /v1/account/restore  [auth]   the account's transactions, messages and favourites (new device)
 *
 * Back office (§34–35): server-rendered pages at /admin, administrator login — see src/admin/.
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
  Param,
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
import { AllocationService } from './allocation.service.js';
import { MonetizationError, MonetizationService, type PaymentProvider } from './monetization.service.js';
import { providerRegistry, type CallbackAware, type PaymentProviders } from './providers.js';
import { SyncService } from './sync.service.js';
import { SignInError, SignInService } from './signin.service.js';
import { mailerFromEnv, type Mailer } from './mailer.js';
import { ADMIN_DATABASE, ADMIN_PROVIDERS, AdminController } from './admin/admin.controller.js';

export const DATABASE = Symbol('DATABASE');
export const PAYMENT_PROVIDERS = Symbol('PAYMENT_PROVIDERS');
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
  async register(@Body() body: { installationId?: unknown; token?: unknown; platform?: unknown; label?: unknown }) {
    const { installationId, token } = body ?? {};
    if (typeof installationId !== 'string' || !/^[A-Za-z0-9-]{8,100}$/.test(installationId)) {
      throw fail(HttpStatus.BAD_REQUEST, 'VALIDATION', 'installationId is invalid');
    }
    if (typeof token !== 'string' || token.length < 32 || token.length > 200) throw fail(HttpStatus.BAD_REQUEST, 'VALIDATION', 'token is invalid');
    const tokenHash = hash(token);
    const platform = typeof body.platform === 'string' ? body.platform.slice(0, 20) : null;
    const label = typeof body.label === 'string' ? body.label.slice(0, 80) : null;
    await this.db.query('INSERT INTO installations (id, token_hash, platform, label) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING', [installationId, tokenHash, platform, label]);
    const [row] = await this.db.query<{ token_hash: string }>('SELECT token_hash FROM installations WHERE id = $1', [installationId]);
    if (!row || !timingSafeEqual(Buffer.from(row.token_hash), Buffer.from(tokenHash))) {
      throw fail(HttpStatus.CONFLICT, 'ALREADY_REGISTERED', 'This installation is registered with another token');
    }
    return { installationId, apiVersion: SYNC_API_VERSION };
  }
}

const SIGN_IN_STATUS: Record<SignInError['code'], HttpStatus> = {
  VALIDATION: HttpStatus.BAD_REQUEST,
  WRONG_CODE: HttpStatus.UNAUTHORIZED,
  CODE_EXPIRED: HttpStatus.GONE,
  TOO_MANY: HttpStatus.TOO_MANY_REQUESTS,
  ACCOUNT_CONFLICT: HttpStatus.CONFLICT,
  NOT_SIGNED_IN: HttpStatus.UNAUTHORIZED,
  NOT_ACTIVE_DEVICE: HttpStatus.FORBIDDEN,
};
const signInFail = (e: unknown) => {
  if (e instanceof SignInError) return fail(SIGN_IN_STATUS[e.code], e.code, e.message);
  return e;
};

@Controller('v1')
@UseGuards(InstallationAuthGuard)
class SignInController {
  constructor(@Inject(SignInService) private readonly signIn: SignInService) {}

  @Post('auth/code')
  @HttpCode(200)
  async code(@Req() req: AuthedRequest, @Body() body: { email?: unknown }) {
    try {
      return await this.signIn.requestCode(String(body?.email ?? ''), req.installationId!);
    } catch (e) {
      throw signInFail(e);
    }
  }

  @Post('auth/verify')
  @HttpCode(200)
  async verify(@Req() req: AuthedRequest, @Body() body: { email?: unknown; code?: unknown; replaceLocalAccount?: unknown }) {
    try {
      return await this.signIn.verifyCode(String(body?.email ?? ''), String(body?.code ?? ''), req.installationId!, body?.replaceLocalAccount === true);
    } catch (e) {
      throw signInFail(e);
    }
  }

  @Get('auth/me')
  me(@Req() req: AuthedRequest) {
    return this.signIn.status(req.installationId!);
  }

  @Post('auth/sign-out')
  @HttpCode(200)
  async signOut(@Req() req: AuthedRequest) {
    await this.signIn.signOut(req.installationId!);
    return { signedOut: true };
  }

  @Get('account/restore')
  async restore(@Req() req: AuthedRequest) {
    try {
      return await this.signIn.snapshot(req.installationId!);
    } catch (e) {
      throw signInFail(e);
    }
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

  /** Server position, plus review items a reviewer has settled since (the device updates its copies). */
  @Get('state')
  async state(@Req() req: AuthedRequest) {
    return { server: await this.sync.state(req.installationId!), reviewed: await this.sync.reviewOutcomes(req.installationId!) };
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

  /** The active pricing configuration and back-office settings (devices keep them for offline use, §27.6). */
  @Get('pricing')
  async pricing() {
    return { ...(await this.money.pricing()), settings: await this.money.settings() };
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

const moneyError = (e: unknown): never => {
  if (e instanceof MonetizationError) {
    throw fail(e.code === 'NOT_FOUND' ? HttpStatus.NOT_FOUND : HttpStatus.UNPROCESSABLE_ENTITY, e.code, e.message);
  }
  throw e;
};

@Controller('v1/allocations')
@UseGuards(InstallationAuthGuard)
class AllocationsController {
  constructor(@Inject(AllocationService) private readonly allocations: AllocationService) {}

  private async run<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (e) {
      return moneyError(e);
    }
  }

  @Get('current')
  async current(@Req() req: AuthedRequest) {
    return { allocation: await this.allocations.current(req.installationId!) };
  }

  @Post()
  @HttpCode(200)
  async allocate(@Req() req: AuthedRequest, @Body() body: { quantity?: unknown }) {
    if (typeof body?.quantity !== 'number') throw fail(HttpStatus.BAD_REQUEST, 'VALIDATION', 'quantity is required');
    return { allocation: await this.run(() => this.allocations.allocate(req.installationId!, body.quantity as number)) };
  }

  @Post('renew')
  @HttpCode(200)
  async renew(@Req() req: AuthedRequest) {
    return { allocation: await this.allocations.renew(req.installationId!) };
  }

  @Post('release')
  @HttpCode(200)
  async release(@Req() req: AuthedRequest, @Body() body: { deviceRemaining?: unknown }) {
    if (typeof body?.deviceRemaining !== 'number') throw fail(HttpStatus.BAD_REQUEST, 'VALIDATION', 'deviceRemaining is required');
    return this.run(() => this.allocations.release(req.installationId!, body.deviceRemaining as number));
  }
}

@Controller('v1/payments')
class PaymentsController {
  constructor(
    @Inject(MonetizationService) private readonly money: MonetizationService,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(PAYMENT_PROVIDERS) private readonly providers: PaymentProviders,
  ) {}

  private pick(name: unknown): PaymentProvider {
    if (name !== undefined && typeof name !== 'string') throw fail(HttpStatus.BAD_REQUEST, 'VALIDATION', 'provider must be a name');
    const provider = name ? this.providers.byName(name) : this.providers.default;
    if (!provider) {
      throw name
        ? fail(HttpStatus.BAD_REQUEST, 'PROVIDER_NOT_CONFIGURED', `Payment provider "${name}" is not set up on this server`)
        : fail(HttpStatus.SERVICE_UNAVAILABLE, 'PAYMENTS_NOT_CONFIGURED', 'Payments are not set up on this server yet');
    }
    return provider;
  }

  private async accountId(installationId: string): Promise<string> {
    const [a] = await this.db.query<{ id: string }>('SELECT id FROM accounts WHERE installation_id = $1', [installationId]);
    if (!a) throw fail(HttpStatus.NOT_FOUND, 'NO_ACCOUNT', 'The account has not been synchronized yet');
    return a.id;
  }

  @Get()
  @UseGuards(InstallationAuthGuard)
  async history(@Req() req: AuthedRequest) {
    return { payments: await this.money.payments(await this.accountId(req.installationId!)) };
  }

  /** Pay-per-simulation: the price is computed here from pricing; the simulation ID is the journey's operation ID. */
  @Post('simulation')
  @HttpCode(200)
  @UseGuards(InstallationAuthGuard)
  async paySimulation(
    @Req() req: AuthedRequest,
    @Body() body: { simulationId?: unknown; type?: unknown; amount?: unknown; phone?: unknown; idempotencyKey?: unknown; provider?: unknown },
  ) {
    if (typeof body?.simulationId !== 'string' || !SIMULATION_TYPES.includes(body.type as (typeof SIMULATION_TYPES)[number]) || typeof body.amount !== 'number'
      || typeof body.phone !== 'string' || typeof body.idempotencyKey !== 'string' || body.idempotencyKey.length < 8 || body.idempotencyKey.length > 100) {
      throw fail(HttpStatus.BAD_REQUEST, 'VALIDATION', 'simulationId, type, amount, phone and idempotencyKey are required');
    }
    const provider = this.pick(body.provider);
    const accountId = await this.accountId(req.installationId!);
    try {
      return await this.money.initiateDirectPayment({
        accountId, simulationId: body.simulationId, type: body.type as (typeof SIMULATION_TYPES)[number], simulationAmount: body.amount, phone: body.phone, idempotencyKey: body.idempotencyKey,
      }, provider);
    } catch (e) {
      if (e instanceof MonetizationError) return moneyError(e);
      throw fail(HttpStatus.BAD_GATEWAY, 'PROVIDER_ERROR', e instanceof Error ? e.message : 'Payment provider error');
    }
  }

  /** Which providers are switched on (to compare them while choosing). */
  @Get('providers')
  @UseGuards(InstallationAuthGuard)
  list() {
    return { providers: this.providers.all.map((p) => p.name), default: this.providers.default?.name ?? null };
  }

  @Post('tokens')
  @HttpCode(200)
  @UseGuards(InstallationAuthGuard)
  async buyTokens(@Req() req: AuthedRequest, @Body() body: { shillings?: unknown; phone?: unknown; idempotencyKey?: unknown; provider?: unknown }) {
    if (typeof body?.shillings !== 'number' || typeof body.phone !== 'string' || typeof body.idempotencyKey !== 'string' || body.idempotencyKey.length < 8 || body.idempotencyKey.length > 100) {
      throw fail(HttpStatus.BAD_REQUEST, 'VALIDATION', 'shillings, phone and idempotencyKey are required');
    }
    const provider = this.pick(body.provider);
    const accountId = await this.accountId(req.installationId!);
    try {
      return await this.money.initiateTokenPurchase({ accountId, shillings: body.shillings, phone: body.phone, idempotencyKey: body.idempotencyKey }, provider);
    } catch (e) {
      if (e instanceof MonetizationError) return moneyError(e);
      // The provider refused or could not be reached: the payment stays INITIATED and can be retried.
      throw fail(HttpStatus.BAD_GATEWAY, 'PROVIDER_ERROR', e instanceof Error ? e.message : 'Payment provider error');
    }
  }

  @Get(':id')
  @UseGuards(InstallationAuthGuard)
  async status(@Req() req: AuthedRequest, @Param('id') id: string) {
    const payment = await this.money.payment(await this.accountId(req.installationId!), id);
    if (!payment) throw fail(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Payment not found');
    const provider = this.providers.byName(payment.provider);
    return payment.status === 'PENDING' && provider ? this.money.verifyPayment(payment.id, provider) : payment;
  }

  /**
   * Provider result notices (Daraja keeps its own path, mpesa/callback). The body is never trusted: it only
   * tells us which payment to re-check with the provider's API (§31).
   */
  @Post(':provider/callback')
  @HttpCode(200)
  async callback(@Param('provider') name: string, @Body() body: unknown) {
    const provider = this.providers.byName(name === 'mpesa' ? 'mpesa-daraja' : name);
    const ref = provider && 'callbackReference' in provider ? (provider as PaymentProvider & CallbackAware).callbackReference(body) : null;
    if (provider && ref) {
      const payment = ref.providerReference
        ? await this.money.paymentByProviderReference(provider.name, ref.providerReference)
        : await this.money.paymentForProvider(provider.name, ref.paymentId!);
      if (payment) await this.money.verifyPayment(payment.id, provider).catch(() => undefined);
    }
    return name === 'mpesa' ? { ResultCode: 0, ResultDesc: 'Accepted' } : { received: true };
  }
}

@Module({})
class AppModule {
  static with(db: Database, providers: PaymentProviders, mailer: Mailer): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController, InstallationsController, SyncController, MonetizationController, AllocationsController, PaymentsController, SignInController, AdminController],
      providers: [
        { provide: DATABASE, useValue: db },
        { provide: PAYMENT_PROVIDERS, useValue: providers },
        { provide: ADMIN_DATABASE, useValue: db },
        { provide: ADMIN_PROVIDERS, useValue: providers },
        { provide: SignInService, useFactory: () => new SignInService(db, mailer) },
        { provide: MonetizationService, useFactory: () => new MonetizationService(db) },
        { provide: AllocationService, useFactory: (money: MonetizationService) => new AllocationService(db, money), inject: [MonetizationService] },
        {
          provide: SyncService,
          useFactory: (money: MonetizationService, allocations: AllocationService) => new SyncService(db, undefined, money, allocations),
          inject: [MonetizationService, AllocationService],
        },
        InstallationAuthGuard,
      ],
    };
  }
}

/** Builds the Nest application around an opened database (used by main.ts and the tests). */
export async function createApp(db: Database, options: { paymentProvider?: PaymentProvider | null; paymentProviders?: PaymentProviders; mailer?: Mailer } = {}) {
  const providers = options.paymentProviders ?? providerRegistry(options.paymentProvider ? [options.paymentProvider] : []);
  const app = await NestFactory.create<NestExpressApplication>(AppModule.with(db, providers, options.mailer ?? mailerFromEnv(process.env)), { logger: ['error', 'warn', 'log'], bodyParser: true });
  app.enableCors(); // the web build (another origin) talks to the API too
  app.useBodyParser('json', { limit: '2mb' });
  app.useBodyParser('urlencoded', { extended: false, limit: '100kb' }); // back-office forms (/admin)
  app.disable('x-powered-by');
  return app;
}
