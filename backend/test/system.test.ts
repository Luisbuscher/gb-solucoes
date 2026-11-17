import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import dotenv from "dotenv";
import request from "supertest";
import { Readable } from "node:stream";
import argon2 from "argon2";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
dotenv.config({ quiet: true });
process.env.NODE_ENV = "test";
process.env.DB_NAME = "gastomensal_test";
process.env.RUNNING_IN_DOCKER = "false";
process.env.RESEND_API_KEY = "";
process.env.GCS_BUCKET_NAME = "";
process.env.GCS_SERVICE_ACCOUNT_JSON = "";
process.env.GCS_SERVICE_ACCOUNT_FILE = "";
const { createApp } = await import("../src/app.js");
const { pool, query, migrate, uid } = await import("../src/db.js");
const { seed, passwordOptions } = await import("../src/seed.js");
const { decrypt, hash, token } = await import("../src/crypto.js");
const { setTestStore } = await import("../src/storage.js");
const { indicators } = await import("../src/rules.js");
const { config } = await import("../src/config.js");
const { setTestMailTransport, deliverMail, issueToken } = await import(
  "../src/mail.js"
);
const { processReportJobs, reconcileReports } = await import(
  "../src/reports.js"
);
const app = createApp(),
  admin = request.agent(app),
  a = request.agent(app),
  b = request.agent(app),
  anon = request.agent(app);
let adminCsrf = "",
  aCsrf = "",
  bCsrf = "",
  anonCsrf = "",
  aId = "",
  bId = "",
  aUser = "",
  docId = "",
  reviewId = "",
  orderId = "";
