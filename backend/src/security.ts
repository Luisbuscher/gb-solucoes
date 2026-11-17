import type { Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "node:crypto";
import { query, uid } from "./db.js";
import { hash, token } from "./crypto.js";
import { config } from "./config.js";
export type Actor = {
  id: string;
  email: string;
  name: string;
  role: "admin" | "cliente";
  client_id: string | null;
  primary_admin: boolean;
};
declare global {
  namespace Express {
    interface Request {
      auth?: { hash: string; csrf: string; user: Actor | null };
    }
  }
}
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function fail(status: number, message: string): never {
  throw new HttpError(status, message);
}
export async function audit(
  req: Request,
  action: string,
  type: string,
  id?: string,
  metadata: object = {},
) {
  await query(
    "INSERT INTO audit_events(actor_id,action,entity_type,entity_id,ip,metadata) VALUES($1,$2,$3,$4,$5,$6)",
    [
      req.auth?.user?.id || null,
      action,
      type,
      id || null,
      req.ip || "",
      JSON.stringify(metadata),
    ],
  );
}
export async function session(req: Request, res: Response, next: NextFunction) {
  const cookie = req.cookies?.gb_session;
  if (typeof cookie === "string" && /^[a-f0-9]{64}$/.test(cookie)) {
    const rows = await query(
      `UPDATE sessions s SET touched_at=now() WHERE token_hash=$1 AND touched_at>now()-interval '30 minutes' AND s.created_at>now()-interval '8 hours' RETURNING s.*`,
      [hash(cookie)],
    );
    const s = rows[0];
    if (s) {
      let user: Actor | null = null;
      if (s.user_id) {
        const rows = await query(
          "SELECT u.id,u.email,u.name,u.role,u.client_id,u.primary_admin FROM users u LEFT JOIN clients c ON c.id=u.client_id WHERE u.id=$1 AND u.active AND (u.role='admin' OR (c.active AND NOT c.deletion_pending))",
          [s.user_id],
        );
        user = rows[0] || null;
        if (!user) {
          await query("DELETE FROM sessions WHERE token_hash=$1", [
            s.token_hash,
          ]);
          return next();
        }
      }
      if (user) {
        const [credential] = await query(
          "SELECT password_hash FROM users WHERE id=$1",
          [user.id],
        );
        if (
          !credential?.password_hash ||
          s.auth_fingerprint !== hash(credential.password_hash)
        ) {
          await query("DELETE FROM sessions WHERE token_hash=$1", [
            s.token_hash,
          ]);
          return next();
        }
      }
      req.auth = { hash: s.token_hash, csrf: s.csrf, user };
    }
  }
  next();
}
export async function makeSession(
  req: Request,
  res: Response,
  user: Actor | null,
  verifiedHash?: string,
) {
  const value = token(),
    csrf = token();
  if (req.auth)
    await query("DELETE FROM sessions WHERE token_hash=$1", [req.auth.hash]);
  await query(
    "INSERT INTO sessions(token_hash,user_id,csrf,auth_fingerprint) VALUES($1,$2,$3,$4)",
    [
      hash(value),
      user?.id || null,
      csrf,
      verifiedHash ? hash(verifiedHash) : null,
    ],
  );
  res.cookie("gb_session", value, {
    httpOnly: true,
    secure: config.secure,
    sameSite: "lax",
    path: "/",
    maxAge: 8 * 3600000,
  });
  req.auth = { hash: hash(value), csrf, user };
  return { user, csrf };
}
export function csrf(req: Request, res: Response, next: NextFunction) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (!req.auth)
    return next(new HttpError(401, "Sua sessão expirou. Entre novamente."));
  const supplied = req.get("X-CSRF-Token") || "";
  const expected = req.auth.csrf;
  if (
    req.get("Origin") !== new URL(config.APP_URL).origin ||
    !expected ||
    supplied.length !== expected.length ||
    !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
  )
    return next(
      new HttpError(
        403,
        "Origem ou token de segurança inválido. Atualize a página.",
      ),
    );
  next();
}
export function authenticated(req: Request, res: Response, next: NextFunction) {
  if (!req.auth?.user) return next(new HttpError(401, "Entre para continuar."));
  next();
}
export function admin(req: Request, res: Response, next: NextFunction) {
  if (req.auth?.user?.role !== "admin")
    return next(new HttpError(403, "Acesso restrito à administração."));
  next();
}
export function clientScope(req: Request, id: string) {
  if (req.auth?.user?.role !== "admin" && req.auth?.user?.client_id !== id)
    fail(404, "Registro não encontrado.");
}
export async function authAttempt(key: string, max: number) {
  const [r] = await query(
    `INSERT INTO security_limits(key,attempts) VALUES($1,1) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN security_limits.started_at<now()-interval '15 minutes' THEN 1 ELSE security_limits.attempts+1 END,started_at=CASE WHEN security_limits.started_at<now()-interval '15 minutes' THEN now() ELSE security_limits.started_at END RETURNING attempts`,
    [hash(key)],
  );
  if (r.attempts > max) fail(429, "Muitas tentativas. Aguarde 15 minutos.");
}
