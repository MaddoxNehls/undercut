import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

const configSchema = z.object({
  serverUrl: z.url(),
  token: z.string().startsWith('uc_local_'),
  collectorName: z.string(),
});
export type CollectorConfig = z.infer<typeof configSchema>;

/** `~/.undercut` by default; `UNDERCUT_HOME` overrides it (tests, multiple profiles). */
export function configDir(): string {
  return process.env.UNDERCUT_HOME ?? join(homedir(), '.undercut');
}

const configPath = (): string => join(configDir(), 'collector.json');
export const profileDir = (): string => join(configDir(), 'browser-profile');

export async function loadConfig(): Promise<CollectorConfig | null> {
  try {
    return configSchema.parse(JSON.parse(await readFile(configPath(), 'utf8')));
  } catch {
    return null;
  }
}

/** The token is a credential: the file is created readable by the current user only. */
export async function saveConfig(config: CollectorConfig): Promise<void> {
  await mkdir(configDir(), { recursive: true });
  await writeFile(configPath(), `${JSON.stringify(configSchema.parse(config), null, 2)}\n`, { mode: 0o600 });
}

export async function clearConfig(): Promise<void> {
  await rm(configPath(), { force: true });
}
