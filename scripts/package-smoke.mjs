// Validate the published layout, not the source checkout's node_modules.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'guksu-package-smoke-'));
const run = (binary, args, cwd = root) => {
  const result = spawnSync(binary, args, { cwd, encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.status, 0, `${binary} ${args.join(' ')} failed (${result.error?.code ?? result.signal ?? result.status})\n${result.stderr}\n${result.stdout}`);
  return result.stdout;
};

try {
  const [packed] = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', temp]));
  const files = packed.files.map(item => item.path);
  for (const required of ['bin/guksu-harness.mjs', 'skills/harness/scripts/harnessManager.mjs',
    'skills/harness/scripts/codexHooks.mjs', 'skills/harness/scripts/hookProbeObserver.mjs',
    'skills/harness/assets/hooks/branchGuard.mjs', '.claude-plugin/plugin.json', '.codex-plugin/plugin.json']) {
    assert.ok(files.includes(required), `Missing package file: ${required}`);
  }
  assert.ok(!files.some(path => path.endsWith('.test.mjs') || /^(?:node_modules|test|scripts|benchmark|\.github)\//.test(path)), 'Development files leaked into package');
  const consumer = join(temp, 'consumer');
  mkdirSync(consumer);
  run('npm', ['install', '--prefix', consumer, '--no-audit', '--no-fund', join(temp, packed.filename)], consumer);
  const cli = join(consumer, 'node_modules/.bin/guksu-harness');
  assert.match(run(process.execPath, [cli, '--help'], consumer), /init/);
  const project = join(temp, 'project');
  mkdirSync(project);
  run(process.execPath, [cli, 'init', project, '--app', 'both'], consumer);
  run(process.execPath, [cli, 'check', project], consumer);
  const verification = JSON.parse(run(process.execPath, [cli, 'verify', project, '--json'], consumer));
  assert.equal(verification.ok, true);
  assert.equal(verification.verification.runtime.apps.claude.hookIntegration, 'unverified');
  assert.equal(verification.verification.runtime.apps.codex.hookIntegration, 'unverified');
  console.log('Package layout, installation, CLI init/check/verify passed. App integration remains unverified.');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
