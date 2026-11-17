import { Router } from "express";
import { z } from "zod";
import { query, transaction, uid } from "./db.js";
import { audit, fail } from "./security.js";
import { catalogue, monthSchema, moneySchema, idSchema } from "./data.js";
import { issueToken, mailConfiguration } from "./mail.js";
import { config } from "./config.js";
export const administration = Router();
administration.get("/usuarios", async (req, res) => {
  const rows = await query(
    "SELECT u.id,u.email,u.name,u.role,u.client_id,u.active,u.primary_admin,u.password_hash IS NOT NULL password_defined,c.name client_name,m.status delivery,m.last_error delivery_error,m.attempts delivery_attempts,m.sent_at,m.provider_id FROM users u LEFT JOIN clients c ON c.id=u.client_id LEFT JOIN LATERAL (SELECT status,last_error,attempts,sent_at,provider_id FROM mail_outbox WHERE user_id=u.id ORDER BY created_at DESC LIMIT 1) m ON true ORDER BY u.created_at",
  );
  await audit(req, "usuarios.lista", "usuario");
  res.json(rows);
});
administration.post("/usuarios", async (req, res) => {
  const d = z
    .object({
      email: z
        .email()
        .max(254)
        .transform((x) => x.toLowerCase()),
      name: z.string().trim().min(1).max(80),
      role: z.enum(["admin", "cliente"]),
      client_id: idSchema.nullable().optional(),
    })
    .strict()
    .parse(req.body);
  if (
    (d.role === "cliente" && !d.client_id) ||
    (d.role === "admin" && d.client_id)
  )
    fail(400, "Vínculo de cliente inválido para este perfil.");
  if (d.client_id) {
    const [c] = await query(
      "SELECT id FROM clients WHERE id=$1 AND active AND NOT deletion_pending",
      [d.client_id],
    );
    if (!c) fail(400, "Cliente indisponível.");
  }
  const id = uid();
  await query(
    "INSERT INTO users(id,email,name,role,client_id) VALUES($1,$2,$3,$4,$5)",
    [id, d.email, d.name, d.role, d.client_id || null],
  );
  const invitation = await issueToken({ id, email: d.email }, "invite");
  await audit(req, "usuario.criado", "usuario", id, { role: d.role });
  res.status(201).json({ id, ...invitation });
});
administration.patch("/usuarios/:id", async (req, res) => {
  const id = idSchema.parse(req.params.id),
    d = z.object({ active: z.boolean() }).strict().parse(req.body);
  const [user] = await query("SELECT * FROM users WHERE id=$1", [id]);
  if (!user) fail(404, "Usuário não encontrado.");
  if (user.primary_admin || user.id === req.auth!.user!.id)
    fail(400, "O administrador primário e o próprio acesso estão protegidos.");
  await transaction(async (db) => {
    await db.query("UPDATE users SET active=$1 WHERE id=$2", [d.active, id]);
    await db.query("DELETE FROM sessions WHERE user_id=$1", [id]);
    await db.query(
      "UPDATE auth_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL",
      [id],
    );
  });
  await audit(req, "usuario.alterado", "usuario", id, { active: d.active });
  res.json({ ok: true });
});
administration.post("/usuarios/:id/convite", async (req, res) => {
  const id = idSchema.parse(req.params.id);
  const [user] = await query(
    "SELECT * FROM users WHERE id=$1 AND active AND NOT primary_admin",
    [id],
  );
  if (!user) fail(400, "Acesso indisponível para convite.");
  await audit(req, "usuario.convite", "usuario", id);
  res.json(await issueToken(user, "invite"));
});
administration.get("/configuracoes", async (req, res) => {
  const current = await catalogue();
  res.json({
    ...current,
    plan_versions: await query(
      "SELECT * FROM plan_versions ORDER BY code,effective DESC",
    ),
    service_versions: await query(
      "SELECT * FROM service_versions ORDER BY code,effective DESC",
    ),
    fiscal: await query("SELECT * FROM fiscal_configs ORDER BY year DESC"),
    history: await query(
      "SELECT id,kind,entity,effective,created_at FROM configuration_history ORDER BY id DESC LIMIT 100",
    ),
    integrations: {
      gcs: !!(
        config.gcsBucket &&
        (process.env.GCS_SERVICE_ACCOUNT_JSON ||
          process.env.GCS_SERVICE_ACCOUNT_FILE)
      ),
      resend: mailConfiguration().configured,
      email: mailConfiguration(),
    },
  });
});
administration.put("/configuracoes/planos", async (req, res) => {
  const d = z
    .object({
      code: z.string().max(80),
      effective: monthSchema,
      amount: moneySchema,
      ceiling: moneySchema.nullable(),
      partners: z.number().int().min(0).max(100).nullable(),
      hours: z.number().min(0).max(744).nullable(),
    })
    .strict()
    .parse(req.body);
  await query(
    "INSERT INTO plan_versions VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(code,effective) DO UPDATE SET amount=excluded.amount,ceiling=excluded.ceiling,partners=excluded.partners,hours=excluded.hours",
    [uid(), d.code, d.effective, d.amount, d.ceiling, d.partners, d.hours],
  );
  await audit(req, "configuracao.plano", "plano", d.code, {
    effective: d.effective,
  });
  res.json({ ok: true });
});
administration.put("/configuracoes/servicos", async (req, res) => {
  const d = z
    .object({
      code: z.string().min(1).max(80),
      effective: monthSchema,
      category: z.string().min(1).max(80),
      name: z.string().min(1).max(120),
      description: z.string().max(600),
      price_label: z.string().min(1).max(80),
      amount: moneySchema.nullable(),
    })
    .strict()
    .parse(req.body);
  await query(
    "INSERT INTO service_versions VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(code,effective) DO UPDATE SET category=excluded.category,name=excluded.name,description=excluded.description,price_label=excluded.price_label,amount=excluded.amount",
    [
      uid(),
      d.code,
      d.effective,
      d.category,
      d.name,
      d.description,
      d.price_label,
      d.amount,
    ],
  );
  await audit(req, "configuracao.servico", "servico", d.code, {
    effective: d.effective,
  });
  res.json({ ok: true });
});
const fiscalSchema = z
  .object({
    meiLimit: z.number().positive(),
    das: z
      .object({
        comercio: z.number().nonnegative(),
        servicos: z.number().nonnegative(),
        ambos: z.number().nonnegative(),
      })
      .strict(),
    simplesBands: z
      .array(z.number().positive())
      .length(6)
      .refine(
        (a) => a.every((v, i) => !i || v > a[i - 1]),
        "Faixas devem ser crescentes.",
      ),
    alert: z.number().min(0.1).max(1),
    notesIncluded: z.number().int().nonnegative(),
    extraNote: z.number().nonnegative(),
  })
  .strict();
