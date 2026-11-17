import pg from "pg";
import { randomUUID } from "node:crypto";
import { runner } from "node-pg-migrate";
import { config } from "./config.js";
export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: config.ssl,
  max: 15,
  connectionTimeoutMillis: 5000,
  options: "-c search_path=gb_clareza,public -c timezone=America/Sao_Paulo",
});
pool.on("error", () => console.error("Conexão PostgreSQL interrompida."));
export const query = async (text: string, values: unknown[] = []) =>
  (await pool.query(text, values)).rows;
export async function transaction<T>(
  fn: (db: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const result = await fn(db);
    await db.query("COMMIT");
    return result;
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
}
export async function migrate() {
  const db = await pool.connect();
  try {
    await runner({
      dbClient: db,
      dir: "migrations",
      direction: "up",
      schema: "gb_clareza",
      createSchema: true,
      migrationsSchema: "gb_clareza",
      createMigrationsSchema: true,
      migrationsTable: "migrations",
      log: () => {},
      checkOrder: true,
      singleTransaction: true,
    });
  } finally {
    db.release();
  }
}
export const uid = randomUUID;
