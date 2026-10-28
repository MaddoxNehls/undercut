import nodemailer, { type Transporter } from 'nodemailer';
import webpush from 'web-push';

export type ChannelKind = 'email' | 'ntfy' | 'webpush';

export interface Notification {
  title: string;
  body: string;
  /** Where the notification should take the user. */
  url: string;
}

/** One delivery mechanism. `target` is channel-specific: an address, a topic, a subscription. */
export interface Channel {
  readonly kind: ChannelKind;
  send(notification: Notification, target: string): Promise<void>;
}

export class EmailChannel implements Channel {
  readonly kind = 'email';
  private readonly transport: Transporter;

  constructor(smtpUrl: string, private readonly from = 'Undercut <alerts@undercut.local>') {
    this.transport = nodemailer.createTransport(smtpUrl);
  }

  async send(n: Notification, to: string): Promise<void> {
    await this.transport.sendMail({ from: this.from, to, subject: n.title, text: `${n.body}\n\n${n.url}` });
  }
}

/** ntfy over HTTP. Refuses the public ntfy.sh unless explicitly allowed: topics there are world-readable. */
export class NtfyChannel implements Channel {
  readonly kind = 'ntfy';
  private readonly baseUrl: string;

  constructor(baseUrl: string, options: { allowPublic?: boolean } = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    if (new URL(this.baseUrl).hostname.endsWith('ntfy.sh') && !options.allowPublic) {
      throw new Error('refusing to publish to the public ntfy.sh; point NTFY_URL at your own server');
    }
  }

  async send(n: Notification, topic: string): Promise<void> {
    if (!/^[\w-]{1,64}$/.test(topic)) throw new Error(`invalid ntfy topic "${topic}"`);
    // JSON publishing (POST to the root) keeps a non-ASCII title out of HTTP headers.
    const response = await fetch(`${this.baseUrl}/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ topic, title: n.title, message: n.body, click: n.url, tags: ['moneybag'] }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`ntfy returned HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
}

export interface VapidKeys {
  subject: string;
  publicKey: string;
  privateKey: string;
}

/** Web Push. The target is a browser PushSubscription serialized as JSON. */
export class WebPushChannel implements Channel {
  readonly kind = 'webpush';

  constructor(private readonly vapid: VapidKeys) {}

  async send(n: Notification, subscription: string): Promise<void> {
    await webpush.sendNotification(JSON.parse(subscription) as webpush.PushSubscription, JSON.stringify(n), {
      vapidDetails: this.vapid,
      TTL: 24 * 60 * 60,
      timeout: 10_000,
    });
  }
}

export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  return webpush.generateVAPIDKeys();
}

/**
 * Channels configured in the environment. Dev defaults point at the docker-compose Mailpit
 * (SMTP 5452) and ntfy (5453) containers; Web Push needs VAPID keys.
 */
export function channelsFromEnv(env: NodeJS.ProcessEnv = process.env): Partial<Record<ChannelKind, Channel>> {
  const channels: Partial<Record<ChannelKind, Channel>> = {
    email: new EmailChannel(env.SMTP_URL ?? 'smtp://127.0.0.1:5452', env.ALERT_FROM),
    ntfy: new NtfyChannel(env.NTFY_URL ?? 'http://127.0.0.1:5453', { allowPublic: env.NTFY_ALLOW_PUBLIC === '1' }),
  };
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
    channels.webpush = new WebPushChannel({
      subject: env.VAPID_SUBJECT ?? 'mailto:alerts@undercut.local',
      publicKey: env.VAPID_PUBLIC_KEY,
      privateKey: env.VAPID_PRIVATE_KEY,
    });
  }
  return channels;
}