administration.put("/configuracoes/fiscal", async (req, res) => {
  const d = z
    .object({
      year: z.number().int().min(2000).max(2200),
      config: fiscalSchema,
      source: z.url().max(1000),
    })
    .strict()
    .parse(req.body);
  await query(
    "INSERT INTO fiscal_configs(year,config,source) VALUES($1,$2,$3) ON CONFLICT(year) DO UPDATE SET config=excluded.config,source=excluded.source",
    [d.year, JSON.stringify(d.config), d.source],
  );
  await audit(req, "configuracao.fiscal", "fiscal", String(d.year));
  res.json({ ok: true });
});
administration.put("/configuracoes/contato", async (req, res) => {
  const d = z
    .object({
      whatsapp: z.string().regex(/^$|^55\d{10,11}$/),
      instagram: z.url().refine((s) => s.startsWith("https://")),
      agenda: z.url().refine((s) => s.startsWith("https://")),
    })
    .strict()
    .parse(req.body);
  await query("UPDATE settings SET value=$1 WHERE key='contact'", [
    JSON.stringify(d),
  ]);
  await audit(req, "configuracao.contato", "configuracao");
  res.json({ ok: true });
});
administration.get("/auditoria", async (req, res) => {
  const limit = z.coerce
    .number()
    .int()
    .min(1)
    .max(200)
    .parse(req.query.limit || 100);
  const before = req.query.before
    ? z.coerce.number().int().positive().parse(req.query.before)
    : null;
  const rows = await query(
    "SELECT a.*,u.name actor_name FROM audit_events a LEFT JOIN users u ON u.id=a.actor_id WHERE ($1::bigint IS NULL OR a.id<$1) ORDER BY a.id DESC LIMIT $2",
    [before, limit],
  );
  res.json(rows);
});
