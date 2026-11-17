import { createApp } from "./app.js";
import { migrate, pool, query } from "./db.js";
import { seed } from "./seed.js";
import { config } from "./config.js";
import { deliverMail } from "./mail.js";
import { reconcileReports, processReportJobs } from "./reports.js";
import { currentDate } from "./rules.js";
await migrate();
await seed();
await reconcileReports();
let lastReportsDate = currentDate();
const server = createApp().listen(config.port, "0.0.0.0", () =>
  console.log(`GB Soluções API na porta ${config.port} — America/Sao_Paulo`),
);
const maintenance = setInterval(() => {
  void processReportJobs().catch(() =>
    console.error("Publicação de relatórios temporariamente indisponível."),
  );
  if (currentDate() !== lastReportsDate) {
    lastReportsDate = currentDate();
    void reconcileReports().catch(() => {
      lastReportsDate = "";
      console.error("Atualização dos relatórios pendente.");
    });
  }
  void deliverMail().catch(() =>
    console.error("Entrega de e-mail temporariamente indisponível."),
  );
  void query(
    "DELETE FROM sessions WHERE touched_at<now()-interval '30 minutes' OR created_at<now()-interval '8 hours'",
  ).catch(() => {});
  void query(
    "DELETE FROM security_limits WHERE started_at<now()-interval '1 day'",
  ).catch(() => {});
  void query(
    "UPDATE mail_outbox SET status='Expirado',payload='' WHERE status='Pendente' AND created_at<now()-interval '24 hours'",
  ).catch(() => {});
}, 30_000);
maintenance.unref();
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    clearInterval(maintenance);
    server.close(() => void pool.end().then(() => process.exit(0)));
  });
