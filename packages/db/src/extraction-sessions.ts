import type { PriceCandidate } from '@undercut/core';
import { toJson, type Db } from './client';

export interface ExtractionSession {
  id: string;
  url: string;
  finalUrl: string;
  httpStatus: number | null;
  title: string;
  usedLlm: boolean;
  reason: string;
  /** Ranked candidates, each with a PNG data URL of its highlighted element (if visible). */
  candidates: (PriceCandidate & { crop: string | null })[];
  createdAt: Date;
}

export async function createExtractionSession(db: Db, session: Omit<ExtractionSession, 'id' | 'createdAt'>): Promise<string> {
  const [row] = await db<{ id: string }[]>`
    INSERT INTO extraction_sessions (url, final_url, http_status, title, used_llm, reason, candidates)
    VALUES (${session.url}, ${session.finalUrl}, ${session.httpStatus}, ${session.title}, ${session.usedLlm},
            ${session.reason}, ${db.json(toJson(session.candidates))})
    RETURNING id`;
  if (!row) throw new Error('extraction_sessions insert returned no row');
  return row.id;
}

export async function getExtractionSession(db: Db, id: string): Promise<ExtractionSession | null> {
  const [row] = await db<ExtractionSession[]>`SELECT * FROM extraction_sessions WHERE id = ${id}`;
  return row ?? null;
}
