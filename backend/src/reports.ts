import { Router } from "express";
import type { PoolClient } from "pg";
import PDFDocument from "pdfkit";
import { Decimal } from "decimal.js";
import { z } from "zod";
import { query, transaction, uid } from "./db.js";
import { hash, encrypt, decrypt } from "./crypto.js";
import { audit, clientScope, fail, HttpError } from "./security.js";
import { idSchema, monthSchema, moneySchema } from "./data.js";
import { currentMonth, currentDate } from "./rules.js";
import { objectStore } from "./storage.js";

export const revenueParts = [
  "commerce_with_invoice",
  "commerce_without_invoice",
  "industry_with_invoice",
  "industry_without_invoice",
  "services_with_invoice",
  "services_without_invoice",
] as const;
const labels: Record<string, string> = {
  commerce_with_invoice: "Comércio com nota fiscal",
  commerce_without_invoice: "Comércio sem nota fiscal",
  industry_with_invoice: "Indústria com nota fiscal",
  industry_without_invoice: "Indústria sem nota fiscal",
  services_with_invoice: "Serviços com nota fiscal",
  services_without_invoice: "Serviços sem nota fiscal",
};
const brl = (v: unknown) =>
  new Decimal(String(v || 0))
    .toNumber()
    .toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const sum = (values: unknown[]) =>
  values
    .reduce<Decimal>((total, n) => total.plus(String(n || 0)), new Decimal(0))
    .toFixed(2);
const yearSchema = z.coerce.number().int().min(2000).max(2099);

async function snapshot(
  db: PoolClient,
  id: string,
  kind: "monthly" | "annual",
  period: string,
) {
  const [client] = (
    await db.query(
      "SELECT id,name,legal_name,cnpj,type,activity,opening_month,city,state FROM clients WHERE id=$1",
      [id],
    )
  ).rows;
  if (!client) fail(404, "Cliente não encontrado.");
  const year = period.slice(0, 4);
  const values = (
    await db.query(
      "SELECT month,amount,updated_at FROM revenues WHERE client_id=$1 AND left(month,4)=$2 ORDER BY month",
      [id, year],
    )
  ).rows;
  const assessments = (
    await db.query(
      "SELECT * FROM revenue_assessments WHERE client_id=$1 AND left(month,4)=$2",
      [id, year],
    )
  ).rows;
  const evidence = (
    await db.query(
      "SELECT e.month,d.id,d.title,d.filename,d.category FROM revenue_evidence e JOIN documents d ON d.id=e.document_id WHERE e.client_id=$1 AND left(e.month,4)=$2 ORDER BY e.month,d.id",
      [id, year],
    )
  ).rows;
  const [inputs] = (
    await db.query(
      "SELECT had_employee FROM annual_inputs WHERE client_id=$1 AND year=$2",
      [id, Number(year)],
    )
  ).rows;
  const [office] = (
    await db.query("SELECT value FROM settings WHERE key='organization'")
  ).rows;
  const start = client.opening_month?.startsWith(year)
    ? Number(client.opening_month.slice(5))
    : 1;
  const months =
    kind === "monthly"
      ? [period]
      : Array.from(
          { length: 13 - start },
          (_, i) => year + "-" + String(start + i).padStart(2, "0"),
        );
  const rows = months.map((month) => {
    const r = values.find((r) => r.month === month),
      a = assessments.find((a) => a.month === month);
    const confirmed = !!(r && a && new Decimal(r.amount).equals(a.total));
    return {
      month,
      amount: r?.amount ?? null,
      breakdown: confirmed
        ? Object.fromEntries(revenueParts.map((k) => [k, a[k]]))
        : null,
      assessed_at: confirmed ? a.assessed_at.toISOString() : null,
      documents: confirmed
        ? evidence.filter((d) => d.month === month).map(({ month, ...d }) => d)
        : [],
    };
  });
  const missing = rows.filter((r) => r.amount === null).map((r) => r.month),
    unclassified = rows
      .filter((r) => r.amount !== null && !r.breakdown)
      .map((r) => r.month),
    unsupported = rows
      .filter(
        (r) =>
          r.amount !== null &&
          r.breakdown &&
          new Decimal(r.amount).gt(0) &&
          !r.documents.length,
      )
      .map((r) => r.month);
  const commerce = sum(
      rows.map((r) =>
        r.breakdown
          ? sum([
              r.breakdown.commerce_with_invoice,
              r.breakdown.commerce_without_invoice,
              r.breakdown.industry_with_invoice,
              r.breakdown.industry_without_invoice,
            ])
          : 0,
      ),
    ),
    services = sum(
      rows.map((r) =>
        r.breakdown
          ? sum([
              r.breakdown.services_with_invoice,
              r.breakdown.services_without_invoice,
            ])
          : 0,
      ),
    );
  const yearOpen =
    kind === "annual" && Number(year) >= Number(currentMonth().slice(0, 4));
  const employeeMissing =
    kind === "annual" &&
    client.type === "MEI" &&
    typeof inputs?.had_employee !== "boolean";
  return {
    client,
    organization: office?.value || { name: "GB Soluções", crc: "RS-107227/0" },
    kind,
    period,
    rows,
    total: sum(rows.map((r) => r.amount)),
    commerce,
    services,
    missing,
    unclassified,
    unsupported,
    year_open: yearOpen,
    had_employee: inputs?.had_employee ?? null,
    employee_missing: employeeMissing,
    identity_missing: !client.cnpj,
    complete:
      !missing.length &&
      !unclassified.length &&
      !unsupported.length &&
      !yearOpen &&
      !employeeMissing &&
      !!client.cnpj,
  };
}
export async function queueRevenueReports(
  db: PoolClient,
  id: string,
  month: string,
  monthly = true,
) {
  // Serialize with approvals, contract updates and deletion. No binary is stored in PostgreSQL.
  await db.query("SELECT id FROM clients WHERE id=$1 FOR UPDATE", [id]);
  for (const kind of (monthly ? ["monthly", "annual"] : ["annual"]) as (
    | "monthly"
    | "annual"
  )[]) {
    const period = kind === "monthly" ? month : month.slice(0, 4),
      data = await snapshot(db, id, kind, period),
      source = hash(JSON.stringify(data));
    const [old] = (
      await db.query(
        "SELECT source_hash,revision FROM report_versions WHERE client_id=$1 AND kind=$2 AND period=$3 ORDER BY revision DESC LIMIT 1",
        [id, kind, period],
      )
    ).rows;
    if (old?.source_hash === source) continue;
    await db.query(
      "INSERT INTO report_versions(id,client_id,kind,period,revision,source_hash,snapshot) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        uid(),
        id,
        kind,
        period,
        (old?.revision || 0) + 1,
        source,
        JSON.stringify(data),
      ],
    );
  }
}
export async function reconcileReports() {
  const rows = await query(
    "SELECT r.client_id,r.month FROM revenues r JOIN clients c ON c.id=r.client_id WHERE NOT c.deletion_pending ORDER BY r.client_id,r.month",
  );
  for (const row of rows)
    await transaction((db) =>
      queueRevenueReports(db, row.client_id, row.month),
    );
}

