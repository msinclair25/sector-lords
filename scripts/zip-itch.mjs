/**
 * Zip dist/ for itch.io HTML upload (index.html at archive root).
 * Run after: npm run build:itch
 */
import { existsSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';
import { cwd } from 'process';
import { spawnSync } from 'child_process';

const root = cwd();
const dist = join(root, 'dist');
const out = join(root, 'sector-lords-itch.zip');

if (!existsSync(join(dist, 'index.html'))) {
  console.error('dist/index.html missing — run npm run build:itch first');
  process.exit(1);
}

if (existsSync(out)) unlinkSync(out);

// Windows tar (bsdtar) creates zip with -a; index.html stays at archive root
const r = spawnSync('tar', ['-a', '-c', '-f', out, '*'], {
  cwd: dist,
  stdio: 'inherit',
  shell: true,
});
if (r.status !== 0) {
  console.error('tar zip failed — is tar available on PATH?');
  process.exit(r.status ?? 1);
}

const size = statSync(out).size;
console.log(`Wrote ${out} (${(size / 1e6).toFixed(1)} MB)`);
