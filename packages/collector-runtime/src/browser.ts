import { chromium, type BrowserContext } from 'playwright';

export interface BrowserHandle {
  context: BrowserContext;
  close(): Promise<void>;
}

const VIEWPORT = { width: 1366, height: 900 };

/** Cloud collector: Playwright's bundled headless Chromium, fresh context per process. */
export async function launchHeadlessBrowser(): Promise<BrowserHandle> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: VIEWPORT, locale: 'en-US' });
  return { context, close: () => browser.close() };
}

export interface LocalBrowserOptions {
  /** Persistent profile: cookies and site state survive across runs, like a person's browser. */
  profileDir: string;
  headed: boolean;
  /** Prefer the user's installed Chrome; falls back to Playwright's Chromium if it is missing. */
  channel?: 'chrome' | 'msedge' | undefined;
}

/** Local collector: a real browser profile on the user's machine and residential IP. */
export async function launchLocalBrowser(options: LocalBrowserOptions): Promise<BrowserHandle & { channel: string }> {
  const launch = (channel: string | undefined) =>
    chromium.launchPersistentContext(options.profileDir, {
      headless: !options.headed,
      viewport: VIEWPORT,
      ...(channel ? { channel } : {}),
    });

  let channel: string = options.channel ?? 'chrome';
  let context: BrowserContext;
  try {
    context = await launch(channel);
  } catch {
    channel = 'chromium';
    context = await launch(undefined);
  }
  return { context, channel, close: () => context.close() };
}
