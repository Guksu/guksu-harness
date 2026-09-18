import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync, existsSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import { createPlan, applyPlan, rollback, status, detectApps } from './harnessManager.mjs';
const fixture = t => { const root = mkdtempSync(join(tmpdir(), 'harness-manager-')); t.after(() => rmSync(root, { recursive: true, force: true })); return root; };
const write = (root, path, content) => { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), content); };

test('진단과 미리보기는 프로젝트 파일을 만들지 않는다', async t => {
  const root = fixture(t);
  assert.equal((await status(root)).installedVersion, null);
  assert.ok(createPlan(root).operations.some(op => op.action === 'create'));
  assert.equal(existsSync(join(root, '.claude')), false);
  assert.equal(existsSync(join(root, '.agents')), false);
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
  assert.equal(applyPlan(createPlan(root, { only: ['.agents/hooks/branchGuard.mjs'] })).changed, 0);
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
  write(root, '.agents/hooks/branchGuard.config.json', '{"protectedBranches":["release"]}');
  applyPlan(createPlan(root, { mode: 'remove' }));
  assert.equal(existsSync(join(root, '.agents/hooks/branchGuard.mjs')), false);
  assert.equal(existsSync(join(root, 'docs/harness-rules.md')), true);
  assert.equal(readFileSync(join(root, 'docs/history/user.md'), 'utf8'), 'keep');
  assert.equal(existsSync(join(root, '.agents/hooks/branchGuard.config.json')), true);
});
test('백업 복원은 적용 전 파일 내용을 복구한다', t => {
  const root = fixture(t);
  write(root, '.claude/settings.json', '{"custom":true}');
  const result = applyPlan(createPlan(root));
  rollback(root, result.backup);
  assert.equal(readFileSync(join(root, '.claude/settings.json'), 'utf8'), '{"custom":true}');
  assert.equal(existsSync(join(root, '.agents/hooks/branchGuard.mjs')), false);
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
  write(root, '.agents/harness-install.json', JSON.stringify({ schemaVersion: 1, files: { '../outside': { hash: 'a'.repeat(64) } }, ownedHooks: [], ownedDeny: [] }));
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
  assert.equal(existsSync(join(root, '.agents/hooks/blockGitMutation.mjs')), true);
});
test('기존 수동 등록은 채택 후에도 소유한 등록으로 간주하지 않는다', t => {
  const root = fixture(t);
  applyPlan(createPlan(root));
  const path = join(root, '.agents/harness-install.json');
  const manifest = JSON.parse(readFileSync(path));
  manifest.ownedHooks = [];
  writeFileSync(path, JSON.stringify(manifest));
  assert.throws(() => applyPlan(createPlan(root, { mode: 'remove' })), /충돌/);
});
test('설정 형식 오류를 진단하되 설정값을 출력하지 않는다', async t => {
  const root = fixture(t);
  write(root, '.agents/hooks/branchGuard.config.json', '{"protectedBranches":"not-array"}');
  const result = await status(root);
  assert.ok(result.issues.some(issue => issue.level === 'error'));
  assert.equal(JSON.stringify(result).includes('not-array'), false);
});

test('직접 수정하지 않은 이전 설치본은 업데이트하고 파일별 상태를 진단한다', async t => {
  const { createHash } = await import('node:crypto');
  const root = fixture(t);
  applyPlan(createPlan(root));
  const path = '.agents/hooks/branchGuard.mjs';
  write(root, path, '// previous release\n');
  const manifestPath = join(root, '.agents/harness-install.json');
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
  assert.equal(existsSync(join(root, '.agents')), false);
  assert.equal(run('plan', root, '--out', planFile).status, 1, '기존 계획을 덮어쓰지 않는다');
  const applied = run('apply', root, '--plan', planFile);
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(JSON.parse(run('status', root, '--json').stdout).trackedFiles, 6);
  const removeFile = join(root, 'remove.json');
  assert.equal(run('plan', root, '--mode', 'remove', '--out', removeFile).status, 0);
  const removed = run('apply', root, '--plan', removeFile);
  assert.equal(removed.status, 0, removed.stderr);
  assert.equal(existsSync(join(root, '.agents/hooks/branchGuard.mjs')), false);
  const restored = run('rollback', root, '--backup', JSON.parse(removed.stdout).backup);
  assert.equal(restored.status, 0, restored.stderr);
  assert.equal(existsSync(join(root, '.agents/hooks/branchGuard.mjs')), true);
});

