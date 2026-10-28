import { readFileSync, writeFileSync } from 'node:fs';
import { BackendError, type Backend, type Completion, type CompletionRequest } from './types';

/**
 * Replay fixture: `{ "model": "...", "responses": { "<tag>": <reply JSON> } }`.
 * Keyed by call tag rather than prompt hash, so fixtures survive prompt-wording changes. Tests
 * that use it exercise Undercut's own logic (validation, ranking, healing), not the model's.
 */
export interface ReplayFixture {
  model?: string;
  responses: Record<string, unknown>;
}

export class ReplayBackend implements Backend {
  readonly name = 'replay';
  readonly model: string;
  readonly served: string[] = [];
  private readonly responses: Record<string, unknown>;

  constructor(fixture: ReplayFixture | string) {
    const data = typeof fixture === 'string' ? loadFixture(fixture) : fixture;
    this.model = data.model ?? 'replay';
    this.responses = data.responses;
  }

  async complete(request: CompletionRequest): Promise<Completion> {
    if (!(request.tag in this.responses)) {
      throw new BackendError(`no recorded response for "${request.tag}" (have: ${Object.keys(this.responses).join(', ') || 'none'})`);
    }
    this.served.push(request.tag);
    const value = this.responses[request.tag];
    return { text: typeof value === 'string' ? value : JSON.stringify(value), model: this.model, inputTokens: 0, outputTokens: 0, cached: true };
  }
}

/** Wraps a live backend and writes every reply to `path` in replay-fixture format. */
export class RecordingBackend implements Backend {
  readonly name: string;
  readonly model: string;
  private readonly responses: Record<string, unknown> = {};
  private recordedModel: string | undefined;

  constructor(
    private readonly inner: Backend,
    private readonly path: string,
  ) {
    this.name = inner.name;
    this.model = inner.model;
  }

  async complete(request: CompletionRequest): Promise<Completion> {
    const completion = await this.inner.complete(request);
    try {
      this.responses[request.tag] = JSON.parse(completion.text);
    } catch {
      this.responses[request.tag] = completion.text;
    }
    this.recordedModel = completion.model;
    const fixture: ReplayFixture = { model: this.recordedModel, responses: this.responses };
    writeFileSync(this.path, `${JSON.stringify(fixture, null, 2)}\n`);
    return completion;
  }
}

function loadFixture(path: string): ReplayFixture {
  try {
    const data = JSON.parse(readFileSync(path, 'utf8')) as ReplayFixture;
    if (typeof data !== 'object' || data === null || typeof data.responses !== 'object') throw new Error('missing "responses"');
    return data;
  } catch (err) {
    throw new BackendError(`cannot read replay fixture ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
