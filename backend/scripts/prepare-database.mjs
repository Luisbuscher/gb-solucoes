import dotenv from "dotenv";
import pg from "pg";
import path from "node:path";
import { fileURLToPath } from "node:url";
dotenv.config({
  path: path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env"),
  quiet: true,
});
const name = process.env.DB_NAME;
if (!name || !/^[a-z][a-z0-9_]{2,62}$/.test(name))
  throw new Error("DB_NAME inválido.");
if (!["localhost", "127.0.0.1", "::1"].includes(process.env.DB_HOST))
  throw new Error(
    "Este preparo é exclusivo para PostgreSQL local. Crie bancos remotos pelo provedor.",
  );
const db = new pg.Client({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: "postgres",
});
await db.connect();
try {
  const result = await db.query("SELECT 1 FROM pg_database WHERE datname=$1", [
    name,
  ]);
  if (!result.rowCount) {
    await db.query(`CREATE DATABASE "${name}" ENCODING 'UTF8'`);
    console.log("Banco local criado.");
  } else console.log("Banco já existe; nenhum dado foi alterado.");
} finally {
  await db.end();
}
