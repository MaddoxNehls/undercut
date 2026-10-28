/** One structured completion per call; nothing provider-specific leaks past this interface. */

export class BackendError extends Error {}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export interface CompletionRequest {
  /** Stable name of the call site, e.g. "discover/books.toscrape.com". Keys replay fixtures. */
  tag: string;
  system: string;
  messages: readonly Message[];
  /** JSON schema the reply must satisfy. */
  schema: Record<string, unknown>;
  schemaName: string;
  maxTokens: number;
}

export interface Completion {
  /** The JSON reply, still unvalidated. */
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** True when served from a fixture or the disk cache rather than a live call. */
  cached: boolean;
}

export interface Backend {
  readonly name: string;
  readonly model: string;
  complete(request: CompletionRequest): Promise<Completion>;
}
