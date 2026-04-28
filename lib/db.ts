import { Pool } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var __embrPulsePgPool: Pool | undefined;
}

function buildPool(): Pool {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  return new Pool({
    connectionString: url,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}

export const pool: Pool =
  globalThis.__embrPulsePgPool ?? (globalThis.__embrPulsePgPool = buildPool());
