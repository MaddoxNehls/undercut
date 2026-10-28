import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  AnthropicBackend,
  BackendError,
  DiskCacheBackend,
  LLM,
  OpenRouterBackend,
  parseJson,
  renderPrompt,
  ReplayBackend,
  type Backend,
  type CompletionRequest,
} from '../src/index';

const schema = z.object({ answer: z.number() });

class CountingBackend implements Backend {
  readonly name = 'counting';
  readonly model = 'test-model';
  calls = 0;
  constructor(private readonly replies: string[]) {}
  async complete() {
    return { text: this.replies[this.calls++] ?? '{}', model: this.model, inputTokens: 10, outputTokens: 5, cached: false };
  }
}

describe('LLM.structured', () => {
  it('validates the reply with zod', async () => {
    const llm = new LLM(new ReplayBackend({ responses: { q: { answer: 42 } } }));
    expect(await llm.structured('q', 'sys', [{ role: 'user', content: 'hi' }], schema)).toEqual({ answer: 42 });
  });

  it('retries once with the validation error, then succeeds', async () => {
    const backend = new CountingBackend(['{"answer":"forty-two"}', 'Sure! ```json\n{"answer": 42}\n```']);
    const llm = new LLM(backend);
    expect(await llm.structured('q', 'sys', [], schema)).toEqual({ answer: 42 });
    expect(llm.usage).toMatchObject({ calls: 2, liveCalls: 2, inputTokens: 20 });
  });

  it('gives up after a second invalid reply', async () => {
    const llm = new LLM(new CountingBackend(['nope', '{"answer": null}']));
    await expect(llm.structured('q', 'sys', [], schema)).rejects.toBeInstanceOf(BackendError);
  });

  it('replay names the missing tag', async () => {
    const llm = new LLM(new ReplayBackend({ responses: {} }));
    await expect(llm.structured('discover/x', 'sys', [], schema)).rejects.toThrow('no recorded response for "discover/x"');
  });
});

describe('DiskCacheBackend', () => {
  it('serves an identical request from disk without calling the backend again', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'undercut-llm-cache-'));
    const inner = new CountingBackend(['{"answer":1}']);
    const llm = new LLM(new DiskCacheBackend(inner, dir));
    await llm.structured('q', 'sys', [{ role: 'user', content: 'same' }], schema);
    await llm.structured('q', 'sys', [{ role: 'user', content: 'same' }], schema);
    expect(inner.calls).toBe(1);
    expect(llm.usage).toMatchObject({ calls: 2, liveCalls: 1 });
    expect(await readdir(dir)).toHaveLength(1);
  });
});

const request: CompletionRequest = {
  tag: 't',
  system: 'sys',
  messages: [{ role: 'user', content: 'digest here' }],
  schema: { type: 'object' },
  schemaName: 'price_candidates',
  maxTokens: 100,
};

describe('provider adapters (no network: fetch is injected)', () => {
  const fakeFetch = (body: unknown, capture: { init?: RequestInit }) =>
    (async (_url: string | URL | Request, init?: RequestInit) => {
      capture.init = init;
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;

  it('Anthropic forces the schema tool and returns its input as the reply', async () => {
    const seen: { init?: RequestInit } = {};
    const backend = new AnthropicBackend('key', 'm', fakeFetch({ content: [{ type: 'tool_use', input: { answer: 1 } }], usage: { input_tokens: 7, output_tokens: 3 } }, seen));
    const completion = await backend.complete(request);
    expect(completion).toMatchObject({ text: '{"answer":1}', inputTokens: 7, outputTokens: 3 });
    expect(JSON.parse(String(seen.init?.body)).tool_choice).toEqual({ type: 'tool', name: 'price_candidates' });
  });

  it('OpenRouter sends a json_schema response format', async () => {
    const seen: { init?: RequestInit } = {};
    const backend = new OpenRouterBackend('key', 'm', fakeFetch({ choices: [{ message: { content: '{"answer":2}' } }] }, seen));
    expect((await backend.complete(request)).text).toBe('{"answer":2}');
    expect(JSON.parse(String(seen.init?.body)).response_format.type).toBe('json_schema');
  });

  it('claude-cli prompt carries the schema and the conversation', () => {
    const prompt = renderPrompt(request);
    expect(prompt).toContain('{"type":"object"}');
    expect(prompt).toContain('USER:\ndigest here');
  });

  it('parseJson accepts fenced JSON and reports garbage', () => {
    expect(parseJson('```json\n{"a":1}\n```')).toEqual({ ok: true, value: { a: 1 } });
    expect(parseJson('no json').ok).toBe(false);
  });
});
