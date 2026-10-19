import fs from "node:fs";
import path from "node:path";
import cookieParser from "cookie-parser";
import express from "express";
import { WEB_DIST_DIR } from "./env.js";
import { sessionMiddleware } from "./lib/auth.js";
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

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(sessionMiddleware);

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
