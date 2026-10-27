import type { NextConfig } from 'next';

// One .env at the repo root serves every app; real env vars still take precedence.
try {
  process.loadEnvFile(new URL('../../.env', import.meta.url));
} catch {
  // No root .env (CI, production): rely on the environment.
}

const config: NextConfig = {
  // Workspace packages ship TypeScript source; Next compiles them with the app.
  transpilePackages: ['@undercut/core', '@undercut/db'],
  serverExternalPackages: ['postgres'],
};

export default config;
