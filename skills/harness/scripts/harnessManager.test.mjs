import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createPlan, applyPlan, rollback, status } from './harnessManager.mjs';
const fixture = t => { const root = mkdtempSync(join(tmpdir(), 'harness-manager-')); t.after(() => rmSync(root, { recursive: true, force: true })); return root; };
const write = (root, path, content) => { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), content); };

test('진단과 미리보기는 프로젝트 파일을 만들지 않는다', async t => {
  const root = fixture(t);
  assert.equal((await status(root)).installedVersion, null);
  assert.ok(createPlan(root).operations.some(op => op.action === 'create'));
  assert.equal(existsSync(join(root, '.claude')), false);
});
test('설정 병합은 기존 훅·권한을 보존하고 재적용은 멱등이다', t => {
  const root = fixture(t);
  const custom = { matcher: 'Read', hooks: [{ type: 'command', command: 'my-hook' }] };
  write(root, '.claude/settings.json', JSON.stringify({ custom: true, hooks: { PreToolUse: [custom] }, permissions: { allow: ['Read(*)'] } }));
  applyPlan(createPlan(root));
  const settings = JSON.parse(readFileSync(join(root, '.claude/settings.json')));
  assert.equal(settings.custom, true);
  assert.deepEqual(settings.hooks.PreToolUse[0], custom);
  assert.deepEqual(settings.permissions.allow, ['Read(*)']);
  assert.equal(applyPlan(createPlan(root)).changed, 0);
});
test('추적되지 않은 파일은 덮어쓰지 않고 충돌을 알린다', t => {
  const root = fixture(t);
  write(root, 'docs/harness-rules.md', 'project rules');
  const plan = createPlan(root);
  assert.ok(plan.operations.some(op => op.action === 'conflict'));
  assert.throws(() => applyPlan(plan), /충돌/);
  assert.equal(readFileSync(join(root, 'docs/harness-rules.md'), 'utf8'), 'project rules');
});
test('설치 후 수정한 파일도 보존하며 선택 적용이 가능하다', t => {
  const root = fixture(t);
  applyPlan(createPlan(root));
  write(root, 'docs/harness-rules.md', 'local edit');
  assert.throws(() => applyPlan(createPlan(root)), /충돌/);
  assert.equal(applyPlan(createPlan(root, { only: ['.claude/hooks/branchGuard.mjs'] })).changed, 0);
});
test('미리보기 이후 수정하거나 계획을 조작하면 적용을 거부한다', t => {
  const root = fixture(t);
  const plan = createPlan(root);
  write(root, '.claude/settings.json', '{}');
  assert.throws(() => applyPlan(plan), /바뀌었습니다/);
  const changed = createPlan(root);
  changed.operations[0].after = 'malicious';
  assert.throws(() => applyPlan(changed), /바뀌었습니다/);
});
test('제거는 기록·설정·문서를 보존하고 자신이 추가한 훅만 해제한다', t => {
  const root = fixture(t);
  applyPlan(createPlan(root));
  write(root, 'docs/history/user.md', 'keep');
  write(root, '.claude/hooks/branchGuard.config.json', '{"protectedBranches":["release"]}');
  applyPlan(createPlan(root, { mode: 'remove' }));
  assert.equal(existsSync(join(root, '.claude/hooks/branchGuard.mjs')), false);
  assert.equal(existsSync(join(root, 'docs/harness-rules.md')), true);
  assert.equal(readFileSync(join(root, 'docs/history/user.md'), 'utf8'), 'keep');
  assert.equal(existsSync(join(root, '.claude/hooks/branchGuard.config.json')), true);
});
test('백업 복원은 적용 전 파일 내용을 복구한다', t => {
  const root = fixture(t);
  write(root, '.claude/settings.json', '{"custom":true}');
  const result = applyPlan(createPlan(root));
  rollback(root, result.backup);
  assert.equal(readFileSync(join(root, '.claude/settings.json'), 'utf8'), '{"custom":true}');
  assert.equal(existsSync(join(root, '.claude/hooks/branchGuard.mjs')), false);
});
test('적용 후 변경한 파일은 백업으로 덮어쓰지 않는다', t => {
  const root = fixture(t);
  const result = applyPlan(createPlan(root));
  write(root, 'docs/harness-rules.md', 'new user edit');
  assert.throws(() => rollback(root, result.backup), /수정된 파일/);
  assert.equal(readFileSync(join(root, 'docs/harness-rules.md'), 'utf8'), 'new user edit');
});
test('루트 밖을 향하는 심볼릭 링크는 거부한다', t => {
  const root = fixture(t), outside = fixture(t);
  symlinkSync(outside, join(root, '.claude'));
  assert.throws(() => createPlan(root), /심볼릭 링크/);
  assert.equal(existsSync(join(outside, 'settings.json')), false);
});
test('추적 기록의 경로 조작은 거부한다', t => {
  const root = fixture(t);
  write(root, '.claude/harness-install.json', JSON.stringify({ schemaVersion: 1, files: { '../outside': { hash: 'a'.repeat(64) } }, ownedHooks: [], ownedDeny: [] }));
  assert.throws(() => createPlan(root), /파일 항목/);
});

