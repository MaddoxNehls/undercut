import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

interface Route {
  status: number;
  file?: string;
  body?: string;
  type?: string;
  headers?: Record<string, string>;
}

/** Local stand-ins for the pages a collector meets in the wild. */
const ROUTES: Record<string, Route> = {
  '/robots.txt': { status: 200, type: 'text/plain', body: 'User-agent: *\nDisallow: /private/\n' },
  '/product': { status: 200, file: 'product.html' },
  '/spa-product': { status: 200, file: 'spa-product.html' },
  '/private/product': { status: 200, file: 'product.html' },
  '/challenge': { status: 403, file: 'waf-challenge.html' },
  '/soft-challenge': { status: 200, file: 'waf-challenge.html' },
  '/rate-limited': { status: 429, type: 'text/plain', body: 'Too Many Requests', headers: { 'retry-after': '120' } },
  '/shell': { status: 200, file: 'app-shell.html' },
  '/redesigned': { status: 200, file: 'redesigned.html' },
  '/down': { status: 503, type: 'text/plain', body: 'Service Unavailable' },
};

export interface FixtureServer {
  url: (path: string) => string;
  close: () => Promise<void>;
}

export async function startFixtureServer(): Promise<FixtureServer> {
  const server: Server = createServer((req, res) => {
    const route = ROUTES[new URL(req.url ?? '/', 'http://localhost').pathname];
    if (!route) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      return;
    }
    const send = (body: string) =>
      res.writeHead(route.status, { 'content-type': route.type ?? 'text/html; charset=utf-8', ...route.headers }).end(body);
    if (route.file) readFile(`${FIXTURES}${route.file}`, 'utf8').then(send, () => res.writeHead(500).end());
    else send(route.body ?? '');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: (path) => `http://127.0.0.1:${port}${path}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
