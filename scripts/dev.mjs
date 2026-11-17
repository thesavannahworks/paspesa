#!/usr/bin/env node
/**
 * `npm run dev` — starts everything for local development in one terminal:
 *   1. the backend (apps/backend, port 3000) — reused if one is already running;
 *   2. the app (Expo) pointed at that backend — QR code and Expo's keys work as usual.
 *
 *   npm run dev            backend + app (scan the QR code with Expo Go, or press w for web)
 *   npm run dev -- --web   backend + app opened in the browser
 *
 * The app reaches the backend through this computer's Wi-Fi address (phones can't use "localhost").
 * A value set in apps/mobile/.env (EXPO_PUBLIC_PASPESA_API_URL) wins over the automatic one.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT ?? 3000);
const web = process.argv.includes('--web');
const isWin = process.platform === 'win32';

const lanAddress = () => {
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) return a.address;
    }
  }
  return 'localhost';
};

const configuredApiUrl = () => {
  const file = join(root, 'apps/mobile/.env');
  if (!existsSync(file)) return '';
  const line = readFileSync(file, 'utf8').split(/\r?\n/).find((l) => l.trim().startsWith('EXPO_PUBLIC_PASPESA_API_URL='));
  return line ? line.split('=').slice(1).join('=').trim() : '';
};

const healthy = async () => {
  try {
    const res = await fetch(`http://localhost:${PORT}/v1/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
};

const children = [];
const stopAll = () => {
  for (const c of children) if (!c.killed) c.kill();
};
process.on('SIGINT', () => { stopAll(); process.exit(0); });
process.on('SIGTERM', () => { stopAll(); process.exit(0); });

// 1. backend
if (await healthy()) {
  console.log(`[dev] backend already running on port ${PORT} — using it`);
} else {
  console.log(`[dev] starting backend on port ${PORT}…`);
  const backend = spawn(isWin ? 'npm.cmd' : 'npm', ['run', 'dev', '-w', '@paspesa/backend'], { cwd: root, shell: isWin, env: { ...process.env, PORT: String(PORT) } });
  children.push(backend);
  const prefix = (chunk) => chunk.toString().split(/\r?\n/).filter((l) => l.trim() && !l.includes('RouterExplorer') && !l.includes('RoutesResolver')).forEach((l) => console.log(`[backend] ${l}`));
  backend.stdout.on('data', prefix);
  backend.stderr.on('data', prefix);
  backend.on('exit', (code) => console.log(`[backend] stopped (${code ?? 'signal'})`));
  for (let i = 0; i < 60 && !(await healthy()); i++) await new Promise((r) => setTimeout(r, 1000));
  if (!(await healthy())) console.log('[dev] backend did not answer yet — the app starts anyway (it works offline)');
}

// 2. app
const apiUrl = configuredApiUrl() || `http://${lanAddress()}:${PORT}`;
console.log(`[dev] app → backend at ${apiUrl}${configuredApiUrl() ? ' (from apps/mobile/.env)' : ''}`);
const app = spawn(isWin ? 'npx.cmd' : 'npx', ['expo', 'start', ...(web ? ['--web'] : [])], {
  cwd: join(root, 'apps/mobile'),
  shell: isWin,
  stdio: 'inherit',
  env: { ...process.env, EXPO_PUBLIC_PASPESA_API_URL: apiUrl },
});
children.push(app);
app.on('exit', (code) => {
  stopAll();
  process.exit(code ?? 0);
});