test('사용자가 수정한 훅 등록이 남으면 파일을 제거하지 않는다', t => {
  const root = fixture(t);
  applyPlan(createPlan(root));
  const path = join(root, '.claude/settings.json');
  const settings = JSON.parse(readFileSync(path));
  settings.hooks.PreToolUse[0].matcher = 'Bash|Other';
  writeFileSync(path, JSON.stringify(settings));
  assert.throws(() => applyPlan(createPlan(root, { mode: 'remove' })), /충돌/);
  assert.equal(existsSync(join(root, '.claude/hooks/blockGitMutation.mjs')), true);
});
test('기존 수동 등록은 채택 후에도 소유한 등록으로 간주하지 않는다', t => {
  const root = fixture(t);
  applyPlan(createPlan(root));
  const path = join(root, '.claude/harness-install.json');
  const manifest = JSON.parse(readFileSync(path));
  manifest.ownedHooks = [];
  writeFileSync(path, JSON.stringify(manifest));
  assert.throws(() => applyPlan(createPlan(root, { mode: 'remove' })), /충돌/);
});
test('설정 형식 오류를 진단하되 설정값을 출력하지 않는다', async t => {
  const root = fixture(t);
  write(root, '.claude/hooks/branchGuard.config.json', '{"protectedBranches":"not-array"}');
  const result = await status(root);
  assert.ok(result.issues.some(issue => issue.level === 'error'));
  assert.equal(JSON.stringify(result).includes('not-array'), false);
});

test('직접 수정하지 않은 이전 설치본은 업데이트하고 파일별 상태를 진단한다', async t => {
  const { createHash } = await import('node:crypto');
  const root = fixture(t);
  applyPlan(createPlan(root));
  const path = '.claude/hooks/branchGuard.mjs';
  write(root, path, '// previous release\n');
  const manifestPath = join(root, '.claude/harness-install.json');
  const manifest = JSON.parse(readFileSync(manifestPath));
  manifest.files[path] = { hash: createHash('sha256').update('// previous release\n').digest('hex'), version: '2.2.0' };
  writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.equal((await status(root)).files.find(file => file.path === path).state, 'update-available');
  const plan = createPlan(root);
  assert.equal(plan.operations.find(op => op.path === path).action, 'update');
  applyPlan(plan);
  assert.equal((await status(root)).files.find(file => file.path === path).state, 'current');
});

test('CLI로 미리보기·적용·진단·제거·복원을 순서대로 실행한다', async t => {
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const root = fixture(t);
  const cli = fileURLToPath(new URL('./harnessManager.mjs', import.meta.url));
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  const planFile = join(root, 'plan.json');
  assert.equal(run('plan', root, '--out', planFile).status, 0);
  assert.equal(existsSync(join(root, '.claude')), false);
  assert.equal(run('plan', root, '--out', planFile).status, 1, '기존 계획을 덮어쓰지 않는다');
  const applied = run('apply', root, '--plan', planFile);
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(JSON.parse(run('status', root, '--json').stdout).trackedFiles, 6);
  const removeFile = join(root, 'remove.json');
  assert.equal(run('plan', root, '--mode', 'remove', '--out', removeFile).status, 0);
  const removed = run('apply', root, '--plan', removeFile);
  assert.equal(removed.status, 0, removed.stderr);
  assert.equal(existsSync(join(root, '.claude/hooks/branchGuard.mjs')), false);
  const restored = run('rollback', root, '--backup', JSON.parse(removed.stdout).backup);
  assert.equal(restored.status, 0, restored.stderr);
  assert.equal(existsSync(join(root, '.claude/hooks/branchGuard.mjs')), true);
});
