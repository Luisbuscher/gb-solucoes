import dotenv from "dotenv";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
export const backendDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
dotenv.config({ path: path.join(backendDir, ".env"), quiet: true });
export const backupDir = path.resolve(
  process.env.BACKUP_DIR ||
    path.join(
      process.env.LOCALAPPDATA || path.join(os.homedir(), ".local", "share"),
      "GBClareza",
      "backups",
    ),
);
export const backupKey = Buffer.from(
  process.env.BACKUP_ENCRYPTION_KEY || "",
  "hex",
);
if (backupKey.length !== 32)
  throw new Error(
    "BACKUP_ENCRYPTION_KEY deve conter 64 caracteres hexadecimais.",
  );
export const pgEnv = {
  ...process.env,
  PGHOST: process.env.DB_HOST,
  PGPORT: process.env.DB_PORT || "5432",
  PGUSER: process.env.DB_USER,
  PGPASSWORD: process.env.DB_PASSWORD,
  PGSSLMODE: process.env.DB_SSL === "true" ? "verify-full" : "disable",
  ...(process.env.DB_SSL_CA_FILE
    ? { PGSSLROOTCERT: process.env.DB_SSL_CA_FILE }
    : {}),
};
export function pgProcess(binary, args, stdio = ["ignore", "pipe", "pipe"]) {
  const exe = process.env.PG_BIN
    ? path.join(
        process.env.PG_BIN,
        binary + (process.platform === "win32" ? ".exe" : ""),
      )
    : binary;
  const child = spawn(exe, args, { env: pgEnv, stdio, windowsHide: true });
  let diagnostic = "";
  child.stderr?.on("data", (b) => {
    diagnostic += b.toString();
  });
  const done = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              `${binary} terminou com código ${code}. Verifique conectividade e compatibilidade do cliente PostgreSQL.`,
            ),
          ),
    );
  });
  return { child, done };
}