// ── 앱 선택 (claude · codex · both) ──────────────────────────────────────────
test('앱 추정 — 단서가 없으면 claude, AGENTS.md·.codex가 있으면 codex, 둘 다면 양쪽', t => {
  const root = fixture(t);
  assert.deepEqual(detectApps(root), ['claude']);
  write(root, 'AGENTS.md', '# 프로젝트');
  assert.deepEqual(detectApps(root), ['codex']);
  write(root, 'CLAUDE.md', '# 프로젝트');
  assert.deepEqual(detectApps(root), ['claude', 'codex']);
});
test('codex 설치는 .codex/hooks.json에 상대 경로 명령과 apply_patch matcher로 등록하고 settings.json은 만들지 않는다', async t => {
  const root = fixture(t);
  applyPlan(createPlan(root, { app: 'codex' }));
  assert.equal(existsSync(join(root, '.claude')), false);
  const hooks = JSON.parse(readFileSync(join(root, '.codex/hooks.json'), 'utf8')).hooks;
  const commands = hooks.PreToolUse.flatMap(entry => entry.hooks.map(hook => hook.command));
  assert.ok(commands.includes('node ".agents/hooks/blockGitMutation.mjs"'));
  assert.ok(commands.every(command => !command.includes('CLAUDE_PROJECT_DIR')));
  assert.equal(hooks.PreToolUse.find(entry => entry.matcher.includes('apply_patch')).matcher, 'apply_patch|Edit|Write');
  assert.equal(hooks.Stop, undefined, '--verifier 없이는 Stop을 등록하지 않는다');
  const manifest = JSON.parse(readFileSync(join(root, '.agents/harness-install.json'), 'utf8'));
  assert.deepEqual(manifest.apps, ['codex']);
  assert.ok(manifest.ownedHooks.every(item => item.app === 'codex'));
  assert.deepEqual(manifest.ownedDeny, [], 'Read deny는 claude 전용 권한이다');
  const result = await status(root);
  assert.equal(result.hooks.find(hook => hook.name === 'branchGuard').registered.codex, true);
  assert.equal(result.hooks.find(hook => hook.name === 'branchGuard').registered.claude, false);
  assert.ok(!result.issues.some(issue => issue.message.includes('등록')), '선택한 앱에만 등록을 요구한다');
});
test('both는 두 등록 파일을 모두 쓰고 훅 파일은 한 벌만 둔다', t => {
  const root = fixture(t);
  write(root, '.codex/hooks.json', JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'my-codex-hook' }] }] } }));
  applyPlan(createPlan(root, { app: 'both', verifier: true }));
  const codex = JSON.parse(readFileSync(join(root, '.codex/hooks.json'), 'utf8')).hooks;
  const claude = JSON.parse(readFileSync(join(root, '.claude/settings.json'), 'utf8')).hooks;
  assert.equal(codex.PreToolUse[0].hooks[0].command, 'my-codex-hook', '기존 codex 등록을 보존한다');
  assert.equal(codex.Stop[0].hooks[0].command, 'node ".agents/hooks/verifierGate.mjs"');
  assert.equal(claude.Stop[0].hooks[0].command, 'node "$CLAUDE_PROJECT_DIR/.agents/hooks/verifierGate.mjs"');
  assert.equal(existsSync(join(root, '.agents/hooks/verifierGate.mjs')), true);
  assert.equal(existsSync(join(root, '.claude/hooks')), false);
  assert.equal(applyPlan(createPlan(root)).changed, 0, '앱 선택은 추적 기록에 남아 재적용이 멱등이다');
});
test('codex 제거는 자신이 추가한 등록만 지우고 기존 등록을 남긴다', t => {
  const root = fixture(t);
  write(root, '.codex/hooks.json', JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'my-codex-hook' }] }] } }));
  applyPlan(createPlan(root, { app: 'codex' }));
  applyPlan(createPlan(root, { mode: 'remove' }));
  const codex = JSON.parse(readFileSync(join(root, '.codex/hooks.json'), 'utf8')).hooks;
  assert.deepEqual(codex.PreToolUse.map(entry => entry.hooks[0].command), ['my-codex-hook']);
  assert.equal(existsSync(join(root, '.agents/hooks/branchGuard.mjs')), false);
});

