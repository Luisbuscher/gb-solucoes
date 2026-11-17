import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { rateLimit } from "express-rate-limit";
import { ZodError } from "zod";
import multer from "multer";
import { config } from "./config.js";
import { query } from "./db.js";
import {
  HttpError,
  session,
  csrf,
  authenticated,
  admin,
  audit,
} from "./security.js";
import { auth } from "./auth.js";
import { clients } from "./clients.js";
import { operations, me, publicApi } from "./operations.js";
import { administration } from "./administration.js";
import { documents, deleteClient } from "./documents.js";
import { vault } from "./vault.js";
import { assessments, reports } from "./reports.js";
export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(
    helmet({
      contentSecurityPolicy: false,
      hsts: config.https ? undefined : false,
    }),
  );
  app.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (
      config.https &&
      req.protocol !== "https" &&
      !["/api/health/live", "/api/health/ready"].includes(req.path)
    )
      return res.status(400).json({ message: "HTTPS obrigatório." });
    next();
  });
  app.get("/api/health/live", (req, res) => res.json({ ok: true }));
  app.get("/api/health/ready", async (req, res) => {
    await query("SELECT 1");
    res.json({ ok: true });
  });
  app.use(
    "/api",
    rateLimit({
      windowMs: 60_000,
      limit: 300,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { message: "Muitas requisições. Aguarde um minuto." },
    }),
  );
  app.use(express.json({ limit: "128kb" }));
  app.use(cookieParser());
  app.use("/api", session, csrf);
  app.use("/api/auth", auth);
  app.use("/api/public", publicApi);
  app.use("/api/admin", authenticated, admin, async (req, res, next) => {
    if (req.method === "GET")
      await audit(req, "administracao.leitura", "rota", req.path);
    next();
  });
  app.use("/api/admin/clientes", clients);
  app.use("/api/admin/clientes/:id/cofre", vault);
  app.use("/api/admin/clientes/:id/apuracoes", assessments);
  app.delete("/api/admin/clientes/:id", deleteClient);
  app.use("/api/admin", operations, administration);
  app.use("/api/documentos", authenticated, documents);
  app.use("/api/relatorios", authenticated, reports);
  app.use(
    "/api/me",
    authenticated,
    (req, res, next) => {
      if (req.auth!.user!.role !== "cliente")
        return res.status(403).json({ message: "Área exclusiva de clientes." });
      next();
    },
    async (req, res, next) => {
      if (req.method === "GET")
        await audit(req, "portal.leitura-rota", "rota", req.path);
      next();
    },
    me,
  );
  app.use((req, res) =>
    res.status(404).json({ message: "Rota não encontrada." }),
  );
  app.use(
    (
      error: any,
      req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      if (res.headersSent) return next(error);
      if (error instanceof ZodError)
        return res.status(400).json({
          message: error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join(" · "),
        });
      if (error instanceof HttpError)
        return res.status(error.status).json({ message: error.message });
      if (error instanceof multer.MulterError)
        return res.status(400).json({
          message: "Arquivo excede o limite de 10 MB ou envio inválido.",
        });
      if (error.code === "23505")
        return res
          .status(409)
          .json({ message: "Já existe um registro com estes dados." });
      if (error.code === "23503")
        return res.status(400).json({
          message: "Registro vinculado não existe ou ainda está em uso.",
        });
      if (error.type === "entity.parse.failed")
        return res.status(400).json({ message: "JSON inválido." });
      console.error("Falha de operação:", error.code || error.name);
      res.status(500).json({
        message: "Não foi possível concluir a operação. Tente novamente.",
      });
    },
  );
  return app;
}
