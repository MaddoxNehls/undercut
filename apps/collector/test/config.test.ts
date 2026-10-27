import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearConfig, loadConfig, saveConfig } from '../src/config';

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'undercut-home-'));
  process.env.UNDERCUT_HOME = home;
});
afterEach(async () => {
  delete process.env.UNDERCUT_HOME;
  await rm(home, { recursive: true, force: true });
});

describe('collector config', () => {
  const config = { serverUrl: 'http://localhost:3210', token: 'uc_local_abc123', collectorName: 'laptop' };

  it('round-trips login state', async () => {
    expect(await loadConfig()).toBeNull();
    await saveConfig(config);
    expect(await loadConfig()).toEqual(config);
    await clearConfig();
    expect(await loadConfig()).toBeNull();
  });

  it('refuses to store a cloud token in a local collector', async () => {
    await expect(saveConfig({ ...config, token: 'uc_cloud_abc' })).rejects.toThrow();
  });

  it('writes the token file owner-readable only (POSIX)', async () => {
    await saveConfig(config);
    const path = join(home, 'collector.json');
    expect(JSON.parse(await readFile(path, 'utf8')).token).toBe(config.token);
    if (process.platform !== 'win32') expect((await stat(path)).mode & 0o077).toBe(0);
  });
});