export async function renderRevenuePdf(
  data: any,
  revision: number,
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 45, bottom: 65, left: 45, right: 45 },
    bufferPages: true,
    info: {
      Title:
        (data.kind === "monthly"
          ? "Declaração mensal de faturamento"
          : "Relatório anual de faturamento") +
        " — " +
        data.client.name,
      Author: "GB Soluções",
      Creator: "GB Soluções",
    },
  });
  const buffers: Buffer[] = [];
  doc.on("data", (b) => buffers.push(b));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(buffers)));
    doc.on("error", reject);
  });
  const brown = "#544437",
    muted = "#76685A";
  function text(value: string, size = 10, color = brown) {
    doc
      .font("Helvetica")
      .fontSize(size)
      .fillColor(color)
      .text(value, { lineGap: 3 });
  }
  function section(title: string) {
    doc.moveDown(0.7);
    doc.font("Helvetica-Bold").fontSize(12).fillColor(brown).text(title);
    doc.moveDown(0.4);
  }
  text(data.organization.name, 21);
  text("Gestão empresarial · CRC " + data.organization.crc, 9, muted);
  doc.moveDown();
  doc
    .font("Helvetica-Bold")
    .fontSize(17)
    .fillColor(brown)
    .text(
      data.kind === "monthly"
        ? "Declaração mensal de faturamento"
        : "Relatório anual de faturamento",
    );
  text(
    (data.kind === "monthly" ? "Competência: " : "Ano-calendário: ") +
      data.period +
      " · versão " +
      revision,
    10,
    muted,
  );
  if (!data.complete) {
    doc.moveDown(0.5);
    text(
      "PRÉVIA — existem conferências ou informações pendentes.",
      10,
      "#A4513B",
    );
  }
  section("Identificação");
  text(data.client.legal_name || data.client.name, 12);
  text(
    "CNPJ: " +
      (data.client.cnpj || "não informado") +
      " · Enquadramento: " +
      (data.client.type === "MEI" ? "MEI" : "ME / Simples Nacional"),
  );
  if (data.client.city)
    text(
      data.client.city + (data.client.state ? " / " + data.client.state : ""),
    );
  section("Receita bruta aprovada");
  for (const row of data.rows) {
    if (doc.y > 660) doc.addPage();
    const y = doc.y;
    doc
      .font("Helvetica")
      .fontSize(10)
      .fillColor(brown)
      .text(row.month, 45, y, { width: 170 });
    doc.text(row.amount === null ? "NÃO INFORMADA" : brl(row.amount), 230, y, {
      width: 250,
      align: "right",
    });
    doc.x = 45;
    doc.y = y + 21;
  }
  doc.moveDown(0.3);
  doc
    .font("Helvetica-Bold")
    .fontSize(13)
    .fillColor(brown)
    .text("Total aprovado: " + brl(data.total));
  section("Composição da receita");
  if (data.kind === "monthly" && data.rows[0]?.breakdown) {
    for (const key of revenueParts)
      text(labels[key] + ": " + brl(data.rows[0].breakdown[key]));
  } else {
    text("Comércio / indústria classificados: " + brl(data.commerce));
    text("Serviços classificados: " + brl(data.services));
  }
  if (data.unclassified.length)
    text(
      "Receitas com composição pendente: " + data.unclassified.join(", "),
      9,
      muted,
    );
  section("Documentos vinculados à apuração");
  const evidence = data.rows.flatMap((r: any) =>
    r.documents.map((d: any) => ({ ...d, month: r.month })),
  );
  if (!evidence.length)
    text(
      "Nenhum documento vinculado. Valores zerados representam ausência de movimento somente quando a apuração foi confirmada.",
      9,
      muted,
    );
  else
    for (const source of evidence) {
      if (doc.y > 675) doc.addPage();
      text(
        source.month + " · " + source.title + " (" + source.filename + ")",
        9,
      );
    }
  section("Conferências");
  if (data.missing.length)
    text(
      "Competências sem faturamento aprovado: " + data.missing.join(", "),
      9,
      "#A4513B",
    );
  if (data.unsupported.length)
    text(
      "Competências com receita e documentação pendente: " +
        data.unsupported.join(", "),
      9,
      "#A4513B",
    );
  if (data.year_open)
    text("Ano-calendário em andamento. Este consolidado é parcial.", 9, muted);
  if (data.kind === "annual" && data.client.type === "MEI")
    text(
      "Houve empregado no ano: " +
        (data.had_employee === null
          ? "a confirmar"
          : data.had_employee
            ? "sim"
            : "não"),
      10,
    );
  if (!data.client.cnpj)
    text(
      "Complete o CNPJ na ficha antes de usar este documento externamente.",
      9,
      muted,
    );
  text(
    data.kind === "annual"
      ? data.client.type === "MEI"
        ? "Documento de apoio ao preenchimento da DASN-SIMEI."
        : "Consolidado de faturamento para apoio à DEFIS. Outras informações contábeis, fiscais e societárias precisam ser conferidas no sistema oficial."
      : "Receita elaborada com base nos valores aprovados pela administração e nos documentos vinculados. Lançamentos pendentes ou rejeitados não compõem o total.",
    9,
    muted,
  );
  doc.moveDown();
  text(
    "Este relatório não representa declaração transmitida, recibo de entrega ou assinatura digital.",
    9,
    muted,
  );
  const range = doc.bufferedPageRange();
  for (let page = range.start; page < range.start + range.count; page++) {
    doc.switchToPage(page);
    const originalBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor(muted)
      .text(
        "GB Soluções · CRC RS-107227/0 · " +
          data.period +
          " · " +
          (page + 1) +
          "/" +
          range.count,
        45,
        810,
        { lineBreak: false },
      );
    doc.page.margins.bottom = originalBottom;
  }
  doc.end();
  return done;
}
let processing = false;
export async function processReportJobs() {
  if (processing) return;
  processing = true;
  try {
    await transaction(async (db) => {
      const jobs = (
        await db.query(
          "SELECT r.* FROM report_versions r JOIN clients c ON c.id=r.client_id WHERE r.storage_status='Pendente' AND r.next_attempt_at<=now() AND NOT c.deletion_pending ORDER BY r.created_at LIMIT 5 FOR UPDATE OF r SKIP LOCKED",
        )
      ).rows;
      for (const job of jobs) {
        const key = "reports/" + job.client_id + "/" + job.id + ".pdf";
        try {
          const pdf = await renderRevenuePdf(job.snapshot, job.revision);
          await objectStore().put(key, pdf, "application/pdf");
          await db.query(
            "UPDATE report_versions SET object_key=$2,storage_status='Publicado',storage_error=NULL,attempts=attempts+1 WHERE id=$1",
            [job.id, key],
          );
        } catch (error) {
          const message =
            error instanceof HttpError
              ? error.message
              : "Publicação em nuvem indisponível. O PDF continua disponível para download autenticado.";
          await db.query(
            "UPDATE report_versions SET storage_error=$2,attempts=attempts+1,next_attempt_at=now()+interval '15 minutes' WHERE id=$1",
            [job.id, message],
          );
        }
      }
    });
  } finally {
    processing = false;
  }
}

