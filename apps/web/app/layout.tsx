import type { Metadata } from 'next';
import { Archivo } from 'next/font/google';
import Link from 'next/link';
import type { ReactNode } from 'react';
import './globals.css';

const archivo = Archivo({ subsets: ['latin'], axes: ['wdth'], variable: '--font-archivo', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'Undercut', template: '%s · Undercut' },
  description: 'Track the price of anything, on any site, even the ones that block bots.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={archivo.variable}>
      <body className="min-h-screen">
        <header className="border-b border-rule bg-surface">
          <nav className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 sm:gap-6 sm:px-6" aria-label="Main">
            <Link href="/" className="flex items-center gap-2 text-[17px] font-bold tracking-tight">
              <Wordmark />
              Undercut
            </Link>
            <div className="flex items-center gap-4 text-sm text-ink-2">
              <Link href="/" className="hover:text-ink">
                Watches
              </Link>
              <Link href="/devices" className="hover:text-ink">
                Devices
              </Link>
            </div>
            <Link
              href="/watches/new"
              className="ml-auto rounded-md bg-accent px-3 py-1.5 text-sm font-semibold whitespace-nowrap text-accent-ink hover:opacity-90"
            >
              New watch
            </Link>
          </nav>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">{children}</main>
      </body>
    </html>
  );
}

/** A price line that steps down under a cut: the product in one glyph. */
function Wordmark() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
      <rect x="0.5" y="0.5" width="21" height="21" rx="5" fill="var(--ink)" />
      <path d="M4 7h5l3 4 2-2 4 6" fill="none" stroke="var(--tag)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
