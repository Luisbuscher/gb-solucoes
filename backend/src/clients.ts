import { Router } from "express";
import { z } from "zod";
import { query, transaction, uid } from "./db.js";
import { encrypt } from "./crypto.js";
import { audit, fail } from "./security.js";
import { queueRevenueReports } from "./reports.js";
import {
  clientData,
  selectedMonth,
  monthSchema,
  moneySchema,
  idSchema,
} from "./data.js";
export const clients = Router();
const fields = {
  name: z.string().trim().min(1).max(80),
  legal_name: z.string().trim().max(160).default(""),
  cnpj: z
    .string()
    .trim()
    .max(18)
    .refine(
      (s) => !s || /^[A-Z0-9]{12}[0-9]{2}$/i.test(s.replace(/[.\/-]/g, "")),
      "Informe um CNPJ com 14 posições.",
    )
    .default(""),
  municipal_registration: z.string().trim().max(40).default(""),
  city: z.string().trim().max(80).default(""),
  state: z.union([z.string().regex(/^[A-Z]{2}$/), z.literal("")]).default(""),
  phone: z.string().trim().max(20).default(""),
  email: z.union([z.email().max(254), z.literal("")]).optional(),
  type: z.enum(["MEI", "ME"]),
  activity: z.enum(["servicos", "comercio", "ambos"]),
  partners: z.number().int().min(0).max(100).default(0),
  since_month: monthSchema,
  opening_month: z.union([monthSchema, z.literal("")]).optional(),
  drive: z
    .union([z.url().refine((x) => x.startsWith("https://")), z.literal("")])
    .default(""),
  notes: z.string().max(600).default(""),
};
async function validPlan(plan: string, type: string) {
  const [p] = await query("SELECT code FROM plans WHERE code=$1", [plan]);
  if (
    !p ||
    (plan.startsWith("MEI") && type !== "MEI") ||
    (plan.startsWith("Empresa") && type !== "ME")
  )
    fail(400, "Plano incompatível com o enquadramento.");
}
clients.get("/", async (req, res) => {
  const rows = await clientData(selectedMonth(req.query.month));
  await audit(req, "clientes.lista", "cliente");
  res.json(rows);
});
clients.get("/:id", async (req, res) => {
  const id = idSchema.parse(req.params.id);
  const [c] = await clientData(selectedMonth(req.query.month), id);
  if (!c) fail(404, "Cliente não encontrado.");
  const contracts = await query(
    "SELECT * FROM client_contracts WHERE client_id=$1 ORDER BY effective",
    [id],
  );
  await audit(req, "cliente.leitura", "cliente", id);
  res.json({ ...c, contracts });
});
clients.post("/", async (req, res) => {
  const d = z
    .object({
      ...fields,
      plan: z.string(),
      amount: moneySchema,
      effective: monthSchema,
    })
    .strict()
    .parse(req.body);
  await validPlan(d.plan, d.type);
  if (d.effective < d.since_month)
    fail(400, "O contrato não pode começar antes do cadastro.");
  const id = uid();
  await transaction(async (db) => {
    await db.query(
      "INSERT INTO clients(id,name,email,type,activity,partners,since_month,opening_month,drive,notes,legal_name,cnpj,municipal_registration,city,state,phone) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)",
      [
        id,
        d.name,
        d.email || null,
        d.type,
        d.activity,
        d.partners,
        d.since_month,
        d.opening_month || null,
        d.drive,
        encrypt(d.notes),
        d.legal_name,
        d.cnpj,
        d.municipal_registration,
        d.city,
        d.state,
        d.phone,
      ],
    );
    await db.query("INSERT INTO client_contracts VALUES($1,$2,$3,$4)", [
      id,
      d.effective,
      d.plan,
      d.amount,
    ]);
  });
  await audit(req, "cliente.criado", "cliente", id);
  res.status(201).json({ id });
});
clients.patch("/:id", async (req, res) => {
  const id = idSchema.parse(req.params.id);
  const d = z
    .object({
      ...fields,
      active: z.boolean().optional(),
      onboarding: z
        .object({
          emissor: z.boolean().optional(),
          treino: z.boolean().optional(),
          pdf: z.boolean().optional(),
        })
        .strict()
        .optional(),
    })
    .partial()
    .strict()
    .parse(req.body);
  const [old] = await query("SELECT * FROM clients WHERE id=$1", [id]);
  if (!old) fail(404, "Cliente não encontrado.");
  if (old.deletion_pending && d.active === true)
    fail(409, "Conclua a exclusão pendente antes de alterar o acesso.");
  await transaction(async (db) => {
    for (const [key, value] of Object.entries(d)) {
      if (key === "onboarding")
        await db.query(
          "UPDATE clients SET onboarding=onboarding || $1::jsonb WHERE id=$2",
          [JSON.stringify(value), id],
        );
      else
        await db.query(`UPDATE clients SET ${key}=$1 WHERE id=$2`, [
          key === "notes"
            ? encrypt(String(value))
            : value === "" && ["email", "opening_month"].includes(key)
              ? null
              : value,
          id,
        ]);
    }
    if (d.active === false)
      await db.query(
        "DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE client_id=$1)",
        [id],
      );
    if (
      [
        "name",
        "legal_name",
        "cnpj",
        "opening_month",
        "city",
        "state",
        "type",
        "activity",
      ].some((key) => Object.hasOwn(d, key))
    ) {
      const rows = (
        await db.query(
          "SELECT month FROM revenues WHERE client_id=$1 ORDER BY month",
          [id],
        )
      ).rows;
      for (const row of rows) await queueRevenueReports(db, id, row.month);
    }
  });
  await audit(req, "cliente.alterado", "cliente", id, {
    fields: Object.keys(d),
  });
  res.json({ ok: true });
});
clients.post("/:id/contratos", async (req, res) => {
  const id = idSchema.parse(req.params.id);
  const d = z
    .object({ effective: monthSchema, plan: z.string(), amount: moneySchema })
    .strict()
    .parse(req.body);
  const [c] = await query("SELECT * FROM clients WHERE id=$1", [id]);
  if (!c) fail(404, "Cliente não encontrado.");
  await validPlan(d.plan, c.type);
  await transaction(async (db) => {
    await db.query("SELECT id FROM clients WHERE id=$1 FOR UPDATE", [id]);
    await db.query(
      "INSERT INTO client_contracts VALUES($1,$2,$3,$4) ON CONFLICT(client_id,effective) DO UPDATE SET plan=excluded.plan,amount=excluded.amount",
      [id, d.effective, d.plan, d.amount],
    );
    await db.query(
      `UPDATE fees f SET plan=ct.plan,amount=ct.amount FROM LATERAL (SELECT 1) dummy,client_contracts ct WHERE f.client_id=$1 AND f.month>=$2 AND NOT f.paid AND ct.client_id=f.client_id AND ct.effective=(SELECT max(effective) FROM client_contracts WHERE client_id=f.client_id AND effective<=f.month)`,
      [id, d.effective],
    );
  });
  await audit(req, "contrato.alterado", "cliente", id, {
    effective: d.effective,
  });
  res.json({ ok: true });
});
clients.patch("/:id/competencias/:month", async (req, res) => {
  const id = idSchema.parse(req.params.id),
    month = monthSchema.parse(req.params.month);
  const d = z
    .object({
      tasks: z.record(z.string(), z.boolean()).optional(),
      notes_count: z.number().int().min(0).max(100000).optional(),
      notes_delta: z.number().int().min(-1).max(1).optional(),
    })
    .strict()
    .parse(req.body);
  if (d.notes_delta !== undefined && d.notes_count !== undefined)
    fail(400, "Envie quantidade ou incremento, nunca ambos.");
  const [c] = await clientData(month, id);
  if (!c) fail(404, "Cliente não encontrado.");
  if (
    d.tasks &&
    Object.keys(d.tasks).some((k) => !c.tasks.some((t: any) => t.key === k))
  )
    fail(400, "Tarefa não disponível neste plano e competência.");
  await query(
    "INSERT INTO monthly_tasks(client_id,month,tasks,notes_count) VALUES($1,$2,$3,$4) ON CONFLICT(client_id,month) DO UPDATE SET tasks=monthly_tasks.tasks || excluded.tasks,notes_count=LEAST(100000,GREATEST(0,COALESCE($5,monthly_tasks.notes_count+COALESCE($6::int,0))))",
    [
      id,
      month,
      JSON.stringify(d.tasks || {}),
      d.notes_count ?? Math.max(0, d.notes_delta || 0),
      d.notes_count ?? null,
      d.notes_delta ?? null,
    ],
  );
  await audit(req, "competencia.alterada", "cliente", id, {
    month,
    fields: Object.keys(d.tasks || {}),
  });
  res.json({ ok: true });
});