export const assessments = Router({ mergeParams: true });
const owner = (req: any) => idSchema.parse(req.params.id);
assessments.get("/:month", async (req, res) => {
  const id = owner(req),
    month = monthSchema.parse(req.params.month);
  const [r] = await query(
    "SELECT amount FROM revenues WHERE client_id=$1 AND month=$2",
    [id, month],
  );
  const [a] = await query(
    "SELECT * FROM revenue_assessments WHERE client_id=$1 AND month=$2",
    [id, month],
  );
  const documents = await query(
    "SELECT id,title,filename,month,category FROM documents WHERE client_id=$1 ORDER BY month DESC,created_at DESC",
    [id],
  );
  const selected = await query(
    "SELECT document_id FROM revenue_evidence WHERE client_id=$1 AND month=$2",
    [id, month],
  );
  const [annual] = await query(
    "SELECT had_employee FROM annual_inputs WHERE client_id=$1 AND year=$2",
    [id, Number(month.slice(0, 4))],
  );
  res.json({
    approved_amount: r?.amount ?? null,
    assessment: a ? { ...a, notes: decrypt(a.notes) } : null,
    documents,
    document_ids: selected.map((d) => d.document_id),
    had_employee: annual?.had_employee ?? null,
  });
});
const partSchema = z
  .object(
    Object.fromEntries(revenueParts.map((k) => [k, moneySchema])) as Record<
      (typeof revenueParts)[number],
      typeof moneySchema
    >,
  )
  .strict();
