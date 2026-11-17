import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  hkdfSync,
} from "node:crypto";
import { createSecureContext } from "node:tls";
import { Readable } from "node:stream";
import multer from "multer";
import argon2 from "argon2";
import { z } from "zod";
import { config } from "./config.js";
import { hash } from "./crypto.js";
import { query, uid } from "./db.js";
import { audit, authAttempt, fail } from "./security.js";
import { idSchema } from "./data.js";
import { objectStore } from "./storage.js";

export const vault = Router({ mergeParams: true });
const vaultKey = Buffer.from(
  hkdfSync(
    "sha256",
    config.encryptionKey,
    Buffer.from("GB-Solucoes"),
    Buffer.from("client-vault-v1"),
    32,
  ),
);
export function sealVault(data: Buffer, context: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", vaultKey, iv);
  cipher.setAAD(Buffer.from(context));
  return Buffer.concat([
    Buffer.from("GBV1"),
    iv,
    cipher.update(data),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
}
export function openVault(data: Buffer, context: string) {
  if (data.length < 32 || data.subarray(0, 4).toString() !== "GBV1")
    fail(500, "Arquivo protegido inválido.");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    vaultKey,
    data.subarray(4, 16),
  );
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(data.subarray(data.length - 16));
  return Buffer.concat([
    decipher.update(data.subarray(16, -16)),
    decipher.final(),
  ]);
}
const secret = (data: object, id: string) =>
  sealVault(Buffer.from(JSON.stringify(data)), id).toString("base64");
const reveal = (data: string, id: string) =>
  JSON.parse(openVault(Buffer.from(data, "base64"), id).toString());
const clientId = (req: Request) => idSchema.parse(req.params.id);
vault.use(async (req, res, next) => {
  const id = clientId(req);
  const [c] = await query(
    "SELECT id,deletion_pending FROM clients WHERE id=$1",
    [id],
  );
  if (!c) fail(404, "Cliente não encontrado.");
  if (c.deletion_pending)
    fail(409, "Este cliente está em processo de exclusão.");
  res.setHeader("Cache-Control", "no-store");
  next();
});
async function unlocked(req: Request, res: Response, next: NextFunction) {
  const [grant] = await query(
    "SELECT 1 FROM vault_grants WHERE session_hash=$1 AND client_id=$2 AND expires_at>now()",
    [req.auth!.hash, clientId(req)],
  );
  if (!grant) fail(403, "Cofre bloqueado. Confirme sua senha novamente.");
  next();
}
vault.post("/desbloquear", async (req, res) => {
  const { password } = z
    .object({ password: z.string().min(1).max(128) })
    .strict()
    .parse(req.body);
  await authAttempt("vault:" + req.auth!.user!.id, 8);
  const [u] = await query("SELECT password_hash FROM users WHERE id=$1", [
    req.auth!.user!.id,
  ]);
  if (!u?.password_hash || !(await argon2.verify(u.password_hash, password))) {
    await audit(req, "cofre.desbloqueio-negado", "cliente", clientId(req));
    fail(403, "Senha de confirmação incorreta.");
  }
  const [g] = await query(
    "INSERT INTO vault_grants VALUES($1,$2,now()+interval '5 minutes') ON CONFLICT(session_hash,client_id) DO UPDATE SET expires_at=excluded.expires_at RETURNING expires_at",
    [req.auth!.hash, clientId(req)],
  );
  await query("DELETE FROM security_limits WHERE key=$1", [
    hash("vault:" + req.auth!.user!.id),
  ]);
  await audit(req, "cofre.desbloqueado", "cliente", clientId(req));
  res.json({ expires_at: g.expires_at });
});
vault.post("/bloquear", async (req, res) => {
  await query(
    "DELETE FROM vault_grants WHERE session_hash=$1 AND client_id=$2",
    [req.auth!.hash, clientId(req)],
  );
  await audit(req, "cofre.bloqueado", "cliente", clientId(req));
  res.json({ ok: true });
});
vault.get("/", async (req, res) => {
  const id = clientId(req);
  const entries = await query(
    "SELECT id,label,kind,updated_at FROM client_credentials WHERE client_id=$1 ORDER BY label",
    [id],
  );
  const certificates = await query(
    "SELECT id,label,filename,size,valid_until,created_at FROM client_certificates WHERE client_id=$1 ORDER BY created_at DESC",
    [id],
  );
  const [grant] = await query(
    "SELECT expires_at FROM vault_grants WHERE session_hash=$1 AND client_id=$2 AND expires_at>now()",
    [req.auth!.hash, id],
  );
  res.json({ entries, certificates, expires_at: grant?.expires_at || null });
});
const fields = z
  .object({
    label: z.string().trim().min(1).max(80),
    kind: z.enum(["prefeitura", "simples", "govbr", "outro"]),
    url: z
      .union([z.url().refine((v) => v.startsWith("https://")), z.literal("")])
      .default(""),
    login: z.string().max(254).default(""),
    password: z.string().max(512).default(""),
    access_code: z.string().max(512).default(""),
    notes: z.string().max(1000).default(""),
  })
  .strict();
vault.post("/credenciais", unlocked, async (req, res) => {
  const d = fields.parse(req.body),
    id = uid(),
    owner = clientId(req);
  await query(
    "INSERT INTO client_credentials(id,client_id,label,kind,secret_payload) VALUES($1,$2,$3,$4,$5)",
    [id, owner, d.label, d.kind, secret(d, owner + ":" + id)],
  );
  await audit(req, "cofre.credencial-criada", "credencial", id);
  res.status(201).json({ id });
});
vault.post("/credenciais/:entryId/revelar", unlocked, async (req, res) => {
  const id = idSchema.parse(req.params.entryId),
    owner = clientId(req);
  const [row] = await query(
    "SELECT secret_payload FROM client_credentials WHERE id=$1 AND client_id=$2",
    [id, owner],
  );
  if (!row) fail(404, "Credencial não encontrada.");
  await audit(req, "cofre.credencial-revelada", "credencial", id);
  res.json(reveal(row.secret_payload, owner + ":" + id));
});
vault.put("/credenciais/:entryId", unlocked, async (req, res) => {
  const id = idSchema.parse(req.params.entryId),
    owner = clientId(req),
    d = fields.parse(req.body);
  const rows = await query(
    "UPDATE client_credentials SET label=$1,kind=$2,secret_payload=$3,updated_at=now() WHERE id=$4 AND client_id=$5 RETURNING id",
    [d.label, d.kind, secret(d, owner + ":" + id), id, owner],
  );
  if (!rows.length) fail(404, "Credencial não encontrada.");
  await audit(req, "cofre.credencial-alterada", "credencial", id);
  res.json({ ok: true });
});
vault.delete("/credenciais/:entryId", unlocked, async (req, res) => {
  const id = idSchema.parse(req.params.entryId);
  const rows = await query(
    "DELETE FROM client_credentials WHERE id=$1 AND client_id=$2 RETURNING id",
    [id, clientId(req)],
  );
  if (!rows.length) fail(404, "Credencial não encontrada.");
  await audit(req, "cofre.credencial-excluida", "credencial", id);
  res.json({ ok: true });
});
const certUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 5 },
});
vault.post(
  "/certificados",
  unlocked,
  certUpload.single("file"),
  async (req, res) => {
    const d = z
      .object({
        label: z.string().trim().min(1).max(80),
        password: z.string().max(512).default(""),
        valid_until: z.union([z.iso.date(), z.literal("")]).optional(),
      })
      .strict()
      .parse(req.body);
    const file = req.file;
    if (!file || !file.size || !/\.(pfx|p12)$/i.test(file.originalname))
      fail(400, "Selecione um certificado A1 em formato PFX ou P12, até 5 MB.");
    try {
      createSecureContext({ pfx: file.buffer, passphrase: d.password });
    } catch {
      fail(
        400,
        "O certificado não pôde ser validado. Confira o formato e a senha.",
      );
    }
    const id = uid(),
      owner = clientId(req),
      key = `vault/${owner}/${id}.encrypted`;
    const store = objectStore();
    const sealed = sealVault(file.buffer, owner + ":" + id);
    await store.put(key, sealed, "application/octet-stream");
    try {
      await query(
        "INSERT INTO client_certificates(id,client_id,label,filename,object_key,size,valid_until,secret_payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          id,
          owner,
          d.label,
          file.originalname.replace(/[\r\n\\/]/g, "_").slice(0, 200),
          key,
          file.size,
          d.valid_until || null,
          secret({ password: d.password }, owner + ":" + id),
        ],
      );
    } catch (e) {
      await store.remove(key);
      throw e;
    } finally {
      file.buffer.fill(0);
    }
    await audit(req, "cofre.certificado-enviado", "certificado", id);
    res.status(201).json({ id });
  },
);
vault.post("/certificados/:certificateId/senha", unlocked, async (req, res) => {
  const id = idSchema.parse(req.params.certificateId),
    owner = clientId(req);
  const [row] = await query(
    "SELECT secret_payload FROM client_certificates WHERE id=$1 AND client_id=$2",
    [id, owner],
  );
  if (!row) fail(404, "Certificado não encontrado.");
  await audit(req, "cofre.senha-certificado-revelada", "certificado", id);
  res.json(reveal(row.secret_payload, owner + ":" + id));
});
vault.post(
  "/certificados/:certificateId/download",
  unlocked,
  async (req, res) => {
    const id = idSchema.parse(req.params.certificateId),
      owner = clientId(req);
    const [row] = await query(
      "SELECT * FROM client_certificates WHERE id=$1 AND client_id=$2",
      [id, owner],
    );
    if (!row) fail(404, "Certificado não encontrado.");
    const parts: Buffer[] = [];
    let size = 0;
    for await (const chunk of objectStore().get(row.object_key) as Readable) {
      const b = Buffer.from(chunk);
      size += b.length;
      if (size > row.size + 32)
        fail(500, "Arquivo protegido com tamanho inesperado.");
      parts.push(b);
    }
    const content = openVault(Buffer.concat(parts), owner + ":" + id);
    await audit(req, "cofre.certificado-baixado", "certificado", id);
    res.setHeader("Content-Type", "application/x-pkcs12");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
    );
    res.once("finish", () => content.fill(0));
    res.once("close", () => content.fill(0));
    res.send(content);
  },
);
vault.delete("/certificados/:certificateId", unlocked, async (req, res) => {
  const id = idSchema.parse(req.params.certificateId);
  const [row] = await query(
    "SELECT object_key FROM client_certificates WHERE id=$1 AND client_id=$2",
    [id, clientId(req)],
  );
  if (!row) fail(404, "Certificado não encontrado.");
  await objectStore().remove(row.object_key);
  await query("DELETE FROM client_certificates WHERE id=$1", [id]);
  await audit(req, "cofre.certificado-excluido", "certificado", id);
  res.json({ ok: true });
});
