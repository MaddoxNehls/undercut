import { join } from 'node:path';
import { ClaudeCliBackend } from './claude-cli';
import { LLM } from './client';
import { DiskCacheBackend } from './disk-cache';
import { AnthropicBackend, OpenRouterBackend } from './http-backends';
import { ReplayBackend } from './replay';
import type { Backend } from './types';

export { BackendError, type Backend, type Completion, type CompletionRequest, type Message } from './types';
export { LLM, parseJson, type Usage } from './client';
export { ReplayBackend, RecordingBackend, type ReplayFixture } from './replay';
export { DiskCacheBackend, cacheKey } from './disk-cache';
export { ClaudeCliBackend, renderPrompt } from './claude-cli';
export { AnthropicBackend, OpenRouterBackend } from './http-backends';

/**
 * Builds the configured backend, or null when LLM assistance is off (heuristics only).
 *
 *   UNDERCUT_LLM = none | anthropic | openrouter | claude-cli | replay
 *   UNDERCUT_LLM_MODEL, ANTHROPIC_API_KEY, OPENROUTER_API_KEY, UNDERCUT_LLM_REPLAY (fixture path)
 *   UNDERCUT_LLM_CACHE_DIR: live backends are wrapped in a disk cache (default .llm-cache)
 */
export function llmFromEnv(env: NodeJS.ProcessEnv = process.env): LLM | null {
  const kind = env.UNDERCUT_LLM ?? 'none';
  const model = env.UNDERCUT_LLM_MODEL;
  let backend: Backend;
  switch (kind) {
    case 'none':
      return null;
    case 'replay':
      if (!env.UNDERCUT_LLM_REPLAY) throw new Error('UNDERCUT_LLM_REPLAY must point at a fixture file');
      return new LLM(new ReplayBackend(env.UNDERCUT_LLM_REPLAY));
    case 'anthropic':
      backend = new AnthropicBackend(required(env, 'ANTHROPIC_API_KEY'), model);
      break;
    case 'openrouter':
      backend = new OpenRouterBackend(required(env, 'OPENROUTER_API_KEY'), model);
      break;
    case 'claude-cli':
      backend = new ClaudeCliBackend(model ? { model } : {});
      break;
    default:
      throw new Error(`unknown UNDERCUT_LLM "${kind}"`);
  }
  return new LLM(new DiskCacheBackend(backend, env.UNDERCUT_LLM_CACHE_DIR ?? join(process.cwd(), '.llm-cache')));
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}
