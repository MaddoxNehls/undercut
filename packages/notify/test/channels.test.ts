import { describe, expect, it } from 'vitest';
import { channelsFromEnv, generateVapidKeys, NtfyChannel } from '../src/index';

describe('channels', () => {
  it('refuses the public ntfy.sh unless explicitly allowed', () => {
    expect(() => new NtfyChannel('https://ntfy.sh')).toThrow('refusing to publish to the public ntfy.sh');
    expect(() => new NtfyChannel('https://ntfy.sh', { allowPublic: true })).not.toThrow();
  });

  it('rejects topics that could escape the URL path', async () => {
    await expect(new NtfyChannel('http://127.0.0.1:5453').send({ title: 't', body: 'b', url: 'u' }, '../admin')).rejects.toThrow('invalid ntfy topic');
  });

  it('enables Web Push only when VAPID keys are configured', () => {
    expect(channelsFromEnv({}).webpush).toBeUndefined();
    const keys = generateVapidKeys();
    expect(channelsFromEnv({ VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey }).webpush?.kind).toBe('webpush');
  });
});
