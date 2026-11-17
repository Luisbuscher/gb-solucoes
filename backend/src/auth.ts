import { Router } from "express";
import argon2 from "argon2";
import { z } from "zod";
import { query, transaction } from "./db.js";
import { hash } from "./crypto.js";
import { makeSession, audit, authAttempt, fail } from "./security.js";
import { passwordOptions } from "./seed.js";
import { issueToken } from "./mail.js";
export const auth = Router();
const email = z
  .email()
  .max(254)
  .transform((x) => x.toLowerCase().trim());
const password = z.string().min(12, "Use ao menos 12 caracteres.").max(128);
const dummy = await argon2.hash(
  "GB-Clareza-verificacao-inexistente",
  passwordOptions,
);
auth.get("/session", async (req, res) => {
  res.json(
    req.auth
      ? { user: req.auth.user, csrf: req.auth.csrf }
      : await makeSession(req, res, null),
  );
});
auth.post("/login", async (req, res) => {
  const data = z
    .object({ email, password: z.string().min(1).max(128) })
    .parse(req.body);
  await authAttempt("ip:" + req.ip, 40);
  await authAttempt("login:" + data.email, 5);
  const [user] = await query(
    "SELECT u.* FROM users u LEFT JOIN clients c ON c.id=u.client_id WHERE u.email=$1 AND u.active AND (u.role='admin' OR (c.active AND NOT c.deletion_pending))",
    [data.email],
  );
  const valid = await argon2.verify(
    user?.password_hash || dummy,
    data.password,
  );
  if (!user?.password_hash || !valid) {
    await audit(req, "login.negado", "sessao");
    fail(401, "E-mail ou senha inválidos.");
  }
  await query("DELETE FROM security_limits WHERE key=$1", [
    hash("login:" + data.email),
  ]);
  const actor = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    client_id: user.client_id,
    primary_admin: user.primary_admin,
  };
  const result = await makeSession(req, res, actor, user.password_hash);
  await audit(req, "login.sucesso", "sessao", user.id);
  res.json(result);
});
auth.post("/logout", async (req, res) => {
  await audit(req, "logout", "sessao");
  res.json(await makeSession(req, res, null));
});
auth.post("/recuperar", async (req, res) => {
  const data = z.object({ email }).parse(req.body);
  await authAttempt("reset-ip:" + req.ip, 15);
  await authAttempt("reset:" + data.email, 3);
  const [user] = await query(
    "SELECT id,email FROM users WHERE email=$1 AND active AND NOT primary_admin",
    [data.email],
  );
  if (user) await issueToken(user, "reset", false);
  await audit(req, "senha.recuperacao", "usuario");
  res.json({
    message:
      "Se houver um acesso elegível, enviaremos as instruções para o e-mail cadastrado.",
  });
});
auth.post("/definir-senha", async (req, res) => {
  const data = z
    .object({ token: z.string().regex(/^[a-f0-9]{64}$/), password })
    .parse(req.body);
  await authAttempt("token:" + req.ip, 20);
  const newHash = await argon2.hash(data.password, passwordOptions);
  await transaction(async (db) => {
    const [record] = (
      await db.query(
        "SELECT t.*,u.primary_admin,u.active FROM auth_tokens t JOIN users u ON u.id=t.user_id WHERE t.token_hash=$1 FOR UPDATE OF t,u",
        [hash(data.token)],
      )
    ).rows;
    if (
      !record ||
      record.used_at ||
      new Date(record.expires_at) < new Date() ||
      record.primary_admin ||
      !record.active
    )
      fail(400, "Link inválido, expirado ou já utilizado.");
    await db.query("UPDATE users SET password_hash=$1 WHERE id=$2", [
      newHash,
      record.user_id,
    ]);
    await db.query(
      "UPDATE auth_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL",
      [record.user_id],
    );
    await db.query("DELETE FROM sessions WHERE user_id=$1", [record.user_id]);
  });
  await audit(req, "senha.definida", "usuario");
  res.json({ ok: true });
});
