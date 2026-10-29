import { Pool, QueryResult, QueryResultRow } from "pg";
import { config } from "../config/index.js";

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
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