// ── v2.x(.claude/hooks) 설치본 이동 ──────────────────────────────────────────
const installLegacy = (root, { modifyHook = false } = {}) => {
  // v2.3.0 관리자가 만든 형태를 재현한다: .claude/hooks/*.mjs + settings.json 등록 + .claude/harness-install.json
  const { createHash } = require('node:crypto');
  const bundle = name => readFileSync(new URL(`../assets/hooks/${name}.mjs`, import.meta.url), 'utf8');
  const files = {};
  const ownedHooks = [];
  const settings = { hooks: { PreToolUse: [] }, permissions: { deny: ['Read(./.env)'] } };
  for (const name of ['blockGitMutation', 'blockSecretAccess', 'branchGuard']) {
    const content = modifyHook && name === 'branchGuard' ? `${bundle(name)}// local edit\n` : bundle(name);
    write(root, `.claude/hooks/${name}.mjs`, content);
    files[`.claude/hooks/${name}.mjs`] = { hash: createHash('sha256').update(bundle(name)).digest('hex'), version: '2.3.0' };
    const entry = { ...(name === 'branchGuard' ? { matcher: 'Edit|Write|NotebookEdit' } : { matcher: 'Bash' }),
      hooks: [{ type: 'command', command: `node "$CLAUDE_PROJECT_DIR/.claude/hooks/${name}.mjs"` }] };
    settings.hooks.PreToolUse.push(entry);
    ownedHooks.push({ event: 'PreToolUse', entry });
  }
  write(root, '.claude/hooks/branchGuard.config.json', '{"protectedBranches":["release"]}');
  write(root, '.claude/settings.json', JSON.stringify(settings));
  write(root, '.claude/harness-install.json', JSON.stringify({ schemaVersion: 1, version: '2.3.0', profile: 'basic', verifier: false, files, ownedHooks, ownedDeny: ['Read(./.env)'] }));
};
test('이전 설치본은 훅·설정·추적 기록을 .agents/로 옮기고 등록을 새 경로로 바꾼다', async t => {
  const root = fixture(t);
  installLegacy(root);
  const before = await status(root);
  assert.ok(before.issues.some(issue => issue.message.includes('이전 위치')));
  const plan = createPlan(root);
  const actions = Object.fromEntries(plan.operations.map(op => [op.path, op.action]));
  assert.equal(actions['.claude/hooks/branchGuard.mjs'], 'delete');
  assert.equal(actions['.agents/hooks/branchGuard.mjs'], 'create');
  assert.equal(actions['.claude/hooks/branchGuard.config.json'], 'delete');
  assert.equal(actions['.agents/hooks/branchGuard.config.json'], 'create');
  assert.equal(actions['.claude/harness-install.json'], 'delete');
  applyPlan(plan);
  assert.equal(readFileSync(join(root, '.agents/hooks/branchGuard.config.json'), 'utf8'), '{"protectedBranches":["release"]}');
  // 빈 디렉터리는 남길 수 있다(문서화된 동작). 파일이 남지 않았는지 본다.
  assert.deepEqual(readdirSync(join(root, '.claude/hooks')), []);
  assert.equal(existsSync(join(root, '.claude/harness-install.json')), false);
  const settings = JSON.parse(readFileSync(join(root, '.claude/settings.json'), 'utf8'));
  const commands = settings.hooks.PreToolUse.flatMap(entry => entry.hooks.map(hook => hook.command));
  assert.ok(commands.every(command => command.includes('/.agents/hooks/')), commands.join('\n'));
  assert.equal(commands.length, 3, '이전 등록을 새 등록으로 교체하며 중복 등록하지 않는다');
  assert.deepEqual(settings.permissions.deny.slice(0, 1), ['Read(./.env)']);
  const after = await status(root);
  assert.equal(after.installedVersion, after.bundleVersion);
  assert.ok(!after.issues.some(issue => issue.message.includes('이전 위치')));
  assert.equal(applyPlan(createPlan(root)).changed, 0);
});
test('이전 위치의 훅을 사용자가 수정했으면 옮기지 않고 충돌로 보존한다', t => {
  const root = fixture(t);
  installLegacy(root, { modifyHook: true });
  const plan = createPlan(root);
  const conflict = plan.operations.find(op => op.path === '.claude/hooks/branchGuard.mjs');
  assert.equal(conflict.action, 'conflict');
  assert.ok(!plan.operations.some(op => op.path === '.agents/hooks/branchGuard.mjs'));
  assert.throws(() => applyPlan(plan), /충돌/);
  assert.ok(readFileSync(join(root, '.claude/hooks/branchGuard.mjs'), 'utf8').includes('local edit'));
});
test('이전 위치 파일을 수동 등록이 참조하면 이동을 멈추고 충돌로 알린다', t => {
  const root = fixture(t);
  installLegacy(root);
  const path = join(root, '.claude/settings.json');
  const settings = JSON.parse(readFileSync(path, 'utf8'));
  settings.hooks.PreToolUse.push({ matcher: 'Bash', hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/blockGitMutation.mjs" --strict' }] });
  writeFileSync(path, JSON.stringify(settings));
  const plan = createPlan(root);
  assert.equal(plan.operations.find(op => op.path === '.claude/hooks/blockGitMutation.mjs' && op.action === 'conflict')?.reason, '남아 있는 훅 등록이 참조합니다');
  assert.throws(() => applyPlan(plan), /충돌/);
});
