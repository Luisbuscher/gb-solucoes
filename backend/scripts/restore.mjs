import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDecipheriv, randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { backupKey, pgProcess } from "./backup-common.mjs";
const [file, target] = process.argv.slice(2);
if (
  !file ||
  !target ||
  !/^[a-z][a-z0-9_]{2,62}$/.test(target) ||
  target === process.env.DB_NAME
)
  throw new Error(
    "Uso: npm run restore -- ARQUIVO BANCO_NOVO. O destino deve ser novo e diferente do banco ativo.",
  );
const source = path.resolve(file),
  stat = await fsp.stat(source);
if (stat.size < 33) throw new Error("Backup inválido.");
const handle = await fsp.open(source, "r");
const header = Buffer.alloc(16),
  tag = Buffer.alloc(16);
await handle.read(header, 0, 16, 0);
await handle.read(tag, 0, 16, stat.size - 16);
await handle.close();
if (header.subarray(0, 4).toString() !== "GBB1")
  throw new Error("Formato de backup inválido.");
const decipher = createDecipheriv("aes-256-gcm", backupKey, header.subarray(4));
decipher.setAuthTag(tag);
const temporary = path.join(os.tmpdir(), `gb-restore-${randomUUID()}.dump`);
try {
  // Authenticate the entire dump before creating or writing to the destination database.
  await pipeline(
    fs.createReadStream(source, { start: 16, end: stat.size - 17 }),
    decipher,
    fs.createWriteStream(temporary, { flags: "wx", mode: 0o600 }),
  );
  await pgProcess("createdb", ["--encoding=UTF8", target]).done;
  await pgProcess("pg_restore", [
    "--no-owner",
    "--no-acl",
    "--exit-on-error",
    "--single-transaction",
    "--dbname",
    target,
    temporary,
  ]).done;
  console.log(JSON.stringify({ ok: true, database: target }));
} finally {
  await fsp.unlink(temporary).catch(() => {});
}
