import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { config } from "./config.js";
export const token = () => randomBytes(32).toString("hex");
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function encrypt(value: string) {
  if (!value) return "";
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", config.encryptionKey, iv);
  const data = Buffer.concat([c.update(value, "utf8"), c.final()]);
  return [
    iv.toString("hex"),
    data.toString("hex"),
    c.getAuthTag().toString("hex"),
  ].join(".");
}
export function decrypt(value: string) {
  if (!value) return "";
  const [iv, data, tag] = value.split(".");
  const c = createDecipheriv(
    "aes-256-gcm",
    config.encryptionKey,
    Buffer.from(iv, "hex"),
  );
  c.setAuthTag(Buffer.from(tag, "hex"));
  return Buffer.concat([
    c.update(Buffer.from(data, "hex")),
    c.final(),
  ]).toString("utf8");
}
