import { Router } from "express";
import { pipeline } from "node:stream/promises";
import multer from "multer";
import { fileTypeFromBuffer } from "file-type";
import { z } from "zod";
import { query, uid } from "./db.js";
import { encrypt, decrypt } from "./crypto.js";
import { idSchema, monthSchema } from "./data.js";
import { audit, clientScope, fail, HttpError } from "./security.js";
import { objectStore } from "./storage.js";
export const documents = Router();
let uploadsInFlight = 0;
documents.use((req, res, next) => {
  if (req.method !== "POST") return next();
  if (uploadsInFlight >= 4)
    return next(
      new HttpError(
        429,
        "Há envios em andamento. Tente novamente em instantes.",
      ),
    );
  uploadsInFlight++;
  let released = false;
  const release = () => {
    if (!released) {
      released = true;
      uploadsInFlight--;
    }
  };
  res.once("finish", release);
  res.once("close", release);
  next();
});
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 8 },
});
const category = z.enum([
  "Guias",
  "Relatórios",
  "Declarações",
  "Cadastro",
  "Extratos",
  "Outros",
]);
export async function validateFile(file: Express.Multer.File) {
  const ext = file.originalname.split(".").pop()?.toLowerCase();
  const known = await fileTypeFromBuffer(file.buffer);
  const types: Record<string, string> = {
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
  };
  if (ext && types[ext] && known?.mime === types[ext]) return types[ext];
  if (ext === "ofx" || ext === "csv") {
    const text = file.buffer.toString("utf8");
    if (
      !text.includes("\0") &&
      !/<(?:script|html|iframe)\b/i.test(text) &&
      ((ext === "ofx" && /<OFX[\s>]/i.test(text)) ||
        (ext === "csv" && /[;,\t]/.test(text) && /[\r\n]/.test(text)))
    )
      return ext === "csv" ? "text/csv" : "application/x-ofx";
  }
  fail(400, "Conteúdo ou formato inválido. Envie PDF, OFX, CSV, JPEG ou PNG.");
}
documents.get("/", async (req, res) => {
  const actor = req.auth!.user!;
  const id =
    actor.role === "admin"
      ? req.query.client_id
        ? idSchema.parse(req.query.client_id)
        : null
      : actor.client_id;
  const rows = await query(
    "SELECT d.*,c.name client_name FROM documents d JOIN clients c ON c.id=d.client_id " +
      (id ? "WHERE d.client_id=$1" : "") +
      " ORDER BY d.created_at DESC LIMIT 500",
    id ? [id] : [],
  );
  await audit(req, "documentos.lista", "documento", id || undefined);
  res.json(
    rows.map(({ object_key, ...d }) => ({ ...d, account: decrypt(d.account) })),
  );
});
documents.post("/", upload.single("file"), async (req, res) => {
  const actor = req.auth!.user!;
  const d = z
    .object({
      client_id: idSchema.optional(),
      title: z.string().trim().min(1).max(120),
      category,
      month: monthSchema,
      account: z.string().max(80).default(""),
    })
    .strict()
    .parse(req.body);
  const id = actor.role === "admin" ? d.client_id : actor.client_id;
  if (!id) fail(400, "Selecione um cliente.");
  if (
    actor.role === "cliente" &&
    ((d.client_id && d.client_id !== id) || d.category !== "Extratos")
  )
    fail(403, "Envio não permitido.");
  clientScope(req, id);
  const [client] = await query(
    "SELECT id FROM clients WHERE id=$1 AND active AND NOT deletion_pending",
    [id],
  );
  if (!client) fail(404, "Cliente indisponível.");
  const file = req.file;
  if (!file) fail(400, "Selecione um arquivo.");
  const mime = await validateFile(file);
  const docId = uid(),
    key = `clients/${id}/${docId}`;
  const store = objectStore();
  await store.put(key, file.buffer, mime);
  try {
    await query(
      "INSERT INTO documents(id,client_id,title,filename,object_key,mime,size,category,month,account,uploaded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
      [
        docId,
        id,
        d.title,
        file.originalname.replace(/[\r\n\\/]/g, "_").slice(0, 200),
        key,
        mime,
        file.size,
        d.category,
        d.month,
        encrypt(d.account),
        actor.id,
      ],
    );
  } catch (e) {
    await store.remove(key);
    throw e;
  }
  await audit(req, "documento.enviado", "documento", docId, {
    category: d.category,
  });
  res.status(201).json({ id: docId });
});
documents.get("/:id/download", async (req, res) => {
  const [doc] = await query("SELECT * FROM documents WHERE id=$1", [
    idSchema.parse(req.params.id),
  ]);
  if (!doc) fail(404, "Documento não encontrado.");
  clientScope(req, doc.client_id);
  const store = objectStore();
  await audit(req, "documento.download", "documento", doc.id);
  res.setHeader("Content-Type", doc.mime);
  res.setHeader(
    "Content-Disposition",
    `attachment; filename*=UTF-8''${encodeURIComponent(doc.filename)}`,
  );
  res.setHeader("Cache-Control", "private,no-store");
  await pipeline(store.get(doc.object_key), res);
});
documents.delete("/:id", async (req, res) => {
  if (req.auth!.user!.role !== "admin")
    fail(403, "Apenas a administração pode excluir documentos.");
  const [doc] = await query("SELECT * FROM documents WHERE id=$1", [
    idSchema.parse(req.params.id),
  ]);
  if (!doc) fail(404, "Documento não encontrado.");
  await objectStore().remove(doc.object_key);
  await query("DELETE FROM documents WHERE id=$1", [doc.id]);
  await audit(req, "documento.excluido", "documento", doc.id);
  res.json({ ok: true });
});
export async function deleteClient(req: any, res: any) {
  const id = idSchema.parse(req.params.id);
  z.object({ confirmation: z.literal("EXCLUIR") })
    .strict()
    .parse(req.body);
  const [c] = await query(
    "UPDATE clients SET deletion_pending=true,active=false WHERE id=$1 RETURNING id",
    [id],
  );
  if (!c) fail(404, "Cliente não encontrado.");
  await query(
    "DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE client_id=$1)",
    [id],
  );
  const docs = await query(
    "SELECT object_key FROM documents WHERE client_id=$1 UNION ALL SELECT object_key FROM client_certificates WHERE client_id=$1 UNION ALL SELECT object_key FROM report_versions WHERE client_id=$1 AND object_key IS NOT NULL",
    [id],
  );
  if (docs.length) {
    const store = objectStore();
    try {
      for (const doc of docs) await store.remove(doc.object_key);
    } catch {
      fail(
        503,
        "Exclusão de arquivos pendente. Acesso revogado; tente excluir novamente para concluir.",
      );
    }
  }
  await audit(req, "cliente.excluido", "cliente", id);
  await query("DELETE FROM clients WHERE id=$1", [id]);
  res.json({ ok: true });
}
