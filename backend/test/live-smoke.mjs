import dotenv from "dotenv";
import assert from "node:assert/strict";
dotenv.config({ quiet: true });
const base = process.env.APP_URL || "http://localhost:3000";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname))
  throw new Error("Este smoke test é exclusivo para a aplicação local.");
let cookie = "",
  csrf = "";
async function api(path, method = "GET", body) {
  const r = await fetch(base + "/api" + path, {
    method,
    headers: {
      Origin: base,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(method === "GET"
        ? {}
        : { "X-CSRF-Token": csrf, "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (r.headers.get("set-cookie"))
    cookie = r.headers.get("set-cookie").split(";")[0];
  const d = await r.json();
  assert.equal(
    r.status >= 200 && r.status < 300,
    true,
    JSON.stringify({ path, status: r.status, message: d.message }),
  );
  if (d.csrf) csrf = d.csrf;
  return d;
}
await api("/health/ready");
await api("/auth/session");
await api("/auth/login", "POST", {
  email: process.env.ADMIN_EMAIL,
  password: process.env.ADMIN_PASSWORD,
});
const clients = await api("/admin/clientes");
let removed = 0;
if (process.argv.includes("--cleanup-ui"))
  for (const c of clients) {
    if (
      c.name === "Verificação temporária de interface" &&
      c.email === "verificacao@example.test"
    ) {
      await api("/admin/clientes/" + c.id, "DELETE", {
        confirmation: "EXCLUIR",
      });
      removed++;
    }
  }
for (const path of [
  "/admin/clientes",
  "/admin/pedidos",
  "/admin/honorarios",
  "/admin/faturamentos/revisoes",
  "/documentos",
  "/admin/usuarios",
  "/admin/configuracoes",
  "/admin/auditoria",
])
  await api(path);
const catalogue = await api("/public/catalogo");
assert.equal(catalogue.services.length, 13);
assert.equal(catalogue.plans.length, 8);
await api("/auth/logout", "POST");
await api("/auth/login", "POST", {
  email: process.env.ADMIN_EMAIL,
  password: process.env.ADMIN_PASSWORD,
});
await api("/auth/logout", "POST");
console.log(
  JSON.stringify({
    ok: true,
    modules: 8,
    services: 13,
    plans: 8,
    temporaryClientsRemoved: removed,
  }),
);
