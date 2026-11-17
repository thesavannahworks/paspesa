/**
 * PostgreSQL access (White Paper §7: PostgreSQL is the server database).
 *  - DATABASE_URL set → a real PostgreSQL server through `pg` (local PostgreSQL now, a hosted one later).
 *  - not set          → PGlite: the PostgreSQL engine embedded in Node, data in a local folder. Lets the
 *                       backend run on a laptop with no database install; the same SQL runs on both.
 */
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { SCHEMA_VERSION, SCHEMA_SQL } from './schema.js';

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface Database extends Queryable {
  /** Runs `work` as one transaction: committed if it resolves, rolled back if it throws. */
  transaction<T>(work: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  readonly kind: 'postgres' | 'pglite';
}

class PgliteDatabase implements Database {
  readonly kind = 'pglite' as const;
  constructor(private readonly db: PGlite) {}
  async query<T>(sql: string, params: unknown[] = []) {
    return (await this.db.query<T>(sql, params)).rows;
  }
  transaction<T>(work: (q: Queryable) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => work({ query: async <R>(sql: string, params: unknown[] = []) => (await tx.query<R>(sql, params)).rows }));
  }
  async exec(sql: string) {
    await this.db.exec(sql);
  }
  close() {
    return this.db.close();
  }
}

class PostgresDatabase implements Database {
  readonly kind = 'postgres' as const;
  constructor(private readonly pool: pg.Pool) {}
  async query<T>(sql: string, params: unknown[] = []) {
    return (await this.pool.query(sql, params)).rows as T[];
  }
  async transaction<T>(work: (q: Queryable) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work({ query: async <R>(sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows as R[] });
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
  close() {
    return this.pool.end();
  }
}

// BIGINT columns hold whole shillings; return them as numbers (all amounts are far below 2^53).
pg.types.setTypeParser(20, (v) => Number(v));

/** Opens the database and brings the schema up to date. `pgliteDir` undefined = in memory (tests). */
export async function openDatabase(options: { databaseUrl?: string; pgliteDir?: string }): Promise<Database> {
  let db: Database;
  if (options.databaseUrl) {
    const pool = new pg.Pool({ connectionString: options.databaseUrl, max: 10 });
    db = new PostgresDatabase(pool);
    // No parameters → pg uses the simple query protocol, which runs the multi-statement schema as-is.
    await pool.query(SCHEMA_SQL);
  } else {
    const lite = new PgliteDatabase(options.pgliteDir ? new PGlite(options.pgliteDir) : new PGlite());
    await lite.exec(SCHEMA_SQL);
    db = lite;
  }
  await db.query('INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT (version) DO NOTHING', [SCHEMA_VERSION]);
  return db;
}
