import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { BackendError, type Backend, type Completion, type CompletionRequest } from './types';

const SAFE_MODEL = /^[A-Za-z0-9._\-[\]]+$/;

/**
 * Claude through the local `claude -p` CLI (dev only: it uses the owner's subscription).
 * Our system prompt replaces Claude Code's own, and settings, tools, and MCP servers are not
 * loaded, so a call carries only our prompt. Prompt text goes over stdin and a temp file,
 * never the command line.
 */
export class ClaudeCliBackend implements Backend {
  readonly name = 'claude-cli';
  readonly model: string;

  constructor(
    private readonly options: { model?: string; executable?: string; timeoutMs?: number } = {},
  ) {
    if (options.model && !SAFE_MODEL.test(options.model)) throw new Error(`invalid model name "${options.model}"`);
    this.model = options.model ?? 'claude-cli-default';
  }

  async complete(request: CompletionRequest): Promise<Completion> {
    const executable = this.options.executable ?? resolveClaude();
    const dir = await mkdtemp(join(tmpdir(), 'undercut-claude-'));
    try {
      const systemFile = join(dir, 'system.txt');
      await writeFile(systemFile, request.system, 'utf8');
      const args = ['-p', '--output-format', 'json', '--tools', '', '--no-session-persistence'];
      args.push('--system-prompt-file', systemFile, '--setting-sources', '', '--strict-mcp-config');
      if (this.options.model) args.push('--model', this.options.model);
      const stdout = await run(executable, args, renderPrompt(request), dir, this.options.timeoutMs ?? 300_000);
      return toCompletion(stdout, this.model);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

export function renderPrompt(request: CompletionRequest): string {
  const lines = [
    'Reply with exactly one JSON object and nothing else. It must validate against this JSON schema:',
    JSON.stringify(request.schema),
    'Do not use any tools.',
    '',
  ];
  for (const m of request.messages) lines.push(`${m.role.toUpperCase()}:`, m.content, '');
  lines.push('Respond with the JSON object now.');
  return lines.join('\n');
}

function toCompletion(stdout: string, fallbackModel: string): Completion {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(stdout) as Record<string, unknown>;
  } catch {
    throw new BackendError('claude returned non-JSON output');
  }
  if (payload.is_error) throw new BackendError(`claude reported an error: ${String(payload.result)}`);
  const usage = (payload.usage ?? {}) as Record<string, number | undefined>;
  const models = Object.keys((payload.modelUsage ?? {}) as Record<string, unknown>);
  return {
    text: String(payload.result ?? ''),
    model: models[0] ?? fallbackModel,
    inputTokens: (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0),
    outputTokens: usage.output_tokens ?? 0,
    cached: false,
  };
}

function run(executable: string, args: string[], stdin: string, cwd: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new BackendError(`claude timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new BackendError(`cannot run claude: ${err.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new BackendError(`claude exited with ${code}: ${stderr.trim().slice(0, 500)}`));
    });
    child.stdin.end(stdin, 'utf8');
  });
}

/**
 * Finds the real `claude` binary. On Windows, npm installs a `claude.cmd` shim, which Node
 * cannot spawn without a shell; the native executable sits next to it.
 */
function resolveClaude(): string {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (process.platform !== 'win32') {
      if (existsSync(join(dir, 'claude'))) return join(dir, 'claude');
      continue;
    }
    if (existsSync(join(dir, 'claude.exe'))) return join(dir, 'claude.exe');
    if (existsSync(join(dir, 'claude.cmd'))) {
      const native = join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
      if (existsSync(native)) return native;
    }
  }
  throw new BackendError(`claude not found on PATH (searched from ${dirname(process.execPath)})`);
}
