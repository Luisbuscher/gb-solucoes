import "dotenv/config";
import fs from "node:fs";
import { z } from "zod";
const bool = (v: string | undefined) => v === "true";
const raw = z
  .object({
    DB_HOST: z.string().min(1),
    DB_PORT: z.coerce.number().int().positive().default(5432),
    DB_USER: z.string().min(1),
    DB_PASSWORD: z.string().min(1),
    DB_NAME: z.string().min(1),
    ADMIN_EMAIL: z.email(),
    ADMIN_PASSWORD: z.string().min(12),
    DATA_ENCRYPTION_KEY: z.string().regex(/^[a-f0-9]{64}$/i),
    APP_URL: z.url().default("http://localhost:3000"),
  })
  .parse(process.env);
const host =
  process.env.RUNNING_IN_DOCKER === "true" &&
  ["localhost", "127.0.0.1", "::1"].includes(raw.DB_HOST)
    ? "host.docker.internal"
    : raw.DB_HOST;
const url = new URL("postgresql://localhost");
url.hostname = host;
url.port = String(raw.DB_PORT);
url.username = raw.DB_USER;
url.password = raw.DB_PASSWORD;
url.pathname = "/" + raw.DB_NAME;
if (
  process.env.GCS_SERVICE_ACCOUNT_JSON &&
  process.env.GCS_SERVICE_ACCOUNT_FILE
)
  throw new Error("Configure JSON OU arquivo GCS, nunca ambos.");
export const config = {
  ...raw,
  databaseUrl: url.toString(),
  port: Number(process.env.PORT || 3001),
  secure: bool(process.env.COOKIE_SECURE),
  https: bool(process.env.REQUIRE_HTTPS),
  encryptionKey: Buffer.from(raw.DATA_ENCRYPTION_KEY, "hex"),
  gcsBucket: process.env.GCS_BUCKET_NAME || "",
  resendKey: process.env.RESEND_API_KEY || "",
  from: process.env.RESEND_FROM_EMAIL || "",
  ssl: bool(process.env.DB_SSL)
    ? {
        rejectUnauthorized: true,
        ...(process.env.DB_SSL_CA_FILE
          ? { ca: fs.readFileSync(process.env.DB_SSL_CA_FILE, "utf8") }
          : {}),
      }
    : false,
};
if (
  config.https &&
  (!config.secure ||
    !config.ssl ||
    new URL(config.APP_URL).protocol !== "https:")
)
  throw new Error(
    "Produção HTTPS exige cookie Secure, APP_URL HTTPS e DB_SSL=true.",
  );
if (
  !["localhost", "127.0.0.1", "[::1]"].includes(
    new URL(config.APP_URL).hostname,
  ) &&
  !config.https
)
  throw new Error("URL pública exige REQUIRE_HTTPS=true.");
process.env.TZ = "America/Sao_Paulo";