assessments.put("/:month", async (req, res) => {
  const id = owner(req),
    month = monthSchema.parse(req.params.month);
  if (month > currentMonth())
    fail(
      400,
      "A apuração deve ser da competência atual ou de um mês anterior.",
    );
  const d = z
    .object({
      parts: partSchema,
      document_ids: z.array(idSchema).max(100).default([]),
      notes: z.string().max(1000).default(""),
      had_employee: z.boolean().nullable().optional(),
    })
    .strict()
    .parse(req.body);
  const amount = sum(revenueParts.map((k) => d.parts[k]));
  await transaction(async (db) => {
    const [c] = (
      await db.query(
        "SELECT id FROM clients WHERE id=$1 AND NOT deletion_pending FOR UPDATE",
        [id],
      )
    ).rows;
    if (!c) fail(404, "Cliente não encontrado.");
    const ids = [...new Set(d.document_ids)];
    if (ids.length) {
      const owned = (
        await db.query(
          "SELECT id FROM documents WHERE client_id=$1 AND id=ANY($2::uuid[])",
          [id, ids],
        )
      ).rows;
      if (owned.length !== ids.length)
        fail(
          400,
          "Os documentos da apuração precisam pertencer ao mesmo cliente.",
        );
    }
    await db.query(
      "INSERT INTO revenues VALUES($1,$2,$3,now()) ON CONFLICT(client_id,month) DO UPDATE SET amount=excluded.amount,updated_at=now()",
      [id, month, amount],
    );
    await db.query(
      "INSERT INTO revenue_assessments(client_id,month," +
        revenueParts.join(",") +
        ",total,notes,assessed_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(client_id,month) DO UPDATE SET " +
        revenueParts.map((k) => k + "=excluded." + k).join(",") +
        ",total=excluded.total,notes=excluded.notes,assessed_by=excluded.assessed_by,assessed_at=now()",
      [
        id,
        month,
        ...revenueParts.map((k) => d.parts[k]),
        amount,
        encrypt(d.notes),
        req.auth!.user!.id,
      ],
    );
    await db.query(
      "DELETE FROM revenue_evidence WHERE client_id=$1 AND month=$2",
      [id, month],
    );
    for (const docId of ids)
      await db.query("INSERT INTO revenue_evidence VALUES($1,$2,$3)", [
        id,
        month,
        docId,
      ]);
    if (d.had_employee !== undefined)
      await db.query(
        "INSERT INTO annual_inputs VALUES($1,$2,$3) ON CONFLICT(client_id,year) DO UPDATE SET had_employee=excluded.had_employee",
        [id, Number(month.slice(0, 4)), d.had_employee],
      );
    await db.query(
      "INSERT INTO revenue_reviews(id,client_id,month,amount,approved_amount,status,submitted_by,reviewed_by,reviewed_at) VALUES($1,$2,$3,$4,$4,'Aprovado',$5,$5,now())",
      [uid(), id, month, amount, req.auth!.user!.id],
    );
    await queueRevenueReports(db, id, month);
  });
  await audit(req, "apuracao.concluida", "cliente", id, { month });
  res.json({ ok: true, amount });
});

