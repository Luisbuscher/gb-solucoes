import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { randomBytes, createCipheriv } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { backupDir, backupKey, pgProcess } from "./backup-common.mjs";
await fsp.mkdir(backupDir, { recursive: true });
const stamp = new Date().toISOString().replaceAll(":", "-");
const target = path.join(backupDir, `${process.env.DB_NAME}-${stamp}.gbbackup`),
  temporary = target + ".partial";
const iv = randomBytes(12),
  cipher = createCipheriv("aes-256-gcm", backupKey, iv);
const { child, done } = pgProcess("pg_dump", [
  "--format=custom",
  "--no-owner",
  "--no-acl",
  "--dbname",
  process.env.DB_NAME,
]);
try {
  await fsp.writeFile(temporary, Buffer.concat([Buffer.from("GBB1"), iv]), {
    mode: 0o600,
  });
  await Promise.all([
    pipeline(
      child.stdout,
      cipher,
      fs.createWriteStream(temporary, { flags: "a" }),
    ),
    done,
  ]);
  await fsp.appendFile(temporary, cipher.getAuthTag());
  await fsp.rename(temporary, target);
  const retention = Number(process.env.BACKUP_RETENTION_DAYS || 30);
  if (!Number.isFinite(retention) || retention < 1)
    throw new Error("Retenção inválida.");
  for (const name of await fsp.readdir(backupDir)) {
    if (
      !name.startsWith(process.env.DB_NAME + "-") ||
      !name.endsWith(".gbbackup")
    )
      continue;
    const file = path.join(backupDir, name);
    if ((await fsp.stat(file)).mtimeMs < Date.now() - retention * 86400000)
      await fsp.unlink(file);
  }
  console.log(
    JSON.stringify({ ok: true, file: target, retentionDays: retention }),
  );
} catch (e) {
  child.kill();
  await fsp.unlink(temporary).catch(() => {});
  throw e;
}
