import { z } from 'zod';
import { BackendError, type Backend, type Completion, type Message } from './types';

export interface Usage {
  calls: number;
  liveCalls: number;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Structured calls on top of any backend. The reply is validated with zod; a reply that fails
 * gets one retry with the validation error shown to the model, and a second failure throws.
 */
export class LLM {
  readonly usage: Usage = { calls: 0, liveCalls: 0, inputTokens: 0, outputTokens: 0 };

  constructor(readonly backend: Backend) {}

  async structured<S extends z.ZodType>(
    tag: string,
    system: string,
    messages: readonly Message[],
    output: S,
    options: { schemaName?: string; maxTokens?: number } = {},
  ): Promise<z.infer<S>> {
    const schema = z.toJSONSchema(output) as Record<string, unknown>;
    const conversation: Message[] = [...messages];
    let error = '';
    for (const attempt of [1, 2]) {
      const completion = await this.complete({
        tag: attempt === 1 ? tag : `${tag}/repair`,
        system,
        messages: conversation,
        schema,
        schemaName: options.schemaName ?? 'response',
        maxTokens: options.maxTokens ?? 4000,
      });
      const parsed = parseJson(completion.text);
      const result = parsed.ok ? output.safeParse(parsed.value) : null;
      if (result?.success) return result.data;
      error = parsed.ok ? z.prettifyError(result!.error) : parsed.error;
      conversation.push(
        { role: 'assistant', content: completion.text },
        { role: 'user', content: `That reply was not valid against the schema:\n${error}\nReply again with only the corrected JSON object.` },
      );
    }
    throw new BackendError(`${tag}: model reply failed validation twice: ${error}`);
  }

  private async complete(request: Parameters<Backend['complete']>[0]): Promise<Completion> {
    const completion = await this.backend.complete(request);
    this.usage.calls++;
    if (!completion.cached) this.usage.liveCalls++;
    this.usage.inputTokens += completion.inputTokens;
    this.usage.outputTokens += completion.outputTokens;
    return completion;
  }
}

/** Accepts a bare JSON object, or one wrapped in prose or a code fence. */
export function parseJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const trimmed = text.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end < start) return { ok: false, error: 'reply contains no JSON object' };
  try {
    return { ok: true, value: JSON.parse(trimmed.slice(start, end + 1)) };
  } catch (err) {
    return { ok: false, error: `reply is not valid JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
}