export const reports = Router();
reports.get("/", async (req, res) => {
  const actor = req.auth!.user!,
    id =
      actor.role === "admin"
        ? req.query.client_id
          ? idSchema.parse(req.query.client_id)
          : null
        : actor.client_id;
  const rows = await query(
    "SELECT DISTINCT ON(r.client_id,r.kind,r.period) r.id,r.client_id,r.kind,r.period,r.revision,r.created_at,r.snapshot,r.storage_status,r.storage_error,c.name client_name FROM report_versions r JOIN clients c ON c.id=r.client_id " +
      (id ? "WHERE r.client_id=$1" : "") +
      " ORDER BY r.client_id,r.kind,r.period,r.revision DESC",
    id ? [id] : [],
  );
  await audit(req, "relatorios.lista", "cliente", id || undefined);
  res.json(
    rows.map((r) => ({
      ...r,
      snapshot: undefined,
      total: r.snapshot.total,
      complete: r.snapshot.complete,
      missing: r.snapshot.missing,
      unclassified: r.snapshot.unclassified,
      unsupported: r.snapshot.unsupported,
      year_open: r.snapshot.year_open,
      employee_missing: r.snapshot.employee_missing,
      identity_missing: r.snapshot.identity_missing,
    })),
  );
});
reports.get("/:reportId/download", async (req, res) => {
  const id = idSchema.parse(req.params.reportId);
  const [row] = await query("SELECT * FROM report_versions WHERE id=$1", [id]);
  if (!row) fail(404, "Relatório não encontrado.");
  clientScope(req, row.client_id);
  const buffer = await renderRevenuePdf(row.snapshot, row.revision);
  await audit(req, "relatorio.download", "relatorio", id);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${row.kind === "monthly" ? "Faturamento_mensal" : "Relatorio_anual"}_${row.period}_v${row.revision}.pdf"`,
  );
  res.send(buffer);
});
reports.post("/atualizar", async (req, res) => {
  if (req.auth!.user!.role !== "admin")
    fail(403, "Apenas a gestora pode atualizar apurações e relatórios.");
  const d = z
    .object({ client_id: idSchema, year: yearSchema })
    .strict()
    .parse(req.body);
  await transaction(async (db) => {
    const rows = (
      await db.query(
        "SELECT month FROM revenues WHERE client_id=$1 AND left(month,4)=$2 ORDER BY month",
        [d.client_id, String(d.year)],
      )
    ).rows;
    for (const row of rows)
      await queueRevenueReports(db, d.client_id, row.month);
    await db.query(
      "UPDATE report_versions SET next_attempt_at=now(),storage_error=NULL WHERE client_id=$1 AND left(period,4)=$2 AND storage_status='Pendente'",
      [d.client_id, String(d.year)],
    );
  });
  await audit(req, "relatorios.atualizados", "cliente", d.client_id, {
    year: d.year,
  });
  res.json({ ok: true });
});
