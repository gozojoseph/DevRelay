import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { randomUUID } from 'node:crypto';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export function requestId(req: Request, res: Response, next: NextFunction) {
  req.requestId = randomUUID(); res.setHeader('X-Request-Id', req.requestId); next();
}
export function ok(req: Request, res: Response, data: unknown, status = 200) { res.status(status).json({ data, requestId: req.requestId }); }
export function fail(res: Response, req: Request, error: ApiError) {
  res.status(error.status).json({ error: { code: error.code, message: error.message }, requestId: req.requestId });
}
export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction) {
  if (res.headersSent) return;
  if (error instanceof ApiError) return fail(res, req, error);
  if (error instanceof ZodError) return fail(res, req, new ApiError(400, 'VALIDATION_ERROR', error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')));
  // Deliberately do not log request bodies, tokens or provider responses.
  // The message + first stack frame are safe and are what makes a 500
  // diagnosable from logs alone (e.g. pg error text, wrong-argument throws).
  const message = error instanceof Error ? error.message.slice(0, 200)
    : String(error).slice(0, 200);
  const frame = error instanceof Error ? error.stack?.split('\n')[1]?.trim().slice(0, 160) : undefined;
  console.error('Request failed', { requestId: req.requestId,
    name: error instanceof Error ? error.name : 'unknown', message, at: frame });
  return fail(res, req, new ApiError(500, 'INTERNAL_ERROR', 'Something went wrong. Give support this request ID.'));
}
export function assert(value: unknown, status: number, code: string, message: string): asserts value {
  if (!value) throw new ApiError(status, code, message);
}
