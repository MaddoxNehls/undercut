import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Backend, Completion, CompletionRequest } from './types';

interface CacheEntry {
  tag: string;
  model: string;
  createdAt: string;
  completion: Completion;
}

/**
 * Content-addressed response cache: identical requests (same model, prompt, and schema) are
 * served from disk. It keeps paid or quota-limited backends (like a personal `claude -p`
 * subscription) from being called twice for the same question, and leaves an audit trail.
 */
export class DiskCacheBackend implements Backend {
  readonly name: string;
  readonly model: string;

  constructor(
    private readonly inner: Backend,
    private readonly dir: string,
  ) {
    this.name = inner.name;
    this.model = inner.model;
  }

  async complete(request: CompletionRequest): Promise<Completion> {
    const path = join(this.dir, `${cacheKey(this.inner.model, request)}.json`);
    try {
      const entry = JSON.parse(await readFile(path, 'utf8')) as CacheEntry;
      return { ...entry.completion, cached: true };
    } catch {
      // Cache miss: fall through to the live backend.
    }
    const completion = await this.inner.complete(request);
    await mkdir(this.dir, { recursive: true });
    const entry: CacheEntry = { tag: request.tag, model: completion.model, createdAt: new Date().toISOString(), completion };
    await writeFile(path, `${JSON.stringify(entry, null, 2)}\n`);
    return completion;
  }
}

export function cacheKey(model: string, request: CompletionRequest): string {
  const material = JSON.stringify([model, request.system, request.messages, request.schema]);
  return createHash('sha256').update(material).digest('hex').slice(0, 32);
}