const password = "Uma-senha-de-teste-muito-forte!";
const headers = (csrf: string) => ({
  Origin: config.APP_URL,
  "X-CSRF-Token": csrf,
});
const store = new Map<string, Buffer>();
let certificateDir = "";
before(async () => {
  assert.equal(process.env.DB_NAME, "gastomensal_test");
  await migrate();
  await query(
    "TRUNCATE clients,users,sessions,auth_tokens,security_limits,audit_events,mail_outbox,service_versions,plan_versions RESTART IDENTITY CASCADE",
  );
  await seed();
  adminCsrf = (await admin.get("/api/auth/session")).body.csrf;
  anonCsrf = (await anon.get("/api/auth/session")).body.csrf;
  const login = await admin
    .post("/api/auth/login")
    .set(headers(adminCsrf))
    .send({ email: config.ADMIN_EMAIL, password: config.ADMIN_PASSWORD });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  adminCsrf = login.body.csrf;
  for (const name of ["Cliente A", "Cliente B"]) {
    const res = await admin
      .post("/api/admin/clientes")
      .set(headers(adminCsrf))
      .send({
        name,
        email: name === "Cliente A" ? "a@example.test" : "b@example.test",
        type: "MEI",
        activity: "servicos",
        partners: 0,
        since_month: "2026-01",
        opening_month: "2026-01",
        plan: "MEI Growth",
        amount: "290.00",
        effective: "2026-01",
        notes: "Observação interna privada",
      });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    if (name === "Cliente A") aId = res.body.id;
    else bId = res.body.id;
  }
  for (const [clientId, email, agent] of [
    [aId, "a@example.test", a],
    [bId, "b@example.test", b],
  ] as const) {
    const userId = uid();
    await query(
      "INSERT INTO users(id,email,name,password_hash,role,client_id) VALUES($1,$2,'Cliente de teste',$3,'cliente',$4)",
      [userId, email, await argon2.hash(password, passwordOptions), clientId],
    );
    if (clientId === aId) aUser = userId;
    const csrf = (await agent.get("/api/auth/session")).body.csrf;
    const res = await agent
      .post("/api/auth/login")
      .set(headers(csrf))
      .send({ email, password });
    assert.equal(res.status, 200);
    if (clientId === aId) aCsrf = res.body.csrf;
    else bCsrf = res.body.csrf;
  }
});
after(async () => {
  await pool.end();
  if (certificateDir) {
    assert.ok(
      path
        .resolve(certificateDir)
        .startsWith(path.resolve(os.tmpdir()) + path.sep),
    );
    await fs.rm(certificateDir, { recursive: true, force: true });
  }
});
test("sessão usa cookie HttpOnly e SameSite; senha usa Argon2id", async () => {
  const fresh = request.agent(app);
  const res = await fresh.get("/api/auth/session");
  assert.match(res.headers["set-cookie"][0], /HttpOnly/);
  assert.match(res.headers["set-cookie"][0], /SameSite=Lax/);
  const [u] = await query("SELECT password_hash FROM users WHERE id=$1", [
    aUser,
  ]);
  assert.match(u.password_hash, /^\$argon2id\$/);
  assert.notEqual(u.password_hash, password);
});
test("CSRF ausente ou origem externa é recusado", async () => {
  assert.equal((await admin.post("/api/admin/pedidos").send({})).status, 403);
  assert.equal(
    (
      await admin
        .post("/api/admin/pedidos")
        .set({ ...headers(adminCsrf), Origin: "https://evil.example" })
        .send({})
    ).status,
    403,
  );
});
test("anônimo não lê clientes; cliente não acessa administração", async () => {
  assert.equal((await anon.get("/api/admin/clientes")).status, 401);
  assert.equal((await a.get("/api/admin/clientes")).status, 403);
  assert.equal(
    (
      await a
        .patch("/api/admin/clientes/" + bId)
        .set(headers(aCsrf))
        .send({ name: "Invadido" })
    ).status,
    403,
  );
});
test("portal ignora IDs manipulados e não expõe observações internas", async () => {
  const res = await a.get("/api/me?client_id=" + bId + "&month=2026-11");
  assert.equal(res.body.id, aId);
  assert.equal(res.body.notes, undefined);
  assert.equal(res.body.onboarding, undefined);
  const [stored] = await query("SELECT notes FROM clients WHERE id=$1", [aId]);
  assert.notEqual(stored.notes, "Observação interna privada");
  assert.equal(decrypt(stored.notes), "Observação interna privada");
});
test("atualizações concorrentes de tarefas preservam chaves e meses", async () => {
  for (const month of ["2026-10", "2026-11"]) {
    const responses = await Promise.all(
      ["das", "dados", "conc"].map((k) =>
        admin
          .patch(`/api/admin/clientes/${aId}/competencias/${month}`)
          .set(headers(adminCsrf))
          .send({ tasks: { [k]: true } }),
      ),
    );
    responses.forEach((r) => assert.equal(r.status, 200));
  }
  const rows = await query(
    "SELECT tasks FROM monthly_tasks WHERE client_id=$1 ORDER BY month",
    [aId],
  );
  assert.equal(rows.length, 2);
  for (const r of rows)
    assert.deepEqual(r.tasks, { das: true, dados: true, conc: true });
});
test("zero de faturamento é válido e envio cliente aguarda revisão", async () => {
  let res = await admin
    .post(`/api/admin/clientes/${aId}/faturamentos`)
    .set(headers(adminCsrf))
    .send({ month: "2026-11", amount: "0.00" });
  assert.equal(res.status, 200);
  res = await a
    .post("/api/me/faturamentos")
    .set(headers(aCsrf))
    .send({ month: "2026-11", amount: "8100.15" });
  assert.equal(res.status, 201);
  reviewId = res.body.id;
  const [official] = await query(
    "SELECT amount FROM revenues WHERE client_id=$1 AND month=$2",
    [aId, "2026-11"],
  );
  assert.equal(official.amount, "0.00");
});
test("gestora corrige e aprova; revisão não pode ser consumida duas vezes", async () => {
  const route = "/api/admin/faturamentos/revisoes/" + reviewId;
  assert.equal(
    (
      await admin
        .patch(route)
        .set(headers(adminCsrf))
        .send({ status: "Aprovado", amount: "7900.25", reason: "Conferido" })
    ).status,
    200,
  );
  assert.equal(
    (
      await admin
        .patch(route)
        .set(headers(adminCsrf))
        .send({ status: "Aprovado" })
    ).status,
    409,
  );
  const [official] = await query(
    "SELECT amount FROM revenues WHERE client_id=$1 AND month=$2",
    [aId, "2026-11"],
  );
  assert.equal(official.amount, "7900.25");
});
test("reenvio e rejeição preservam último valor aprovado", async () => {
  const pending = await a
    .post("/api/me/faturamentos")
    .set(headers(aCsrf))
    .send({ month: "2026-11", amount: "9999" });
  assert.equal(pending.status, 201);
  await admin
    .patch("/api/admin/faturamentos/revisoes/" + pending.body.id)
    .set(headers(adminCsrf))
    .send({ status: "Rejeitado", reason: "Revisar extrato" })
    .expect(200);
  const [official] = await query(
    "SELECT amount FROM revenues WHERE client_id=$1 AND month=$2",
    [aId, "2026-11"],
  );
  assert.equal(official.amount, "7900.25");
  assert.equal((await b.get("/api/me/faturamentos")).body.length, 0);
});
test("honorários anteriores e pagamentos confirmados são preservados", async () => {
  await admin.get("/api/admin/honorarios?month=2026-10").expect(200);
  await admin.get("/api/admin/honorarios?month=2026-11").expect(200);
  await admin
    .patch(`/api/admin/honorarios/${aId}/2026-11`)
    .set(headers(adminCsrf))
    .send({ paid: true })
    .expect(200);
  const res = await admin
    .post(`/api/admin/clientes/${aId}/contratos`)
    .set(headers(adminCsrf))
    .send({ effective: "2026-11", plan: "MEI Growth", amount: "350.00" });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  await admin.get("/api/admin/honorarios?month=2026-12").expect(200);
  const fees = await query(
    "SELECT month,amount FROM fees WHERE client_id=$1 ORDER BY month",
    [aId],
  );
  assert.deepEqual(fees, [
    { month: "2026-10", amount: "290.00" },
    { month: "2026-11", amount: "290.00" },
    { month: "2026-12", amount: "350.00" },
  ]);
});
test("pedido público é interessado e não é associado por e-mail", async () => {
  const res = await anon
    .post("/api/public/pedidos")
    .set(headers(anonCsrf))
    .send({
      name: "Cliente A",
      email: "a@example.test",
      service_code: "nota",
      details: "<script>alert(1)</script>",
    });
  assert.equal(res.status, 201);
  orderId = res.body.id;
  const [p] = await query("SELECT * FROM orders WHERE id=$1", [orderId]);
  assert.equal(p.client_id, null);
  assert.notEqual(p.details, "<script>alert(1)</script>");
  assert.equal((await a.get("/api/me/pedidos")).body.length, 0);
});
test("vínculo manual e cópia histórica de preço do pedido", async () => {
  await admin
    .patch("/api/admin/pedidos/" + orderId)
    .set(headers(adminCsrf))
    .send({ client_id: aId, status: "Em andamento", amount: "35" })
    .expect(200);
  const list = await a.get("/api/me/pedidos");
  assert.equal(list.body[0].id, orderId);
  assert.equal((await b.get("/api/me/pedidos")).body.length, 0);
  await admin
    .put("/api/admin/configuracoes/servicos")
    .set(headers(adminCsrf))
    .send({
      code: "nota",
      effective: "2026-11",
      category: "MEI",
      name: "Emissão de nota fiscal",
      description: "Nova tabela",
      price_label: "R$ 50",
      amount: "50",
    })
    .expect(200);
  const [p] = await query(
    "SELECT price_label,reference_amount FROM orders WHERE id=$1",
    [orderId],
  );
  assert.equal(p.reference_amount, "35.00");
});
test("upload sem GCS configurado não apresenta sucesso", async () => {
  const res = await a
    .post("/api/documentos")
    .set(headers(aCsrf))
    .field("title", "Extrato")
    .field("category", "Extratos")
    .field("month", "2026-11")
    .attach(
      "file",
      Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF"),
      "extrato.pdf",
    );
  assert.equal(res.status, 503, JSON.stringify(res.body));
});
test("upload valida conteúdo e limite de tamanho", async () => {
  for (const [data, name] of [
    [Buffer.from("<script>alert(1)</script>"), "extrato.pdf"],
    [Buffer.alloc(10 * 1024 * 1024 + 1), "grande.pdf"],
  ] as const) {
    const res = await a
      .post("/api/documentos")
      .set(headers(aCsrf))
      .field("title", "Arquivo")
      .field("category", "Extratos")
      .field("month", "2026-11")
      .attach("file", data, name);
    assert.equal(res.status, 400);
  }
});
test("upload e download autenticado; outro cliente não acessa documento", async () => {
  setTestStore({
    async put(key, b) {
      store.set(key, b);
    },
    get(key) {
      return Readable.from(store.get(key)!);
    },
    async remove(key) {
      store.delete(key);
    },
  });
  const res = await a
    .post("/api/documentos")
    .set(headers(aCsrf))
    .field("title", "Extrato de novembro")
    .field("category", "Extratos")
    .field("month", "2026-11")
    .field("account", "Conta PJ")
    .attach(
      "file",
      Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF"),
      "extrato.pdf",
    );
  assert.equal(res.status, 201);
  docId = res.body.id;
  await a.get("/api/documentos/" + docId + "/download").expect(200);
  await b.get("/api/documentos/" + docId + "/download").expect(404);
  await anon.get("/api/documentos/" + docId + "/download").expect(401);
  assert.equal(
    (await b.get("/api/documentos?client_id=" + aId)).body.length,
    0,
  );
  await a
    .delete("/api/documentos/" + docId)
    .set(headers(aCsrf))
    .expect(403);
});
test("administrador primário não pode ser desativado ou recuperado", async () => {
  const [u] = await query("SELECT id FROM users WHERE primary_admin");
  await admin
    .patch("/api/admin/usuarios/" + u.id)
    .set(headers(adminCsrf))
    .send({ active: false })
    .expect(400);
  await anon
    .post("/api/auth/recuperar")
    .set(headers(anonCsrf))
    .send({ email: config.ADMIN_EMAIL })
    .expect(200);
  assert.equal(
    (await query("SELECT * FROM auth_tokens WHERE user_id=$1", [u.id])).length,
    0,
  );
});
test("convites pendentes, token expirado e token de uso único", async () => {
  const invited = await admin
    .post("/api/admin/usuarios")
    .set(headers(adminCsrf))
    .send({
      email: "convite@example.test",
      name: "Novo acesso",
      role: "admin",
      client_id: null,
    });
  assert.equal(invited.status, 201);
  assert.equal(invited.body.status, "Pendente");
  const [mail] = await query(
    "SELECT payload FROM mail_outbox WHERE user_id=$1",
    [invited.body.id],
  );
  const value = JSON.parse(decrypt(mail.payload)).text.match(
    /#([a-f0-9]{64})/,
  )[1];
  const expired = token();
  await query(
    "INSERT INTO auth_tokens(id,user_id,token_hash,kind,expires_at) VALUES($1,$2,$3,'reset',now()-interval '1 minute')",
    [uid(), invited.body.id, hash(expired)],
  );
  await anon
    .post("/api/auth/definir-senha")
    .set(headers(anonCsrf))
    .send({ token: expired, password })
    .expect(400);
  await anon
    .post("/api/auth/definir-senha")
    .set(headers(anonCsrf))
    .send({ token: value, password })
    .expect(200);
  await anon
    .post("/api/auth/definir-senha")
    .set(headers(anonCsrf))
    .send({ token: value, password })
    .expect(400);
});
test("recuperação de senha revoga sessões já abertas", async () => {
  const res = await anon
    .post("/api/auth/recuperar")
    .set(headers(anonCsrf))
    .send({ email: "b@example.test" });
  assert.equal(res.status, 200);
  const [mail] = await query(
    "SELECT payload FROM mail_outbox WHERE user_id=(SELECT id FROM users WHERE email=$1) ORDER BY created_at DESC LIMIT 1",
    ["b@example.test"],
  );
  const value = JSON.parse(decrypt(mail.payload)).text.match(
    /#([a-f0-9]{64})/,
  )[1];
  await anon
    .post("/api/auth/definir-senha")
    .set(headers(anonCsrf))
    .send({ token: value, password: password + "2" })
    .expect(200);
  await b.get("/api/me").expect(401);
});
test("limite de tentativas de login por conta", async () => {
  for (let i = 0; i < 5; i++)
    await anon
      .post("/api/auth/login")
      .set(headers(anonCsrf))
      .send({ email: "inexistente@example.test", password: "errada" })
      .expect(401);
  await anon
    .post("/api/auth/login")
    .set(headers(anonCsrf))
    .send({ email: "inexistente@example.test", password: "errada" })
    .expect(429);
});
test("cofre exige perfil admin e nova confirmação de senha por cliente", async () => {
  await a.get("/api/admin/clientes/" + aId + "/cofre").expect(403);
  await admin
    .post("/api/admin/clientes/" + aId + "/cofre/credenciais")
    .set(headers(adminCsrf))
    .send({ label: "Prefeitura", kind: "prefeitura", password: "segredo" })
    .expect(403);
  await admin
    .post("/api/admin/clientes/" + aId + "/cofre/desbloquear")
    .set(headers(adminCsrf))
    .send({ password: "incorreta" })
    .expect(403);
  await admin
    .post("/api/admin/clientes/" + aId + "/cofre/desbloquear")
    .set(headers(adminCsrf))
    .send({ password: config.ADMIN_PASSWORD })
    .expect(200);
  await admin
    .post("/api/admin/clientes/" + bId + "/cofre/credenciais")
    .set(headers(adminCsrf))
    .send({ label: "Outro", kind: "outro" })
    .expect(403);
});
test("credenciais do cofre não aparecem nas listagens, ficha ou auditoria", async () => {
  const entry = await admin
    .post("/api/admin/clientes/" + aId + "/cofre/credenciais")
    .set(headers(adminCsrf))
    .send({
      label: "Prefeitura",
      kind: "prefeitura",
      url: "https://prefeitura.example.test",
      login: "contribuinte",
      password: "senha-privada-exemplo",
      access_code: "codigo-privado-exemplo",
    })
    .expect(201);
  const id = entry.body.id;
  const list = await admin.get("/api/admin/clientes/" + aId + "/cofre");
  assert.equal(
    JSON.stringify(list.body).includes("senha-privada-exemplo"),
    false,
  );
  const detail = await admin.get("/api/admin/clientes/" + aId);
  assert.equal(
    JSON.stringify(detail.body).includes("codigo-privado-exemplo"),
    false,
  );
  const [row] = await query(
    "SELECT secret_payload FROM client_credentials WHERE id=$1",
    [id],
  );
  assert.equal(row.secret_payload.includes("senha-privada-exemplo"), false);
  const reveal = await admin
    .post(`/api/admin/clientes/${aId}/cofre/credenciais/${id}/revelar`)
    .set(headers(adminCsrf))
    .expect(200);
  assert.equal(reveal.body.password, "senha-privada-exemplo");
  await admin
    .post("/api/admin/clientes/" + bId + "/cofre/desbloquear")
    .set(headers(adminCsrf))
    .send({ password: config.ADMIN_PASSWORD })
    .expect(200);
  await admin
    .post(`/api/admin/clientes/${bId}/cofre/credenciais/${id}/revelar`)
    .set(headers(adminCsrf))
    .expect(404);
  const audits = await query(
    "SELECT metadata FROM audit_events WHERE action LIKE 'cofre.%'",
  );
  assert.equal(JSON.stringify(audits).includes("senha-privada-exemplo"), false);
  await query(
    "UPDATE vault_grants SET expires_at=now()-interval '1 minute' WHERE client_id=$1",
    [aId],
  );
  await admin
    .post(`/api/admin/clientes/${aId}/cofre/credenciais/${id}/revelar`)
    .set(headers(adminCsrf))
    .expect(403);
});
test("certificado A1 é validado, cifrado no GCS e recuperado sem alteração", async () => {
  certificateDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "gb-solucoes-cert-test-"),
  );
  const openssl =
    process.env.OPENSSL_BIN ||
    (process.platform === "win32"
      ? "C:/Program Files/Git/usr/bin/openssl.exe"
      : "openssl");
  const key = path.join(certificateDir, "key.pem"),
    cert = path.join(certificateDir, "cert.pem"),
    pfx = path.join(certificateDir, "cert.pfx");
  execFileSync(
    openssl,
    [
      "req",
      "-newkey",
      "rsa:2048",
      "-x509",
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=GB Teste",
      "-keyout",
      key,
      "-out",
      cert,
    ],
    { stdio: "ignore", windowsHide: true },
  );
  execFileSync(
    openssl,
    [
      "pkcs12",
      "-export",
      "-inkey",
      key,
      "-in",
      cert,
      "-out",
      pfx,
      "-passout",
      "env:GB_TEST_PFX_PASSWORD",
    ],
    {
      stdio: "ignore",
      windowsHide: true,
      env: { ...process.env, GB_TEST_PFX_PASSWORD: "senha-certificado-teste" },
    },
  );
  const original = await fs.readFile(pfx);
  await admin
    .post("/api/admin/clientes/" + aId + "/cofre/desbloquear")
    .set(headers(adminCsrf))
    .send({ password: config.ADMIN_PASSWORD })
    .expect(200);
  await admin
    .post("/api/admin/clientes/" + aId + "/cofre/certificados")
    .set(headers(adminCsrf))
    .field("label", "Certificado teste")
    .field("password", "errada")
    .attach("file", original, "teste.pfx")
    .expect(400);
  const uploaded = await admin
    .post("/api/admin/clientes/" + aId + "/cofre/certificados")
    .set(headers(adminCsrf))
    .field("label", "Certificado teste")
    .field("password", "senha-certificado-teste")
    .attach("file", original, "teste.pfx")
    .expect(201);
  const id = uploaded.body.id;
  const [record] = await query(
    "SELECT * FROM client_certificates WHERE id=$1",
    [id],
  );
  assert.ok(store.has(record.object_key));
  assert.equal(store.get(record.object_key)!.equals(original), false);
  assert.equal(
    record.secret_payload.includes("senha-certificado-teste"),
    false,
  );
  const downloaded = await admin
    .post(`/api/admin/clientes/${aId}/cofre/certificados/${id}/download`)
    .set(headers(adminCsrf))
    .buffer(true)
    .parse((res: any, done: any) => {
      const buffers: Buffer[] = [];
      res.on("data", (b: Buffer) => buffers.push(b));
      res.on("end", () => done(null, Buffer.concat(buffers)));
    })
    .expect(200);
  assert.ok(downloaded.body.equals(original));
  await a
    .post(`/api/admin/clientes/${aId}/cofre/certificados/${id}/download`)
    .set(headers(aCsrf))
    .expect(403);
  await admin
    .delete(`/api/admin/clientes/${aId}/cofre/certificados/${id}`)
    .set(headers(adminCsrf))
    .expect(200);
  assert.equal(store.has(record.object_key), false);
});
test("Kanban persiste coluna, posição e recusa movimento com versão antiga", async () => {
  const [old] = await query("SELECT board_revision FROM orders WHERE id=$1", [
    orderId,
  ]);
  await admin
    .post("/api/admin/pedidos/" + orderId + "/mover")
    .set(headers(adminCsrf))
    .send({ status: "Concluída", expected_revision: old.board_revision })
    .expect(200);
  const [updated] = await query(
    "SELECT status,board_position,board_revision FROM orders WHERE id=$1",
    [orderId],
  );
  assert.equal(updated.status, "Concluída");
  assert.equal(updated.board_position, 0);
  await admin
    .post("/api/admin/pedidos/" + orderId + "/mover")
    .set(headers(adminCsrf))
    .send({ status: "Cobrada", expected_revision: old.board_revision })
    .expect(409);
  await a
    .post("/api/admin/pedidos/" + orderId + "/mover")
    .set(headers(aCsrf))
    .send({ status: "Cobrada", expected_revision: updated.board_revision })
    .expect(403);
});
test("aprovação gera relatórios sem usar valores pendentes ou preencher meses ausentes com zero", async () => {
  const list = await a.get("/api/relatorios?client_id=" + bId).expect(200);
  assert.ok(
    list.body.some((r: any) => r.period === "2026-11" && r.total === "7900.25"),
  );
  const annual = list.body.find((r: any) => r.kind === "annual");
  assert.ok(annual.missing.includes("2026-01"));
  assert.equal(annual.complete, false);
  const monthly = list.body.find((r: any) => r.kind === "monthly");
  const [report] = await query(
    "SELECT snapshot FROM report_versions WHERE id=$1",
    [monthly.id],
  );
  assert.equal(report.snapshot.total, "7900.25");
  assert.equal(report.snapshot.rows[0].amount, "7900.25");
  assert.equal(report.snapshot.rows[0].breakdown, null);
  await b.get("/api/relatorios/" + monthly.id + "/download").expect(401);
  const stranger = request.agent(app);
  let csrf = (await stranger.get("/api/auth/session")).body.csrf;
  const login = await stranger
    .post("/api/auth/login")
    .set(headers(csrf))
    .send({ email: "b@example.test", password: password + "2" })
    .expect(200);
  await stranger.get("/api/relatorios/" + monthly.id + "/download").expect(404);
  assert.equal(
    (await stranger.get("/api/relatorios?client_id=" + aId)).body.length,
    0,
  );
  const pdf = await a
    .get("/api/relatorios/" + monthly.id + "/download")
    .expect(200);
  assert.match(pdf.headers["content-type"], /application\/pdf/);
});
test("apuração vincula somente documentos do cliente e gera composição decimal precisa", async () => {
  await admin
    .patch("/api/admin/clientes/" + aId)
    .set(headers(adminCsrf))
    .send({ cnpj: "12.345.678/0001-95", legal_name: "Empresa Teste" })
    .expect(200);
  const zero = Object.fromEntries(
    [
      "commerce_with_invoice",
      "commerce_without_invoice",
      "industry_with_invoice",
      "industry_without_invoice",
      "services_with_invoice",
      "services_without_invoice",
    ].map((k) => [k, "0.00"]),
  );
  const assessed = await admin
    .put(`/api/admin/clientes/${aId}/apuracoes/2026-11`)
    .set(headers(adminCsrf))
    .send({
      parts: {
        ...zero,
        services_with_invoice: "7800.10",
        services_without_invoice: "100.15",
      },
      document_ids: [docId],
      had_employee: false,
    })
    .expect(200);
  assert.equal(assessed.body.amount, "7900.25");
  await admin
    .put(`/api/admin/clientes/${bId}/apuracoes/2026-11`)
    .set(headers(adminCsrf))
    .send({ parts: zero, document_ids: [docId] })
    .expect(400);
  const list = await admin.get("/api/relatorios?client_id=" + aId);
  const monthly = list.body.find((r: any) => r.kind === "monthly");
  assert.equal(monthly.complete, true);
  const [snapshot] = await query(
    "SELECT snapshot FROM report_versions WHERE id=$1",
    [monthly.id],
  );
  assert.equal(snapshot.snapshot.services, "7900.25");
  assert.equal(snapshot.snapshot.rows[0].documents[0].id, docId);
  await admin
    .post(`/api/admin/clientes/${aId}/faturamentos`)
    .set(headers(adminCsrf))
    .send({ month: "2026-11", amount: "8000.00" })
    .expect(200);
  const fresh = await admin.get("/api/relatorios?client_id=" + aId);
  const changed = fresh.body.find((r: any) => r.kind === "monthly");
  assert.equal(changed.total, "8000.00");
  assert.equal(changed.complete, false);
  assert.deepEqual(changed.unclassified, ["2026-11"]);
});
test("consolidado anual de ME em ano encerrado preserva zero confirmado e identifica apoio à DEFIS", async () => {
  const created = await admin
    .post("/api/admin/clientes")
    .set(headers(adminCsrf))
    .send({
      name: "Empresa ME de teste",
      legal_name: "Empresa ME de teste",
      cnpj: "12.345.678/0001-95",
      type: "ME",
      activity: "servicos",
      partners: 1,
      since_month: "2025-11",
      opening_month: "2025-11",
      plan: "Empresa Clareza",
      amount: "350.00",
      effective: "2025-11",
    })
    .expect(201);
  const id = created.body.id,
    zero = Object.fromEntries(
      [
        "commerce_with_invoice",
        "commerce_without_invoice",
        "industry_with_invoice",
        "industry_without_invoice",
        "services_with_invoice",
        "services_without_invoice",
      ].map((k) => [k, "0.00"]),
    );
  for (const month of ["2025-11", "2025-12"])
    await admin
      .put(`/api/admin/clientes/${id}/apuracoes/${month}`)
      .set(headers(adminCsrf))
      .send({ parts: zero, document_ids: [] })
      .expect(200);
  const reports = await admin.get("/api/relatorios?client_id=" + id);
  const annual = reports.body.find((r: any) => r.kind === "annual");
  assert.equal(annual.total, "0.00");
  assert.equal(annual.complete, true);
  assert.deepEqual(annual.missing, []);
  assert.equal(annual.year_open, false);
  await admin
    .get("/api/relatorios/" + annual.id + "/download")
    .expect("Content-Type", /application\/pdf/)
    .expect(200);
  await admin
    .delete("/api/admin/clientes/" + id)
    .set(headers(adminCsrf))
    .send({ confirmation: "EXCLUIR" })
    .expect(200);
});
test("relatórios são publicados no armazenamento privado e conciliação é idempotente", async () => {
  const [before] = await query("SELECT count(*) FROM report_versions");
  await reconcileReports();
  const [after] = await query("SELECT count(*) FROM report_versions");
  assert.equal(before.count, after.count);
  await processReportJobs();
  const published = await query(
    "SELECT object_key FROM report_versions WHERE storage_status='Publicado'",
  );
  assert.ok(published.length > 0);
  for (const r of published)
    assert.equal(store.get(r.object_key)!.subarray(0, 4).toString(), "%PDF");
});
test("Resend informa falha real, confirma aceitação e não grava token em log", async () => {
  setTestMailTransport(async () => ({
    error: {
      name: "validation_error",
      statusCode: 403,
      message: "The domain is not verified",
    },
  }));
  const id = uid();
  await query(
    "INSERT INTO users(id,email,name,role) VALUES($1,'mail-test@example.test','Teste de entrega','admin')",
    [id],
  );
  const failed = await issueToken(
    { id, email: "mail-test@example.test" },
    "invite",
  );
  assert.equal(failed.status, "Pendente");
  assert.match(failed.error, /domínio/);
  setTestMailTransport(async (payload, key) => {
    assert.ok(payload.text.includes("/convite#"));
    assert.equal(payload.subject, "Seu acesso à GB Soluções");
    return { id: "provider-test-" + key };
  });
  await query("UPDATE mail_outbox SET next_attempt_at=now() WHERE user_id=$1", [
    id,
  ]);
  await deliverMail();
  const [mail] = await query(
    "SELECT status,payload,provider_id,last_error FROM mail_outbox WHERE user_id=$1",
    [id],
  );
  assert.equal(mail.status, "Enviado");
  assert.equal(mail.payload, "");
  assert.ok(mail.provider_id);
  assert.equal(mail.last_error, null);
  setTestMailTransport(undefined);
});
test("identidade e contato têm CRC e WhatsApp solicitados", async () => {
  const catalogue = await anon.get("/api/public/catalogo");
  assert.equal(catalogue.body.contact.whatsapp, "5551991056678");
  const [organization] = await query(
    "SELECT value FROM settings WHERE key='organization'",
  );
  assert.equal(organization.value.name, "GB Soluções");
  assert.equal(organization.value.crc, "RS-107227/0");
});
test("datas de relatórios usam o dia de São Paulo na virada UTC", async () => {
  const { date } = await import("../../frontend/src/api.ts");
  assert.equal(date("2026-11-17T00:05:00.000Z"), "16/11/2026");
  assert.equal(date("2026-11-17"), "17/11/2026");
});
test("expiração por inatividade e arquivamento revogam acesso", async () => {
  await admin
    .patch("/api/admin/clientes/" + aId)
    .set(headers(adminCsrf))
    .send({ active: false })
    .expect(200);
  await a.get("/api/me").expect(401);
  await admin
    .patch("/api/admin/clientes/" + aId)
    .set(headers(adminCsrf))
    .send({ active: true })
    .expect(200);
  const fresh = request.agent(app);
  const csrf = (await fresh.get("/api/auth/session")).body.csrf;
  await fresh
    .post("/api/auth/login")
    .set(headers(csrf))
    .send({ email: "a@example.test", password })
    .expect(200);
  await query(
    "UPDATE sessions SET touched_at=now()-interval '31 minutes' WHERE user_id=$1",
    [aUser],
  );
  await fresh.get("/api/me").expect(401);
});
test("migrations e seeds repetidos não duplicam nem sobrescrevem", async () => {
  const [before] = await query("SELECT count(*) FROM clients");
  await migrate();
  await seed();
  const [after] = await query("SELECT count(*) FROM clients");
  assert.equal(after.count, before.count);
  const [p] = await query("SELECT reference_amount FROM orders WHERE id=$1", [
    orderId,
  ]);
  assert.equal(p.reference_amount, "35.00");
});
test("logout permite novo login sem recarregar e revoga sessão anterior", async () => {
  const agent = request.agent(app);
  let csrf = (await agent.get("/api/auth/session")).body.csrf;
  let res = await agent
    .post("/api/auth/login")
    .set(headers(csrf))
    .send({ email: config.ADMIN_EMAIL, password: config.ADMIN_PASSWORD });
  assert.equal(res.status, 200);
  csrf = res.body.csrf;
  res = await agent.post("/api/auth/logout").set(headers(csrf));
  assert.equal(res.status, 200);
  assert.equal(res.body.user, null);
  csrf = res.body.csrf;
  await agent.get("/api/admin/clientes").expect(401);
  await agent
    .post("/api/auth/login")
    .set(headers(csrf))
    .send({ email: config.ADMIN_EMAIL, password: config.ADMIN_PASSWORD })
    .expect(200);
});
test("incrementos concorrentes de notas são atômicos", async () => {
  const responses = await Promise.all(
    Array.from({ length: 10 }, () =>
      admin
        .patch(`/api/admin/clientes/${aId}/competencias/2026-11`)
        .set(headers(adminCsrf))
        .send({ notes_delta: 1 }),
    ),
  );
  responses.forEach((r) => assert.equal(r.status, 200, JSON.stringify(r.body)));
  const [r] = await query(
    "SELECT notes_count FROM monthly_tasks WHERE client_id=$1 AND month=$2",
    [aId, "2026-11"],
  );
  assert.equal(r.notes_count, 10);
  const res = await admin.get("/api/admin/clientes/" + aId + "?month=2026-11");
  assert.equal(res.body.notes_meta.reference_total, "175.00");
});
test("configurações preservam versões anteriores em histórico", async () => {
  const rows = await query(
    "SELECT data FROM configuration_history WHERE kind='service_versions' AND entity='nota' ORDER BY id DESC LIMIT 1",
  );
  assert.equal(rows[0].data.after.amount, 50);
});
test("cálculos: proporcional, precisão, zero, virada de ano e parâmetro ausente", () => {
  const fiscal = {
    meiLimit: 81000,
    alert: 0.8,
    das: { servicos: 86.05 },
    simplesBands: [180000, 360000, 720000, 1800000, 3600000, 4800000],
  };
  const c = { type: "MEI", opening_month: "2026-07", activity: "servicos" };
  const result = indicators(
    c,
    "2026-11",
    [
      { month: "2026-07", amount: ".10" },
      { month: "2026-08", amount: ".20" },
      { month: "2026-09", amount: "0" },
    ],
    fiscal,
    null,
  );
  assert.equal(result.annual, "0.30");
  assert.equal(result.limit, "40500.00");
  assert.equal(result.projection, "0.60");
  assert.equal(indicators(c, "2027-01", [], null, null).limit, null);
  assert.equal(
    indicators(
      { ...c, type: "ME" },
      "2027-01",
      [{ month: "2026-12", amount: "1500" }],
      fiscal,
      null,
    ).rbt,
    "18000.00",
  );
});
test("exclusão remove arquivos ativos e dados vinculados preservando auditoria mínima", async () => {
  await admin
    .delete("/api/admin/clientes/" + aId)
    .set(headers(adminCsrf))
    .send({ confirmation: "EXCLUIR" })
    .expect(200);
  assert.equal(store.size, 0);
  assert.equal(
    (await query("SELECT id FROM clients WHERE id=$1", [aId])).length,
    0,
  );
  assert.equal(
    (await query("SELECT id FROM users WHERE id=$1", [aUser])).length,
    0,
  );
  assert.ok(
    (
      await query(
        "SELECT id FROM audit_events WHERE action='cliente.excluido' AND entity_id=$1",
        [aId],
      )
    ).length,
  );
});
