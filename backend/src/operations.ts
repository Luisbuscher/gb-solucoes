import { Router } from "express";
import { z } from "zod";
import { query, transaction, uid } from "./db.js";
import { encrypt, decrypt } from "./crypto.js";
import { audit, fail, clientScope, authAttempt } from "./security.js";
import {
  catalogue,
  clientData,
  selectedMonth,
  monthSchema,
  moneySchema,
  idSchema,
  materializeFees,
} from "./data.js";
import { currentDate, currentMonth } from "./rules.js";
import { queueRevenueReports } from "./reports.js";
export const operations = Router(),
  me = Router(),
  publicApi = Router();
const statuses = z.enum(["Recebida", "Em andamento", "Concluída", "Cobrada"]);
async function newOrder(req: any, source: "publico" | "cliente" | "admin") {
  const d = z
    .object({
      service_code: z.string().max(80),
      name: z.string().trim().min(1).max(80).optional(),
      email: z.email().max(254).optional(),
      business: z.string().max(80).default(""),
      declared_plan: z.string().max(80).default(""),
      details: z.string().max(500).default(""),
      client_id: idSchema.optional(),
      amount: moneySchema.nullable().optional(),
      date: z.iso.date().optional(),
      website: z.string().max(0).optional(),
    })
    .strict()
    .parse(req.body);
  if (source === "publico" && (!d.name || !d.email))
    fail(400, "Informe nome e e-mail.");
  if (source === "publico" && (d.client_id || d.amount !== undefined || d.date))
    fail(400, "Campos não permitidos.");
  const clientId =
    source === "cliente"
      ? req.auth.user.client_id
      : source === "admin"
        ? d.client_id
        : null;
  if (source === "admin" && !clientId) fail(400, "Selecione um cliente.");
  const [c] = clientId
    ? await query(
        "SELECT id,name,email FROM clients WHERE id=$1 AND active AND NOT deletion_pending",
        [clientId],
      )
    : [];
  if (clientId && !c) fail(404, "Cliente não encontrado.");
  const { services } = await catalogue();
  const service = services.find((s) => s.code === d.service_code);
  if (!service) fail(400, "Serviço inválido.");
  const id = uid();
  await query(
    "INSERT INTO orders(id,client_id,contact_name,contact_email,business,declared_plan,service_code,service_name,price_label,reference_amount,amount,details,source,date) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
    [
      id,
      clientId || null,
      c?.name || d.name,
      c?.email || d.email || req.auth?.user?.email || null,
      d.business,
      d.declared_plan,
      service.code,
      service.name,
      service.price_label,
      service.amount,
      source === "admin" ? (d.amount ?? null) : null,
      encrypt(d.details),
      source,
      d.date || currentDate(),
    ],
  );
  await audit(req, "pedido.criado", "pedido", id, { source });
  return { id };
}
publicApi.get("/catalogo", async (req, res) => res.json(await catalogue()));
publicApi.post("/pedidos", async (req, res) => {
  await authAttempt("public:" + req.ip, 10);
  res.status(201).json(await newOrder(req, "publico"));
});
operations.get("/pedidos", async (req, res) => {
  const month = selectedMonth(req.query.month);
  const rows = await query(
    "SELECT o.*,c.name client_name FROM orders o LEFT JOIN clients c ON c.id=o.client_id WHERE o.status<>'Cobrada' OR to_char(o.date,'YYYY-MM')=$1 ORDER BY o.created_at DESC",
    [month],
  );
  await audit(req, "pedidos.lista", "pedido");
  res.json(rows.map((r) => ({ ...r, details: decrypt(r.details) })));
});
operations.post("/pedidos", async (req, res) =>
  res.status(201).json(await newOrder(req, "admin")),
);
operations.patch("/pedidos/:id", async (req, res) => {
  const id = idSchema.parse(req.params.id);
  const d = z
    .object({
      status: statuses.optional(),
      amount: moneySchema.nullable().optional(),
      client_id: idSchema.optional(),
    })
    .strict()
    .parse(req.body);
  await transaction(async (db) => {
    const [o] = (
      await db.query("SELECT * FROM orders WHERE id=$1 FOR UPDATE", [id])
    ).rows;
    if (!o) fail(404, "Solicitação não encontrada.");
    if (d.client_id) {
      const [c] = (
        await db.query(
          "SELECT id FROM clients WHERE id=$1 AND active AND NOT deletion_pending",
          [d.client_id],
        )
      ).rows;
      if (!c) fail(400, "Cliente indisponível.");
    }
    for (const [k, v] of Object.entries(d))
      await db.query(`UPDATE orders SET ${k}=$1 WHERE id=$2`, [v, id]);
    if (d.status !== undefined)
      await db.query(
        "UPDATE orders SET board_revision=board_revision+1,board_position=(SELECT COALESCE(max(board_position),-1)+1 FROM orders WHERE status=$1 AND id<>$2) WHERE id=$2",
        [d.status, id],
      );
  });
  await audit(req, "pedido.alterado", "pedido", id, {
    fields: Object.keys(d),
    status: d.status,
  });
  res.json({ ok: true });
});
operations.post("/pedidos/:id/mover", async (req, res) => {
  const id = idSchema.parse(req.params.id),
    d = z
      .object({
        status: statuses,
        before_id: idSchema.nullable().optional(),
        expected_revision: z.number().int().min(0),
      })
      .strict()
      .parse(req.body);
  await transaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(872654)");
    const [old] = (
      await db.query(
        "SELECT id,board_revision FROM orders WHERE id=$1 FOR UPDATE",
        [id],
      )
    ).rows;
    if (!old) fail(404, "Solicitação não encontrada.");
    if (old.board_revision !== d.expected_revision)
      fail(
        409,
        "Este cartão foi atualizado por outra pessoa. Atualize o quadro e tente novamente.",
      );
    const rows = (
      await db.query(
        "SELECT id,board_position FROM orders WHERE status=$1 AND id<>$2 ORDER BY board_position,created_at DESC,id FOR UPDATE",
        [d.status, id],
      )
    ).rows;
    const before = d.before_id
      ? rows.findIndex((r) => r.id === d.before_id)
      : rows.length;
    if (before < 0)
      fail(409, "O cartão de destino mudou de coluna. Atualize o quadro.");
    const arranged = [...rows];
    arranged.splice(before, 0, { id, board_position: -1 });
    for (let i = 0; i < arranged.length; i++)
      if (arranged[i].id === id || arranged[i].board_position !== i)
        await db.query(
          "UPDATE orders SET status=$1,board_position=$2,board_revision=board_revision+1 WHERE id=$3",
          [d.status, i, arranged[i].id],
        );
  });
  await audit(req, "pedido.movido", "pedido", id, { status: d.status });
  res.json({ ok: true });
});
operations.delete("/pedidos/:id", async (req, res) => {
  const id = idSchema.parse(req.params.id);
  await query("DELETE FROM orders WHERE id=$1", [id]);
  await audit(req, "pedido.excluido", "pedido", id);
  res.json({ ok: true });
});
operations.get("/honorarios", async (req, res) => {
  const month = selectedMonth(req.query.month);
  await materializeFees(month);
  const rows = await query(
    "SELECT f.*,c.name,c.active FROM fees f JOIN clients c ON c.id=f.client_id WHERE f.month=$1 ORDER BY c.name",
    [month],
  );
  await audit(req, "honorarios.lista", "honorario", month);
  res.json(rows);
});
operations.patch("/honorarios/:id/:month", async (req, res) => {
  const id = idSchema.parse(req.params.id),
    month = monthSchema.parse(req.params.month);
  const d = z.object({ paid: z.boolean() }).strict().parse(req.body);
  await materializeFees(month);
  const rows = await query(
    "UPDATE fees SET paid=$1,paid_at=CASE WHEN $1 THEN now() ELSE NULL END WHERE client_id=$2 AND month=$3 RETURNING client_id",
    [d.paid, id, month],
  );
  if (!rows.length) fail(404, "Honorário não encontrado.");
  await audit(req, "honorario.alterado", "cliente", id, {
    month,
    paid: d.paid,
  });
  res.json({ ok: true });
});
async function reviews(req: any, id?: string) {
  const rows = await query(
    "SELECT r.*,c.name client_name FROM revenue_reviews r JOIN clients c ON c.id=r.client_id " +
      (id ? "WHERE r.client_id=$1" : "") +
      " ORDER BY r.submitted_at DESC LIMIT 500",
    id ? [id] : [],
  );
  return rows.map((r) => ({ ...r, reason: decrypt(r.reason) }));
}
operations.get("/faturamentos/revisoes", async (req, res) => {
  await audit(req, "faturamento.revisoes", "faturamento");
  res.json(await reviews(req));
});
operations.post("/clientes/:id/faturamentos", async (req, res) => {
  const id = idSchema.parse(req.params.id);
  const d = z
    .object({ month: monthSchema, amount: moneySchema })
    .strict()
    .parse(req.body);
  await transaction(async (db) => {
    const [client] = (
      await db.query(
        "SELECT id FROM clients WHERE id=$1 AND NOT deletion_pending FOR UPDATE",
        [id],
      )
    ).rows;
    if (!client) fail(404, "Cliente não encontrado.");
    await db.query(
      "INSERT INTO revenues VALUES($1,$2,$3,now()) ON CONFLICT(client_id,month) DO UPDATE SET amount=excluded.amount,updated_at=now()",
      [id, d.month, d.amount],
    );
    await db.query(
      "INSERT INTO revenue_reviews(id,client_id,month,amount,approved_amount,status,submitted_by,reviewed_by,reviewed_at) VALUES($1,$2,$3,$4,$4,'Aprovado',$5,$5,now())",
      [uid(), id, d.month, d.amount, req.auth!.user!.id],
    );
    await queueRevenueReports(db, id, d.month);
  });
  await audit(req, "faturamento.lancado", "cliente", id, { month: d.month });
  res.json({ ok: true });
});
operations.patch("/faturamentos/revisoes/:id", async (req, res) => {
  const id = idSchema.parse(req.params.id);
  const d = z
    .object({
      status: z.enum(["Aprovado", "Rejeitado"]),
      amount: moneySchema.optional(),
      reason: z.string().max(500).default(""),
    })
    .strict()
    .parse(req.body);
  await transaction(async (db) => {
    const [r] = (
      await db.query("SELECT * FROM revenue_reviews WHERE id=$1 FOR UPDATE", [
        id,
      ])
    ).rows;
    if (!r) fail(404, "Envio não encontrado.");
    if (r.status !== "Pendente") fail(409, "Este envio já foi revisado.");
    const [client] = (
      await db.query(
        "SELECT id FROM clients WHERE id=$1 AND NOT deletion_pending FOR UPDATE",
        [r.client_id],
      )
    ).rows;
    if (!client) fail(404, "Cliente não encontrado.");
    const amount = d.amount ?? r.amount;
    await db.query(
      "UPDATE revenue_reviews SET status=$1,approved_amount=$2,reason=$3,reviewed_by=$4,reviewed_at=now() WHERE id=$5",
      [
        d.status,
        d.status === "Aprovado" ? amount : null,
        encrypt(d.reason),
        req.auth!.user!.id,
        id,
      ],
    );
    if (d.status === "Aprovado") {
      await db.query(
        "INSERT INTO revenues VALUES($1,$2,$3,now()) ON CONFLICT(client_id,month) DO UPDATE SET amount=excluded.amount,updated_at=now()",
        [r.client_id, r.month, amount],
      );
      await queueRevenueReports(db, r.client_id, r.month);
    }
  });
  await audit(req, "faturamento.revisado", "revisao", id, { status: d.status });
  res.json({ ok: true });
});
me.get("/", async (req, res) => {
  const id = req.auth!.user!.client_id!;
  const [c] = await clientData(selectedMonth(req.query.month), id, true);
  if (!c) fail(404, "Cliente não encontrado.");
  await audit(req, "portal.leitura", "cliente", id);
  res.json(c);
});
me.get("/honorarios", async (req, res) => {
  const month = selectedMonth(req.query.month);
  await materializeFees(month, req.auth!.user!.client_id!);
  await audit(req, "portal.honorarios", "cliente", req.auth!.user!.client_id!);
  res.json(
    await query(
      "SELECT month,plan,amount,paid FROM fees WHERE client_id=$1 ORDER BY month DESC LIMIT 24",
      [req.auth!.user!.client_id],
    ),
  );
});
me.get("/pedidos", async (req, res) => {
  const rows = await query(
    "SELECT id,service_name,price_label,amount,status,date,details FROM orders WHERE client_id=$1 ORDER BY created_at DESC",
    [req.auth!.user!.client_id],
  );
  await audit(req, "portal.pedidos", "cliente", req.auth!.user!.client_id!);
  res.json(rows.map((r) => ({ ...r, details: decrypt(r.details) })));
});
me.post("/pedidos", async (req, res) =>
  res.status(201).json(await newOrder(req, "cliente")),
);
me.get("/faturamentos", async (req, res) =>
  res.json(await reviews(req, req.auth!.user!.client_id!)),
);
me.post("/faturamentos", async (req, res) => {
  const d = z
    .object({ month: monthSchema, amount: moneySchema })
    .strict()
    .parse(req.body);
  if (d.month > currentMonth())
    fail(400, "Informe uma competência atual ou anterior.");
  const id = uid();
  await query(
    "INSERT INTO revenue_reviews(id,client_id,month,amount,submitted_by) VALUES($1,$2,$3,$4,$5)",
    [id, req.auth!.user!.client_id, d.month, d.amount, req.auth!.user!.id],
  );
  await audit(req, "faturamento.enviado", "revisao", id, { month: d.month });
  res.status(201).json({ id });
});
