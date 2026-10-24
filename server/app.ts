import fs from "node:fs";
import path from "node:path";
import cookieParser from "cookie-parser";
import express from "express";
import { WEB_DIST_DIR } from "./env.js";
import { sessionMiddleware } from "./lib/auth.js";
import { clientSessionMiddleware } from "./lib/clientAuth.js";
import { errorHandler, HttpError } from "./lib/util.js";
import { auditRouter } from "./routes/audit.js";
import { authRouter } from "./routes/auth.js";
import { backupsRouter } from "./routes/backups.js";
import { fxRouter } from "./routes/fx.js";
import { lookupsRouter } from "./routes/lookups.js";
import { rolesRouter } from "./routes/roles.js";
import { settingsRouter } from "./routes/settings.js";
import { taxesRouter } from "./routes/taxes.js";
import { usersRouter } from "./routes/users.js";
import { clientsRouter } from "./routes/clients.js";
import { costingRouter } from "./routes/costing.js";
import { daysRouter } from "./routes/days.js";
import { assetsRouter, expensesRouter } from "./routes/expenses.js";
import { menuRouter } from "./routes/menu.js";
import { moneyRouter } from "./routes/money.js";
import { ordersRouter } from "./routes/orders.js";
import { peopleRouter } from "./routes/people.js";
import { purchasingRouter } from "./routes/purchasing.js";
import { reportsRouter } from "./routes/reports.js";
import { stockRouter } from "./routes/stock.js";
import { systemRouter } from "./routes/system.js";
import { wholesaleRouter } from "./routes/wholesale.js";
import { portalRouter } from "./routes/portal.js";
import { notificationsRouter, requestsRouter } from "./routes/requests.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  // Online, Coolify's proxy ends HTTPS in front of us; trust its X-Forwarded-* headers.
  if (process.env.JJS_TRUST_PROXY === "1") app.set("trust proxy", 1);
  app.use(express.json({ limit: "6mb" }));
  app.use(cookieParser());
  app.use(sessionMiddleware);
  app.use(clientSessionMiddleware);

  const api = express.Router();
  api.get("/health", (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));
  api.use("/auth", authRouter);
  api.use("/users", usersRouter);
  api.use("/roles", rolesRouter);
  api.use("/audit", auditRouter);
  api.use("/settings", settingsRouter);
  api.use("/lookups", lookupsRouter);
  api.use("/fx", fxRouter);
  api.use("/taxes", taxesRouter);
  api.use("/backups", backupsRouter);
  api.use("/menu", menuRouter);
  api.use("/stock", stockRouter);
  api.use("/purchases", purchasingRouter);
  api.use("/costing", costingRouter);
  api.use("/clients", clientsRouter);
  api.use("/orders", ordersRouter);
  api.use("/money", moneyRouter);
  api.use("/days", daysRouter);
  api.use("/expenses", expensesRouter);
  api.use("/assets", assetsRouter);
  api.use("/people", peopleRouter);
  api.use("/reports", reportsRouter);
  api.use("/system", systemRouter);
  api.use("/portal", portalRouter);
  api.use("/requests", requestsRouter);
  api.use("/notifications", notificationsRouter);
  api.use(wholesaleRouter);
  api.use((_req, _res, next) => next(new HttpError(404, "not_found", "No such API route.")));
  app.use("/api", api);

  // Built web app (production / desktop). In development Vite serves it and proxies /api here.
  if (fs.existsSync(path.join(WEB_DIST_DIR, "index.html"))) {
    app.use(express.static(WEB_DIST_DIR, { index: false, maxAge: "1h" }));
    app.get("*", (_req, res) => res.sendFile(path.join(WEB_DIST_DIR, "index.html")));
  }

  app.use(errorHandler);
  return app;
}
