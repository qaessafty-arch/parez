/** Dev helper: runs the API server and the Vite client together. */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const procs = [];
function run(name, cmd, args, color) {
  const p = spawn(cmd, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  const tag = `\x1b[${color}m[${name}]\x1b[0m`;
  p.stdout.on('data', (d) => process.stdout.write(`${tag} ${d}`));
  p.stderr.on('data', (d) => process.stderr.write(`${tag} ${d}`));
  p.on('exit', (code) => {
    console.log(`${tag} exited (${code})`);
    shutdown(code ?? 0);
  });
  procs.push(p);
}

function shutdown(code = 0) {
  for (const p of procs) {
    try { p.kill(); } catch { /* ignore */ }
  }
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

run('server', process.execPath, ['--watch', 'server/src/index.js'], '36');
run('client', process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--config', 'client/vite.config.js'], '35');
