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

// Lazy proxy: defer pool creation until first use so Next's build-time page-
// data collection (which loads modules but never queries) doesn't blow up when
// DATABASE_URL is absent in the build environment.
function getPool(): Pool {
  return (globalThis.__embrPulsePgPool ??= buildPool());
}

export const pool: Pool = new Proxy({} as Pool, {
  get(_target, prop) {
    const real = getPool();
    const value = Reflect.get(real, prop, real);
    return typeof value === "function" ? value.bind(real) : value;
  },
}) as Pool;
