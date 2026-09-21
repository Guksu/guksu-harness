import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync, existsSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import { createPlan, applyPlan, rollback, status, detectApps, eject, mergeThreeWay, bundleRoot } from './harnessManager.mjs';
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
  write(root, '.agents/harness-core-rules.md', 'project rules');
  const plan = createPlan(root);
  assert.ok(plan.operations.some(op => op.action === 'conflict'));
  assert.throws(() => applyPlan(plan), /충돌/);
  assert.equal(readFileSync(join(root, '.agents/harness-core-rules.md'), 'utf8'), 'project rules');
});
test('설치 후 수정한 파일도 보존하며 선택 적용이 가능하다', t => {
  const root = fixture(t);
  applyPlan(createPlan(root));
  write(root, '.agents/harness-core-rules.md', 'local edit');
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
  write(root, '.agents/harness-core-rules.md', 'new user edit');
  assert.throws(() => rollback(root, result.backup), /수정된 파일/);
  assert.equal(readFileSync(join(root, '.agents/harness-core-rules.md'), 'utf8'), 'new user edit');
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

// ── 소유권: 코어 · 공동 · 프로젝트 파일 ──────────────────────────────────────
test('프로젝트 파일(팀 규칙·규칙 포인터)은 없을 때 한 번만 만들고 이후 건드리지 않는다', t => {
  const root = fixture(t);
  applyPlan(createPlan(root, { app: 'both' }));
  for (const path of ['docs/harness-rules.md', 'CLAUDE.md', 'AGENTS.md']) assert.ok(existsSync(join(root, path)), path);
  assert.ok(readFileSync(join(root, 'docs/harness-rules.md'), 'utf8').includes('.agents/harness-core-rules.md'), '팀 규칙 파일은 코어 사본을 가리킨다');
  assert.ok(readFileSync(join(root, 'CLAUDE.md'), 'utf8').includes('## 하네스'));
  write(root, 'docs/harness-rules.md', '# 팀 규칙\n\n1. **우리 규칙.**\n');
  write(root, 'AGENTS.md', '# 우리 프로젝트\n');
  const plan = createPlan(root);
  assert.ok(!plan.operations.some(op => ['docs/harness-rules.md', 'AGENTS.md'].includes(op.path)), '프로젝트 파일은 계획에 오르지 않는다');
  assert.equal(applyPlan(plan).changed, 0);
  assert.equal(readFileSync(join(root, 'AGENTS.md'), 'utf8'), '# 우리 프로젝트\n');
  const manifest = JSON.parse(readFileSync(join(root, '.agents/harness-install.json'), 'utf8'));
  assert.equal(manifest.files['docs/harness-rules.md'], undefined, '프로젝트 파일은 추적하지 않는다');
  assert.ok(manifest.files['.agents/harness-core-rules.md'], '코어 사본은 추적한다');
});
test('기존 CLAUDE.md가 있으면 포인터를 만들지 않고 보존한다', t => {
  const root = fixture(t);
  write(root, 'CLAUDE.md', '# 원래 내용\n');
  applyPlan(createPlan(root, { app: 'claude' }));
  assert.equal(readFileSync(join(root, 'CLAUDE.md'), 'utf8'), '# 원래 내용\n');
  assert.equal(existsSync(join(root, 'AGENTS.md')), false, '선택하지 않은 앱의 포인터는 만들지 않는다');
});
test('코어 규칙 사본을 고치면 충돌이고, eject하면 프로젝트 소유가 되어 업데이트에서 빠진다', async t => {
  const root = fixture(t);
  applyPlan(createPlan(root));
  write(root, '.agents/harness-core-rules.md', '# 우리가 고친 코어 규칙\n');
  assert.throws(() => applyPlan(createPlan(root)), /충돌/);
  assert.throws(() => eject(root, 'docs/harness-rules.md'), /코어 파일에만/);
  const result = eject(root, '.agents/harness-core-rules.md');
  assert.match(result.backup, /harness-backups/);
  const plan = createPlan(root);
  assert.ok(!plan.operations.some(op => op.path === '.agents/harness-core-rules.md'));
  assert.equal(applyPlan(plan).changed, 0);
  assert.equal(readFileSync(join(root, '.agents/harness-core-rules.md'), 'utf8'), '# 우리가 고친 코어 규칙\n');
  const s = await status(root);
  assert.deepEqual(s.ejected, ['.agents/harness-core-rules.md']);
  assert.throws(() => eject(root, '.agents/harness-core-rules.md'), /추적 중인 파일이 아닙니다/);
  // 되돌리기: 파일을 지우고 update하면 다시 코어 파일로 생성된다... 단 ejected 목록에 있으므로 생성되지 않는다 — 명시적 정책 확인
  rmSync(join(root, '.agents/harness-core-rules.md'));
  applyPlan(createPlan(root, { mode: 'remove' }));
  assert.equal(existsSync(join(root, '.agents/hooks/branchGuard.mjs')), false, '제거는 eject된 파일과 무관하게 나머지를 정리한다');
});
test('eject한 훅 파일은 제거 때도 지우지 않는다', t => {
  const root = fixture(t);
  applyPlan(createPlan(root));
  eject(root, '.agents/hooks/branchGuard.mjs');
  applyPlan(createPlan(root, { mode: 'remove' }));
  assert.equal(existsSync(join(root, '.agents/hooks/branchGuard.mjs')), true);
  assert.equal(existsSync(join(root, '.agents/hooks/blockGitMutation.mjs')), false);
});

// ── v3.x(docs/harness-rules.md를 코어 사본으로 추적) 변환 ─────────────────────
const installV3 = (root, { modifyRules = false } = {}) => {
  const { createHash } = require('node:crypto');
  const rules = readFileSync(new URL('../assets/harness-rules.md', import.meta.url), 'utf8');
  write(root, 'docs/harness-rules.md', modifyRules ? `${rules}\n8. **우리 팀 규칙.** 설명.\n` : rules);
  write(root, '.agents/harness-install.json', JSON.stringify({ schemaVersion: 1, version: '3.0.0', profile: 'basic', verifier: false, apps: ['claude'],
    files: { 'docs/harness-rules.md': { hash: createHash('sha256').update(rules).digest('hex'), version: '3.0.0' } }, ownedHooks: [], ownedDeny: [] }));
};
test('v3 규칙 파일이 원본 그대로면 팀 규칙 파일로 바꾸고 코어 사본을 만든다', async t => {
  const root = fixture(t);
  installV3(root);
  assert.ok((await status(root)).issues.some(issue => issue.message.includes('v3 구조')));
  const plan = createPlan(root);
  const rulesOp = plan.operations.find(op => op.path === 'docs/harness-rules.md');
  assert.equal(rulesOp.action, 'update');
  assert.equal(plan.operations.find(op => op.path === '.agents/harness-core-rules.md').action, 'create');
  applyPlan(plan);
  const team = readFileSync(join(root, 'docs/harness-rules.md'), 'utf8');
  assert.ok(team.includes('팀 규칙') && !team.includes('1. **git은'), '코어 전문이 팀 파일에서 사라진다');
  const manifest = JSON.parse(readFileSync(join(root, '.agents/harness-install.json'), 'utf8'));
  assert.equal(manifest.files['docs/harness-rules.md'], undefined);
  assert.ok(!(await status(root)).issues.some(issue => issue.message.includes('v3 구조')));
  assert.equal(applyPlan(createPlan(root)).changed, 0);
});
test('v3 규칙 파일을 팀이 고쳤으면 그대로 두고 추적만 해제하며 정리 방법을 안내한다', async t => {
  const root = fixture(t);
  installV3(root, { modifyRules: true });
  const plan = createPlan(root);
  const rulesOp = plan.operations.find(op => op.path === 'docs/harness-rules.md');
  assert.equal(rulesOp.action, 'preserve');
  assert.ok(!plan.operations.some(op => op.action === 'conflict'), '팀 수정본은 충돌이 아니라 보존이다');
  applyPlan(plan);
  assert.ok(readFileSync(join(root, 'docs/harness-rules.md'), 'utf8').includes('우리 팀 규칙'));
  assert.ok(existsSync(join(root, '.agents/harness-core-rules.md')));
  const s = await status(root);
  assert.ok(s.issues.some(issue => issue.message.includes('코어 규칙 전문이 남아 있습니다')));
});

// ── 공동 파일(문서 템플릿) 3-way 병합 ────────────────────────────────────────
test('3-way 병합 — 다른 곳을 고치면 합치고, 같은 곳을 고치면 충돌이다', () => {
  const base = 'a\nb\nc\n';
  assert.equal(mergeThreeWay({ ours: 'a\nB-team\nc\n', base, theirs: 'a\nb\nc\nd-core\n' }).merged, 'a\nB-team\nc\nd-core\n');
  assert.equal(mergeThreeWay({ ours: 'a\nB-team\nc\n', base, theirs: 'a\nX\nc\n' }).conflict, true);
  assert.equal(mergeThreeWay({ ours: base, base, theirs: base }).merged, base);
});
// 번들 템플릿을 잠시 바꿔 "새 버전"을 흉내 낸다 — 계획은 번들 파일을 읽으므로 실제 업데이트와 같은 경로를 탄다.
const withBundleTemplate = (t, name, mutate) => {
  const path = join(bundleRoot, `skills/history/assets/templates/${name}.md`);
  const original = readFileSync(path, 'utf8');
  writeFileSync(path, mutate(original));
  t.after(() => writeFileSync(path, original));
  return original;
};
test('설치는 템플릿 원본 사본을 .agents/harness-base/에 두고, 제거는 사본을 지운다', t => {
  const root = fixture(t);
  applyPlan(createPlan(root));
  const base = join(root, '.agents/harness-base/docs/templates/history.md');
  assert.equal(readFileSync(base, 'utf8'), readFileSync(join(root, 'docs/templates/history.md'), 'utf8'));
  applyPlan(createPlan(root, { mode: 'remove' }));
  assert.equal(existsSync(base), false);
  assert.equal(existsSync(join(root, 'docs/templates/history.md')), true, '문서 자체는 보존한다');
});
test('팀이 고친 템플릿은 새 버전과 3-way 병합되고 사본이 갱신된다', async t => {
  const root = fixture(t);
  applyPlan(createPlan(root));
  const teamEdit = content => content.replace('## 5. 주의사항', '## 5. 주의사항\n\n{팀 추가: 담당자 이름}');
  write(root, 'docs/templates/history.md', teamEdit(readFileSync(join(root, 'docs/templates/history.md'), 'utf8')));
  assert.equal((await status(root)).files.find(f => f.path === 'docs/templates/history.md').state, 'modified');
  const original = withBundleTemplate(t, 'history', content => content.replace('# {작업명}', '# {작업명} (v-next)'));
  const plan = createPlan(root);
  const op = plan.operations.find(op => op.path === 'docs/templates/history.md');
  assert.equal(op.action, 'merge', op.reason);
  assert.ok(op.after.includes('(v-next)') && op.after.includes('{팀 추가: 담당자 이름}'), '팀 수정과 코어 변경이 모두 남는다');
  assert.equal(plan.operations.find(op => op.path === '.agents/harness-base/docs/templates/history.md').action, 'update');
  applyPlan(plan);
  assert.equal(readFileSync(join(root, '.agents/harness-base/docs/templates/history.md'), 'utf8'), readFileSync(join(bundleRoot, 'skills/history/assets/templates/history.md'), 'utf8'));
  const after = await status(root);
  const file = after.files.find(f => f.path === 'docs/templates/history.md');
  assert.equal(file.state, 'customized');
  assert.equal(file.base, 'present');
  assert.equal(applyPlan(createPlan(root)).changed, 0, '병합 결과를 추적하므로 재적용은 멱등이다');
  void original;
});
test('같은 곳을 고쳤으면 충돌로 보존하고 사본도 바꾸지 않는다', t => {
  const root = fixture(t);
  applyPlan(createPlan(root));
  write(root, 'docs/templates/history.md', readFileSync(join(root, 'docs/templates/history.md'), 'utf8').replace('# {작업명}', '# {작업명} — 팀'));
  withBundleTemplate(t, 'history', content => content.replace('# {작업명}', '# {작업명} — 코어'));
  const plan = createPlan(root);
  const op = plan.operations.find(op => op.path === 'docs/templates/history.md');
  assert.equal(op.action, 'conflict');
  assert.match(op.reason, /같은 곳/);
  assert.ok(!plan.operations.some(op => op.path.startsWith('.agents/harness-base/')), '충돌이면 사본을 갱신하지 않는다');
  assert.throws(() => applyPlan(plan), /충돌/);
});
test('사본이 없는 설치본(v4.0)의 수정 템플릿은 보존하고 사본을 등록해 다음부터 병합한다', async t => {
  const root = fixture(t);
  applyPlan(createPlan(root));
  rmSync(join(root, '.agents/harness-base'), { recursive: true });
  write(root, 'docs/templates/handoff.md', `${readFileSync(join(root, 'docs/templates/handoff.md'), 'utf8')}\n팀 추가 줄\n`);
  const plan = createPlan(root);
  const op = plan.operations.find(op => op.path === 'docs/templates/handoff.md');
  assert.equal(op.action, 'preserve');
  assert.equal(plan.operations.find(op => op.path === '.agents/harness-base/docs/templates/handoff.md').action, 'create');
  applyPlan(plan);
  assert.ok(readFileSync(join(root, 'docs/templates/handoff.md'), 'utf8').endsWith('팀 추가 줄\n'));
  assert.equal((await status(root)).files.find(f => f.path === 'docs/templates/handoff.md').state, 'customized');
  // 다음 버전이 나오면 병합된다 — 코어는 파일 앞쪽을, 팀은 끝을 고쳤으므로 겹치지 않는다
  withBundleTemplate(t, 'handoff', content => `<!-- 코어 추가 줄 -->\n${content}`);
  const next = createPlan(root);
  assert.equal(next.operations.find(op => op.path === 'docs/templates/handoff.md').action, 'merge');
});
test('복원은 병합 원본 사본도 되돌린다', t => {
  const root = fixture(t);
  const result = applyPlan(createPlan(root));
  rollback(root, result.backup);
  assert.equal(existsSync(join(root, '.agents/harness-base')), false || existsSync(join(root, '.agents/harness-base/docs/templates/history.md')) === false);
});

// ── --ci: 워크플로 파일은 프로젝트 파일이다 ────────────────────────────────
test('ci 옵션은 워크플로를 없을 때만 만들고 이후 건드리지 않는다', t => {
  const root = fixture(t);
  applyPlan(createPlan(root, { ci: true }));
  const path = join(root, '.github/workflows/harness-check.yml');
  assert.ok(readFileSync(path, 'utf8').includes('guksu-harness'));
  write(root, '.github/workflows/harness-check.yml', 'name: mine\n');
  applyPlan(createPlan(root, { ci: true }));
  assert.equal(readFileSync(path, 'utf8'), 'name: mine\n');
  assert.ok(!createPlan(root).operations.some(op => op.path.startsWith('.github/')), 'ci를 다시 주지 않으면 계획에 오르지 않는다');
});
