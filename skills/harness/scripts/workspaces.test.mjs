import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { discoverWorkspaces, resolveProjectRoot, selectAffected, changedFiles, verificationPlan } from './workspaces.mjs';
import { diagnose, createCompose, applyCompose, verify, normalizeDecisionValue, planVerification } from './teamCompose.mjs';
import { executeCheck } from '../assets/hooks/verifierGate.mjs';
import { readCurrentBranch } from '../assets/hooks/branchGuard.mjs';

const write = (root, path, text) => { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), text); };
const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function fixture(t, pnpm = false) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'harness-monorepo-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(root, 'package.json', JSON.stringify({ private: true, workspaces: ['apps/*', 'packages/*', '!packages/ignored'], packageManager: pnpm ? 'pnpm@10.0.0' : 'npm@10.0.0' }));
  if (pnpm) write(root, 'pnpm-workspace.yaml', 'packages: ["apps/*", "packages/*", "!packages/ignored"]\n');
  for (const [name, path, deps] of [['web', 'apps/web', { ui: 'workspace:*' }], ['admin', 'apps/admin', { ui: 'workspace:*' }], ['api', 'apps/api', {}], ['ui', 'packages/ui', {}], ['ignored', 'packages/ignored', {}]]) {
    write(root, `${path}/package.json`, JSON.stringify({ name, scripts: { test: `node -e "if(require('./package.json').name !== '${name}') process.exit(1)"` }, dependencies: deps }));
    write(root, `${path}/src/index.js`, 'export const value = 1;\n');
  }
  write(root, 'AGENTS.md', '# Common rules\n');
  write(root, 'apps/AGENTS.md', '# App rules\n');
  write(root, 'apps/web/AGENTS.md', '# Web rules\n');
  write(root, 'apps/web/src/CLAUDE.md', '# Source rules\n');
  git(root, 'init', '-b', 'main');
  git(root, 'add', '.');
  git(root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture');
  return root;
}
test('pnpm/YAML workspace와 제외 glob, 의존 관계, 경로별 규칙을 발견한다', t => {
  const root = fixture(t, true);
  const report = diagnose(join(root, 'apps/web/src'));
  assert.equal(report.root, root);
  assert.equal(report.workspaces.current, 'web');
  assert.equal(report.workspaces.packageManager, 'pnpm');
  assert.equal(report.workspaces.projects.length, 4);
  assert.equal(report.commands.length, 4);
  const web = report.workspaces.projects.find(item => item.name === 'web');
  assert.deepEqual(web.dependencies, ['ui']);
  assert.ok(web.guidance.some(item => item.path === 'apps/AGENTS.md'));
  assert.ok(web.guidance.some(item => item.scope === 'apps/web/src' && item.app === 'claude'));
  assert.ok(!report.decisions['rules.guidance'].value.includes('apps/web/AGENTS.md'), '하위 규칙을 전역 정책으로 합치지 않는다');
});
test('잘못된 YAML·중복 이름은 compose를 차단하고 하위 파일을 보존한다', t => {
  const root = fixture(t, true);
  write(root, 'pnpm-workspace.yaml', 'packages: [\n');
  assert.ok(createCompose(root).conflicts.some(item => item.blocking));
  write(root, 'pnpm-workspace.yaml', 'packages: ["apps/*", "packages/*"]\n');
  write(root, 'apps/api/package.json', '{"name":"web"}');
  assert.ok(discoverWorkspaces(root).issues.some(item => item.message.includes('중복')));
});
test('compose는 패키지 cwd를 보존하고 verify와 Stop 훅이 같은 위치에서 실행한다', async t => {
  const root = fixture(t);
  const before = readFileSync(join(root, 'apps/web/AGENTS.md'), 'utf8');
  applyCompose(createCompose(join(root, 'apps/web'), { app: 'both', set: { 'verification.gate': 'stop-hook' } }));
  assert.equal(readFileSync(join(root, 'apps/web/AGENTS.md'), 'utf8'), before);
  assert.equal(applyCompose(createCompose(root)).changed, 0);
  const report = await verify(root, { run: true, workspace: 'web' });
  assert.equal(report.verification.state, 'passed', JSON.stringify(report.verification));
  assert.equal(report.verification.results.length, 1);
  assert.equal(report.verification.results[0].cwd, 'apps/web');
  assert.equal(report.verification.runtime.usage.tokens, null);
  assert.equal(report.verification.runtime.apps.codex.hookIntegration, 'unverified');
  assert.match(report.verification.runtime.repository.head, /^[a-f0-9]{40}$/);
  const config = JSON.parse(readFileSync(join(root, '.agents/hooks/verifierGate.config.json')));
  assert.ok(config.checks.every(check => check.cwd && check.workspace));
  const result = spawnSync(process.execPath, [join(root, '.agents/hooks/verifierGate.mjs')], { input: JSON.stringify({ cwd: join(root, 'apps/web'), session_id: 'monorepo' }), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.throws(() => planVerification(root, { workspace: 'missing' }), /찾을 수 없/);
});
test('변경 패키지와 역방향 의존 패키지를 선택하고 공통 설정은 전체로 확대한다', t => {
  const inventory = discoverWorkspaces(fixture(t));
  assert.deepEqual(selectAffected(inventory, ['apps/web/src/index.js']).projects, ['web']);
  assert.deepEqual(selectAffected(inventory, ['packages/ui/src/index.js']).projects, ['admin', 'ui', 'web']);
  for (const path of ['pnpm-lock.yaml', 'tsconfig.json', 'packages/deleted/src/index.js', 'packages/ui/package.json']) {
    assert.equal(selectAffected(inventory, [path]).mode, 'all', path);
  }
  assert.equal(selectAffected(inventory, []).mode, 'none');
});
test('Git 비교는 커밋·staged·unstaged·새 파일과 이동 전후 경로를 포함한다', t => {
  const root = fixture(t);
  git(root, 'switch', '-c', 'feat/change');
  write(root, 'apps/api/src/index.js', 'committed');
  git(root, 'add', '.');
  git(root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'change');
  git(root, 'mv', 'packages/ui/src/index.js', 'apps/web/src/moved.js');
  write(root, 'apps/admin/src/index.js', 'unstaged');
  write(root, 'apps/web/src/new file.js', 'new');
  const changes = changedFiles(root, 'main');
  for (const path of ['apps/api/src/index.js', 'packages/ui/src/index.js', 'apps/web/src/moved.js', 'apps/admin/src/index.js', 'apps/web/src/new file.js']) assert.ok(changes.files.includes(path), path);
  const plan = verificationPlan(root, diagnose(root).decisions['verification.checks'].value, { affected: true, base: 'missing' });
  assert.equal(plan.selection.mode, 'all');
  assert.match(plan.selection.reasons[0], /比較|비교/);
});
test('검증 설정은 상대 cwd·timeout·필수 여부를 보존하고 밖으로 나가는 경로를 거부한다', t => {
  const root = fixture(t);
  const input = [{ name: 'web', command: 'node --version', cwd: 'apps/web', workspace: 'web', timeoutMs: 1000, required: false }];
  assert.deepEqual(normalizeDecisionValue('verification.checks', input), input);
  for (const cwd of ['../other', '/tmp', 'C:/outside']) assert.throws(() => normalizeDecisionValue('verification.checks', [{ command: 'true', cwd }]), /상대 경로/);
  symlinkSync(tmpdir(), join(root, 'outside'));
  assert.equal(executeCheck({ command: 'node --version', cwd: 'outside' }, root).state, 'fail');
  const result = executeCheck({ command: 'node -e "setTimeout(()=>{}, 3000)"', timeoutMs: 50 }, root);
  assert.equal(result.state, 'fail');
  assert.equal(result.signal, 'SIGTERM');
});
test('worktree 하위 폴더에서도 workspace 루트와 현재 브랜치를 찾는다', t => {
  const root = fixture(t);
  const worktree = join(root, 'worktree');
  git(root, 'worktree', 'add', '-b', 'feat/worktree-test', worktree);
  const nested = join(worktree, 'apps/web/src');
  assert.equal(resolveProjectRoot(nested), realpathSync(worktree));
  assert.equal(readCurrentBranch({ projectDir: nested }), 'feat/worktree-test');
});
test('verify --plan은 명령을 실행하지 않으며 미지원 runner는 전체 검증한다', t => {
  const root = fixture(t);
  applyCompose(createCompose(root, { app: 'codex' }));
  write(root, 'turbo.json', '{}');
  write(root, 'apps/web/src/index.js', 'changed');
  const plan = planVerification(root, { affected: true, base: 'main' });
  assert.equal(plan.selection.mode, 'all');
  const cli = new URL('../../../bin/guksu-harness.mjs', import.meta.url);
  const result = spawnSync(process.execPath, [cli.pathname, 'verify', join(root, 'apps/web'), '--plan', '--json'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).checks.length, 4);
  assert.equal(existsSync(join(root, 'apps/web/.agents')), false);
});

test('affected 계획은 선행 패키지를 포함하며 명령 ID가 전체 계획과 같다', t => {
  const root = fixture(t);
  const checks = diagnose(root).decisions['verification.checks'].value;
  write(root, 'apps/web/src/index.js', 'changed');
  const all = verificationPlan(root, checks);
  const plan = verificationPlan(root, checks, { affected: true, base: 'main' });
  assert.deepEqual(plan.selection.projects, ['web']);
  assert.deepEqual(plan.selection.prerequisites, ['ui']);
  assert.deepEqual(plan.checks.map(check => check.workspace), ['ui', 'web']);
  for (const check of plan.checks) assert.equal(check.id, all.checks.find(item => item.name === check.name).id);
  const cli = new URL('../../../bin/guksu-harness.mjs', import.meta.url);
  const result = spawnSync(process.execPath, [cli.pathname, 'diagnose', join(root, 'apps/web'), '--json'], { encoding: 'utf8' });
  assert.equal(JSON.parse(result.stdout).workspaces.current, 'web');
});

test('빠진 패키지 검사·오래된 cwd를 성공으로 처리하지 않는다', async t => {
  const root = fixture(t);
  applyCompose(createCompose(root, { app: 'codex', set: { 'verification.checks': [{ command: 'node --version', cwd: 'apps/web', workspace: 'web' }] } }));
  const plan = planVerification(root);
  assert.ok(plan.issues.some(issue => issue.path === 'api'));
  const report = await verify(root, { run: true });
  assert.equal(report.ok, false);
  assert.equal(report.verification.state, 'unverified');
  assert.equal(report.verification.results.length, 0);
  const stale = verificationPlan(root, [{ command: 'node --version', cwd: 'apps/moved', workspace: 'web' }], { workspace: 'web' });
  assert.ok(stale.issues.some(issue => issue.message.includes('현재 구조')));
});

test('선택 검사 실패를 보고하되 필수 검사 실패와 구분한다', async t => {
  const root = fixture(t);
  const checks = [
    { name: 'required', command: 'node --version' },
    { name: 'optional', command: 'node -e "process.exit(1)"', required: false },
  ];
  applyCompose(createCompose(root, { app: 'codex', set: { 'verification.checks': checks, 'verification.gate': 'stop-hook' } }));
  const report = await verify(root, { run: true });
  assert.equal(report.verification.state, 'passed');
  assert.equal(report.ok, true);
  assert.equal(report.verification.results.find(item => item.name === 'optional').required, false);
  const hook = join(root, '.agents/hooks/verifierGate.mjs');
  const stop = id => spawnSync(process.execPath, [hook], { input: JSON.stringify({ session_id: id, cwd: join(root, 'apps/web') }), encoding: 'utf8' });
  const result = stop('optional-check');
  assert.equal(result.status, 0);
  assert.match(result.stderr, /선택 검사 실패/);
  checks[1].required = true;
  applyCompose(createCompose(root, { set: { 'verification.checks': checks } }));
  assert.equal(stop('required-check').status, 2);
  assert.equal((await verify(root, { run: true })).verification.state, 'failed');
});
