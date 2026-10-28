import { BackendError, type Backend, type Completion, type CompletionRequest } from './types';

type FetchFn = typeof fetch;

/**
 * Anthropic Messages API. Structured output via a single forced tool whose input schema is the
 * reply schema, so the model can only answer with a schema-shaped object.
 */
export class AnthropicBackend implements Backend {
  readonly name = 'anthropic';

  constructor(
    private readonly apiKey: string,
    readonly model = 'claude-sonnet-4-5',
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  async complete(request: CompletionRequest): Promise<Completion> {
    const body = {
      model: this.model,
      max_tokens: request.maxTokens,
      system: request.system,
      messages: request.messages,
      tools: [{ name: request.schemaName, description: 'Return the answer.', input_schema: request.schema }],
      tool_choice: { type: 'tool', name: request.schemaName },
    };
    const json = await postJson(this.fetchFn, 'https://api.anthropic.com/v1/messages', body, {
      'x-api-key': this.apiKey,
      'anthropic-version': '2023-06-01',
    });
    const content = (json.content ?? []) as { type: string; input?: unknown }[];
    const toolUse = content.find((c) => c.type === 'tool_use');
    if (!toolUse) throw new BackendError('anthropic reply had no tool_use block');
    const usage = (json.usage ?? {}) as { input_tokens?: number; output_tokens?: number };
    return {
      text: JSON.stringify(toolUse.input),
      model: String(json.model ?? this.model),
      inputTokens: usage.input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
      cached: false,
    };
  }
}

/** OpenRouter's OpenAI-compatible chat API with a strict JSON-schema response format. */
export class OpenRouterBackend implements Backend {
  readonly name = 'openrouter';

  constructor(
    private readonly apiKey: string,
    readonly model = 'anthropic/claude-sonnet-4.5',
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  async complete(request: CompletionRequest): Promise<Completion> {
    const body = {
      model: this.model,
      max_tokens: request.maxTokens,
      messages: [{ role: 'system', content: request.system }, ...request.messages],
      response_format: { type: 'json_schema', json_schema: { name: request.schemaName, schema: request.schema } },
    };
    const json = await postJson(this.fetchFn, 'https://openrouter.ai/api/v1/chat/completions', body, {
      authorization: `Bearer ${this.apiKey}`,
    });
    const choices = (json.choices ?? []) as { message?: { content?: string } }[];
    const text = choices[0]?.message?.content;
    if (!text) throw new BackendError('openrouter reply had no message content');
    const usage = (json.usage ?? {}) as { prompt_tokens?: number; completion_tokens?: number };
    return {
      text,
      model: String(json.model ?? this.model),
      inputTokens: usage.prompt_tokens ?? 0,
      outputTokens: usage.completion_tokens ?? 0,
      cached: false,
    };
  }
}

async function postJson(fetchFn: FetchFn, url: string, body: unknown, headers: Record<string, string>): Promise<Record<string, unknown>> {
  const response = await fetchFn(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  const text = await response.text();
  if (!response.ok) throw new BackendError(`${new URL(url).host} returned HTTP ${response.status}: ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new BackendError(`${new URL(url).host} returned non-JSON`);
  }
}
