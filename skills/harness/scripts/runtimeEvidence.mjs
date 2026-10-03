// Runtime evidence is descriptive. A CLI version never proves desktop hook support.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

export function runtimeEvidence(root, apps, checks) {
  const command = (binary, args) => {
    const result = spawnSync(binary, args, { cwd: root, encoding: 'utf8', timeout: 2000, maxBuffer: 64 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    return result.status === 0 ? result.stdout.trim() : null;
  };
  const head = command('git', ['rev-parse', '--verify', 'HEAD']);
  const status = command('git', ['status', '--porcelain', '--untracked-files=normal']);
  return {
    capturedAt: new Date().toISOString(),
    node: process.version, platform: process.platform, arch: process.arch,
    repository: { head, dirty: status == null ? null : status.length > 0 },
    checksHash: createHash('sha256').update(JSON.stringify(checks)).digest('hex'),
    apps: Object.fromEntries(apps.map(app => [app, {
      cliVersion: command(app, ['--version'])?.slice(0, 256) || null,
      hookIntegration: 'unverified',
    }])),
    model: null,
    usage: { status: 'unmeasured', tokens: null },
  };
}
