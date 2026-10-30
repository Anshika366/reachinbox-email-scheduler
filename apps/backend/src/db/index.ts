import { Pool, QueryResult, QueryResultRow } from "pg";
import { config } from "../config/index.js";

const isRemoteDb =
  config.databaseUrl.includes("supabase.com") ||
  config.databaseUrl.includes("render.com") ||
  config.nodeEnv === "production";

export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: isRemoteDb ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

export async function query<T extends QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params);
}

export async function checkDbConnection(): Promise<boolean> {
  try {
    const res = await pool.query("SELECT 1");
    return res.rowCount !== null && res.rowCount > 0;
  } catch {
    return false;
  }
}
