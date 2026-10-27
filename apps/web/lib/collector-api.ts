import type { ApiError } from '@undercut/core';
import { authenticateCollector, type Collector } from '@undercut/db';
import type { z } from 'zod';
import { db } from './db';

export function apiError(status: number, code: string, error: string): Response {
  return Response.json({ code, error } satisfies ApiError, { status });
}

/** Resolves the `Authorization: Bearer <device token>` header to a collector, or a 401 response. */
export async function authenticate(request: Request): Promise<Collector | Response> {
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return apiError(401, 'unauthenticated', 'missing bearer token');
  const collector = await authenticateCollector(db(), token);
  return collector ?? apiError(401, 'unauthenticated', 'unknown or revoked token');
}

/** Parses a JSON body against a schema; an empty body is treated as `{}`. */
export async function parseBody<S extends z.ZodType>(request: Request, schema: S): Promise<z.infer<S> | Response> {
  const text = await request.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    return apiError(400, 'invalid_json', 'body is not valid JSON');
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return apiError(400, 'invalid_body', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  return parsed.data;
}
