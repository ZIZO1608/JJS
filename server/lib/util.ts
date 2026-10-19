import type { NextFunction, Request, RequestHandler, Response } from "express";
import { v7 as uuidv7 } from "uuid";
import { ZodError, type z } from "zod";

export const newId = () => uuidv7();
export const nowIso = () => new Date().toISOString();

/** An error with an HTTP status and a stable code the UI can translate. */
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
    public details?: unknown,
  ) {
    super(message ?? code);
  }
}

export const notFound = (what = "record") => new HttpError(404, "not_found", `${what} not found`);

/** Express 4 does not catch rejected promises; wrap async handlers. */
export const h =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

export const parse = <S extends z.ZodTypeAny>(schema: S, data: unknown): z.output<S> => schema.parse(data);

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    res.status(400).json({ error: "invalid_input", message: "Some fields are missing or wrong.", issues: err.issues });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.code, message: err.message, details: err.details });
    return;
  }
  const sqliteCode = (err as { code?: string })?.code;
  if (sqliteCode === "SQLITE_CONSTRAINT_UNIQUE") {
    res.status(409).json({ error: "duplicate", message: "A record with this value already exists." });
    return;
  }
  console.error("[server] unexpected error", err);
  res.status(500).json({ error: "server_error", message: "Something went wrong on the server. Check the server log." });
}
