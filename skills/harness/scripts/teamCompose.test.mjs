// 팀 맞춤 구성(진단 → 결정 → 명세 → 적용 → 확인)의 인수 시나리오. docs/design/2026-09-26-team-compose.md §7을 고정한다.
// 문구 존재가 아니라 파일 내용·해시·종료 코드·상태 목록으로 동작을 검사한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { diagnose, createCompose, applyCompose, verify, parseDecisionValue, workflowCommands, workflowBranches, renderPolicySection, decisionKeys } from './teamCompose.mjs';
import { rollback, createPlan, applyPlan, exportPreset, importPreset, teamSpecPath } from './harnessManager.mjs';

const fixture = t => { const root = mkdtempSync(join(tmpdir(), 'team-compose-')); t.after(() => rmSync(root, { recursive: true, force: true })); return root; };
const write = (root, path, content) => { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), content); };
const readAt = (root, path) => readFileSync(join(root, path), 'utf8');
const readJson = (root, path) => JSON.parse(readAt(root, path));
const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const listAll = root => {
  const out = [];
  const walk = dir => { for (const name of readdirSync(dir)) { const abs = join(dir, name); const rel = relative(root, abs); if (rel.startsWith('.git') && !rel.startsWith('.github')) continue; if (rel.startsWith('.agents/harness-backups')) continue; if (statSync(abs).isDirectory()) walk(abs); else out.push(rel); } };
  walk(root);
  return out.sort();
};
const changedPaths = plan => plan.operations.filter(op => op.action !== 'unchanged').map(op => op.path).sort();
const states = report => Object.fromEntries(report.items.map(item => [item.subject, item.state]));

// 시나리오 1 — 지침·하네스가 거의 없는 프로젝트
const scenarioBare = root => {
  git(root, 'init', '-q', '-b', 'main');
  write(root, 'package.json', JSON.stringify({ name: 'demo', version: '1.0.0' }, null, 2));
  write(root, 'src/index.js', 'console.log(1);\n');
};
// 시나리오 2 — 팀 규칙·CI·테스트 명령이 이미 있는 프로젝트 (origin/HEAD → main, feat/·fix/ 브랜치, CLAUDE.md 팀 내용)
const CLAUDE_TEAM = '# 데모 서비스\n\n## 규칙\n- 브랜치는 feat/, fix/ 접두어를 쓴다.\n- AI는 커밋하지 않는다. 커밋·푸시는 사람이 한다.\n- 한국어로 답한다. 커밋 메시지는 영어로 쓰지 않는다.\n';
const scenarioTeam = root => {
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 'dev@example.com'); git(root, 'config', 'user.name', 'dev');
  write(root, 'README.md', '# demo\n');
  git(root, 'add', '.'); git(root, 'commit', '-q', '-m', 'init');
  git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  git(root, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  git(root, 'branch', 'feat/login'); git(root, 'branch', 'fix/typo');
  write(root, 'CLAUDE.md', CLAUDE_TEAM);
  write(root, 'CONTRIBUTING.md', '# 기여 가이드\n\nPR 전에 npm test를 돌린다.\n');
  write(root, 'package.json', JSON.stringify({ name: 'demo', scripts: { test: 'node -e "process.exit(0)"', lint: 'eslint .', build: 'tsc -p .' } }, null, 2));
  write(root, '.github/workflows/ci.yml', 'name: ci\non:\n  push:\n    branches: [main]\n  pull_request:\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: npm ci\n      - run: npm test\n      - run: |\n          npm run lint\n');
};
// 시나리오 3 — 지침·설정이 충돌하고 검증 명령을 실행할 수 없는 프로젝트
const scenarioConflict = root => {
  git(root, 'init', '-q', '-b', 'main');
  write(root, 'CLAUDE.md', '# 서비스\n\nAI는 커밋하지 않는다.\n');
  write(root, '.agents/hooks/blockGitMutation.config.json', '{"allowCommitPush": true}\n');
  write(root, '.agents/hooks/branchGuard.config.json', '{"protectedBranches": ["master"]}\n');
  write(root, 'package.json', JSON.stringify({ name: 'demo', scripts: { test: 'echo "Error: no test specified" && exit 1' } }, null, 2));
  write(root, '.github/workflows/ci.yml', 'on: push\njobs:\n  lint:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm run lint\n');
};

test('시나리오 1 — 진단은 사실·추정·질문을 나누고 파일을 만들지 않는다', t => {
  const root = fixture(t);
  scenarioBare(root);
  const before = listAll(root);
  const report = diagnose(root);
  assert.deepEqual(listAll(root), before, '진단은 파일을 만들지 않는다');
  const facts = Object.fromEntries(report.facts.map(fact => [fact.id, fact]));
  assert.equal(facts['git.baseBranch'].value, 'main');
  assert.deepEqual(facts['rules.guidance'].value, []);
  assert.ok(facts['scripts.none'], '검증 명령이 없다는 사실');
  assert.equal(facts['harness.installed'].value, false);
  assert.deepEqual(report.assumptions.map(item => item.id).sort(), ['protection.protectedBranches', 'rules.branchPrefixes']);
  assert.deepEqual(report.conflicts, []);
  assert.deepEqual(report.questions.map(q => q.key), ['apps', 'protection.allowCommitPush', 'verification.checks', 'records.history'],
    '검증 명령이 없으니 gate는 묻지 않고, 단서 없는 앱과 권한·기록만 묻는다');
  for (const q of report.questions) assert.ok(q.question && (q.options?.every(o => o.impact) || q.impact), `${q.key} 질문에는 영향 설명이 있다`);
  assert.equal(report.decisions['protection.allowCommitPush'].value, false, '미확인 권한의 기본값은 차단');
  assert.equal(report.decisions['verification.gate'].status, 'evidence');
});

test('시나리오 1 — compose는 미리보기에서 파일을 만들지 않고, 적용하면 명세·설정·규칙·포인터가 생기며 재적용은 변경 0건이다', async t => {
  const root = fixture(t);
  scenarioBare(root);
  const before = listAll(root);
  const preview = createCompose(root, { app: 'both' });
  assert.deepEqual(listAll(root), before, '미리보기는 파일을 만들지 않는다');
  assert.equal(preview.conflicts.length, 0);
  assert.equal(JSON.stringify(createCompose(root, { app: 'both' })), JSON.stringify(preview), '계획은 결정적이다');
  const result = applyCompose(preview);
  assert.ok(result.changed > 0 && result.backup);
  for (const path of ['.agents/hooks/branchGuard.mjs', '.agents/hooks/blockGitMutation.mjs', '.agents/hooks/blockSecretAccess.mjs', '.agents/harness-core-rules.md',
    '.claude/settings.json', '.codex/hooks.json', 'CLAUDE.md', 'AGENTS.md', 'docs/harness-rules.md', teamSpecPath]) assert.ok(existsSync(join(root, path)), path);
  assert.deepEqual(readJson(root, '.agents/hooks/branchGuard.config.json'), { protectedBranches: ['main'] });
  assert.deepEqual(readJson(root, '.agents/hooks/blockGitMutation.config.json'), { allowCommitPush: false, requireHistoryDoc: false });
  const spec = readJson(root, teamSpecPath);
  assert.deepEqual(decisionKeys.filter(key => spec.decisions[key].status === 'pending'), ['protection.allowCommitPush', 'verification.checks', 'records.history']);
  assert.equal(spec.decisions.apps.status, 'confirmed', '--app은 팀 결정이다');
  assert.ok(spec.generated['.agents/hooks/branchGuard.config.json'] && spec.generated['docs/harness-rules.md']);
  const rules = readAt(root, 'docs/harness-rules.md');
  assert.match(rules, /<!-- guksu-harness:team-policy start -->[\s\S]*<!-- guksu-harness:team-policy end -->/);
  assert.match(rules, /보호 브랜치: `main`/);
  assert.match(rules, /커밋·푸시: 차단/);
  assert.equal(applyCompose(createCompose(root, { app: 'both' })).changed, 0, '같은 구성을 다시 적용하면 변경이 없다');
  const check = await verify(root);
  const byState = states(check);
  assert.equal(check.summary.failed, 0);
  assert.equal(byState['branchGuard 스크립트 — 보호 브랜치 편집'], 'verified');
  assert.equal(byState['blockGitMutation 스크립트 — 커밋 (차단 설정)'], 'verified');
  assert.equal(byState['blockSecretAccess 스크립트 — .env 읽기'], 'verified');
  assert.equal(byState['claude 앱 안에서 훅 실행'], 'unverified');
  assert.equal(byState['codex 앱 안에서 훅 실행'], 'unverified');
  assert.equal(byState['검증 명령'], 'unverified');
  assert.deepEqual(check.pending, ['protection.allowCommitPush', 'verification.checks', 'records.history']);
});

test('시나리오 2 — 명시된 정책은 다시 묻지 않고 근거로 쓴다', t => {
  const root = fixture(t);
  scenarioTeam(root);
  const report = diagnose(root);
  assert.deepEqual(report.questions.map(q => q.key), ['verification.gate', 'records.history']);
  const d = report.decisions;
  assert.equal(d['rules.baseBranch'].value, 'main');
  assert.equal(d['rules.baseBranch'].status, 'evidence');
  assert.deepEqual(d['rules.branchPrefixes'], { value: ['feat/', 'fix/'], status: 'evidence', basis: '지침 문서에 적힌 접두어', evidence: ['CLAUDE.md:4'] });
  assert.equal(d['protection.allowCommitPush'].value, false);
  assert.equal(d['protection.allowCommitPush'].status, 'evidence');
  assert.deepEqual(d['protection.allowCommitPush'].evidence, ['CLAUDE.md:5'], '"커밋 메시지는 영어로 쓰지 않는다"는 금지 문구로 읽지 않는다');
  assert.deepEqual(d.apps.value, ['claude']);
  assert.deepEqual(d['rules.guidance'].value, ['CLAUDE.md', 'CONTRIBUTING.md']);
  assert.deepEqual(d['verification.checks'].value.map(c => c.command), ['npm test', 'npm run lint', 'npm run build']);
  assert.deepEqual(report.commands.map(c => [c.name, c.runnable]), [['test', 'needs-install'], ['lint', 'needs-install'], ['build', 'needs-install']], '존재와 실행 가능은 다르다');
  assert.equal(report.commands.find(c => c.name === 'test').source, 'package.json#scripts.test, .github/workflows/ci.yml', 'CI에서도 쓰는 명령은 출처를 합친다');
  assert.equal(report.facts.find(f => f.id === 'ci.branches').value[0], 'main');
  assert.deepEqual(report.conflicts, []);
});

test('시나리오 2 — 기존 CLAUDE.md를 보존하며 포인터 구간만 붙이고, 정책 하나를 바꾸면 그 정책이 닿는 파일만 바뀐다', async t => {
  const root = fixture(t);
  scenarioTeam(root);
  applyCompose(createCompose(root, {}));
  const claude = readAt(root, 'CLAUDE.md');
  assert.ok(claude.startsWith(CLAUDE_TEAM), '팀 내용이 그대로 앞에 남는다');
  assert.match(claude, /<!-- guksu-harness:pointer start -->\n## 하네스/);
  assert.equal(existsSync(join(root, 'AGENTS.md')), false, '선택하지 않은 앱의 포인터는 만들지 않는다');
  assert.equal(existsSync(join(root, '.codex')), false);
  assert.equal(existsSync(join(root, '.agents/hooks/verifierGate.mjs')), false, 'gate 기본값 rules에서는 종료 검사 훅을 설치하지 않는다');
  assert.match(readAt(root, 'docs/harness-rules.md'), /- `npm test`\n  - `npm run lint`\n  - `npm run build`/);
  assert.equal(applyCompose(createCompose(root, {})).changed, 0);
  const branchConfigBefore = readAt(root, '.agents/hooks/branchGuard.config.json');
  const change = createCompose(root, { set: { 'verification.gate': 'stop-hook' } });
  assert.deepEqual(changedPaths(change), ['.agents/harness-install.json', '.agents/harness-team.json', '.agents/hooks/verifierGate.config.json', '.agents/hooks/verifierGate.mjs', '.claude/settings.json', 'docs/harness-rules.md'].sort());
  applyCompose(change);
  assert.equal(readAt(root, '.agents/hooks/branchGuard.config.json'), branchConfigBefore, '무관한 설정 파일은 그대로다');
  assert.deepEqual(readJson(root, '.agents/hooks/verifierGate.config.json'), { checks: [{ name: 'test', command: 'npm test' }, { name: 'lint', command: 'npm run lint' }, { name: 'build', command: 'npm run build' }], maxIterations: 10, stuckAfter: 3 });
  assert.ok(readJson(root, '.claude/settings.json').hooks.Stop?.length, 'Stop 등록이 생긴다');
  assert.equal(readJson(root, teamSpecPath).decisions['verification.gate'].status, 'confirmed');
  assert.equal(applyCompose(createCompose(root, {})).changed, 0, '확정한 결정은 명세에 남아 재적용이 멱등이다');
  const check = await verify(root, { run: true });
  const byState = states(check);
  assert.equal(byState['검증 명령 npm test'], 'verified', '실행 가능한 명령은 실제 실행으로 확인한다');
  assert.equal(byState['검증 명령 npm run lint'], 'failed', '의존성이 없는 명령은 실패로 구분한다');
  assert.equal(byState['verifierGate 스크립트'], 'unverified');
  assert.ok(check.items.find(item => item.subject === '검증 명령 npm run lint').detail.startsWith('exit '));
  const dry = await verify(root);
  assert.equal(states(dry)['검증 명령 npm test'], 'unverified', '--run 없이는 확인 필요다');
});

test('시나리오 3 — 지침·설정 충돌과 실행 불가 명령을 구분하고, 답이 없으면 권한을 바꾸지 않는다', async t => {
  const root = fixture(t);
  scenarioConflict(root);
  const report = diagnose(root);
  assert.deepEqual(report.conflicts.map(c => c.id).sort(), ['ci.missing-script.lint', 'protection.allow-vs-guidance', 'protection.base-unprotected']);
  assert.ok(report.conflicts.every(c => c.blocking === false), '팀이 정리할 불일치는 적용을 막지 않는다');
  assert.ok(report.facts.some(f => f.id === 'scripts.test' && /자리표시자/.test(f.summary)));
  assert.equal(report.commands[0].runnable, 'placeholder');
  assert.deepEqual(report.decisions['verification.checks'].value, [], '자리표시자와 없는 스크립트는 완료 조건에서 뺀다');
  assert.deepEqual(report.questions.map(q => q.key), ['protection.protectedBranches', 'protection.allowCommitPush', 'protection.blockAttribution', 'verification.checks']);
  assert.equal(report.questions.find(q => q.key === 'protection.allowCommitPush').conflict, 'protection.allow-vs-guidance');
  assert.deepEqual(report.questions.find(q => q.key === 'protection.protectedBranches').default, ['main', 'master']);
  assert.equal(report.decisions['records.history'].value, 'required', '암묵 정책은 다시 묻지 않는다');
  assert.equal(report.decisions['records.history'].status, 'evidence');
  assert.equal(report.decisions['records.history'].basis, '기존 설정의 암묵적 기본값(requireHistoryDoc 생략 = true)');

  const gitConfigBefore = readAt(root, '.agents/hooks/blockGitMutation.config.json');
  const unanswered = createCompose(root, {});
  assert.equal(unanswered.conflicts.filter(c => c.blocking).length, 0);
  applyCompose(unanswered);
  assert.equal(readAt(root, '.agents/hooks/blockGitMutation.config.json'), gitConfigBefore, '답이 없으면 허용 설정을 바꾸지 않는다');
  assert.deepEqual(readJson(root, '.agents/hooks/branchGuard.config.json'), { protectedBranches: ['main', 'master'] }, '기준 브랜치 보호는 더한 목록을 제안·적용한다');
  assert.match(readAt(root, 'docs/harness-rules.md'), /커밋·푸시: 요청 시 허용.*미확인 · 충돌/);
  let check = await verify(root);
  assert.equal(states(check)['blockGitMutation 스크립트 — 커밋 (허용 설정)'], 'verified', '훅 시험은 실제 설정(허용)에 맞춰 판정한다');
  assert.equal(states(check)['blockGitMutation 스크립트 — force push'], 'verified');
  assert.equal(states(check)['검증 명령'], 'unverified');

  const answered = createCompose(root, { set: { 'protection.allowCommitPush': 'false', 'protection.protectedBranches': 'main,master', 'verification.checks': '[]' } });
  assert.deepEqual(answered.conflicts.map(c => c.id), ['ci.missing-script.lint'], '답한 충돌은 사라지고 저장소 불일치만 남는다');
  assert.deepEqual(changedPaths(answered), ['.agents/harness-team.json', '.agents/hooks/blockGitMutation.config.json', 'docs/harness-rules.md']);
  applyCompose(answered);
  assert.deepEqual(readJson(root, '.agents/hooks/blockGitMutation.config.json'), { allowCommitPush: false });
  assert.equal(applyCompose(createCompose(root, {})).changed, 0);
  check = await verify(root);
  assert.equal(states(check)['blockGitMutation 스크립트 — 커밋 (차단 설정)'], 'verified');
  assert.deepEqual(check.pending, [], '확정 뒤에는 남은 결정이 없다');
});

test('충돌 — 생성 구간 안을 손으로 고치면 멈추고, --force면 다시 생성하며 구간 밖 팀 글은 보존한다', t => {
  const root = fixture(t);
  scenarioBare(root);
  applyCompose(createCompose(root, { app: 'claude' }));
  const rulesPath = 'docs/harness-rules.md';
  const teamNote = '\n## 우리 팀 메모\n\n배포는 금요일에 하지 않는다.\n';
  write(root, rulesPath, readAt(root, rulesPath) + teamNote);
  assert.equal(createCompose(root, { app: 'claude' }).conflicts.length, 0, '구간 밖 수정은 충돌이 아니다');
  assert.equal(applyCompose(createCompose(root, { app: 'claude' })).changed, 0);
  write(root, rulesPath, readAt(root, rulesPath).replace('커밋·푸시: 차단', '커밋·푸시: 허용(손으로 고침)'));
  const drifted = createCompose(root, { app: 'claude' });
  assert.ok(drifted.conflicts.some(c => c.id === `spec.drift.${rulesPath}` && c.blocking));
  assert.throws(() => applyCompose(drifted), /적용을 막는 충돌/);
  assert.match(readAt(root, rulesPath), /손으로 고침/, '충돌이면 덮어쓰지 않는다');
  const forced = createCompose(root, { app: 'claude', force: true });
  assert.equal(forced.conflicts.length, 0);
  const result = applyCompose(forced);
  assert.ok(result.backup);
  const after = readAt(root, rulesPath);
  assert.doesNotMatch(after, /손으로 고침/);
  assert.ok(after.endsWith(teamNote), '구간 밖 팀 메모는 그대로다');
  rollback(root, result.backup);
  assert.match(readAt(root, rulesPath), /손으로 고침/, '백업으로 되돌릴 수 있다');
});

test('충돌 — 설정 파일을 직접 바꾸면 드리프트로 멈추고, 같은 값을 --set으로 확정하면 해소된다', t => {
  const root = fixture(t);
  scenarioBare(root);
  applyCompose(createCompose(root, { app: 'claude' }));
  write(root, '.agents/hooks/branchGuard.config.json', JSON.stringify({ protectedBranches: ['main', 'release'] }, null, 2) + '\n');
  const drifted = createCompose(root, { app: 'claude' });
  assert.ok(drifted.conflicts.some(c => c.id === 'spec.drift..agents/hooks/branchGuard.config.json'));
  assert.throws(() => applyCompose(drifted), /적용을 막는 충돌/);
  const resolved = createCompose(root, { app: 'claude', set: { 'protection.protectedBranches': ['main', 'release'] } });
  assert.equal(resolved.conflicts.length, 0);
  applyCompose(resolved);
  assert.deepEqual(readJson(root, '.agents/hooks/branchGuard.config.json'), { protectedBranches: ['main', 'release'] });
  assert.equal(readJson(root, teamSpecPath).decisions['protection.protectedBranches'].status, 'confirmed');
  assert.match(readAt(root, 'docs/harness-rules.md'), /보호 브랜치: `main`, `release`/, '규칙 문서도 같은 정책을 말한다');
  assert.equal(applyCompose(createCompose(root, { app: 'claude' })).changed, 0);
});

test('미리보기 이후 파일이 바뀌면 적용을 거부하고, 적용 백업으로 전체를 되돌릴 수 있다', t => {
  const root = fixture(t);
  scenarioTeam(root);
  const before = listAll(root);
  const claudeBefore = readAt(root, 'CLAUDE.md');
  const stale = createCompose(root, {});
  write(root, 'CLAUDE.md', `${claudeBefore}- 새 규칙\n`);
  assert.throws(() => applyCompose(stale), /바뀌었습니다/);
  write(root, 'CLAUDE.md', claudeBefore);
  const result = applyCompose(createCompose(root, {}));
  assert.notDeepEqual(listAll(root), before);
  rollback(root, result.backup);
  assert.deepEqual(listAll(root), before, '새로 만든 파일은 지우고 고친 파일은 이전 내용으로 돌아간다');
  assert.equal(readAt(root, 'CLAUDE.md'), claudeBefore);
});

test('이미 init한 프로젝트에 compose하면 설치를 그대로 잇고 프로필을 낮추지 않는다', t => {
  const root = fixture(t);
  scenarioTeam(root);
  applyPlan(createPlan(root, { app: 'claude', profile: 'basic' }));
  write(root, 'docs/templates/history.md', `${readAt(root, 'docs/templates/history.md')}\n팀 추가\n`);
  const plan = createCompose(root, {});
  assert.equal(plan.plan.profile, 'basic');
  assert.equal(plan.conflicts.length, 0);
  assert.ok(!changedPaths(plan).some(path => path.startsWith('.agents/hooks/') && path.endsWith('.mjs')), '훅은 이미 최신이라 다시 쓰지 않는다');
  applyCompose(plan);
  assert.ok(readAt(root, 'docs/templates/history.md').endsWith('팀 추가\n'), '팀이 고친 양식은 그대로다');
  assert.equal(readJson(root, teamSpecPath).decisions['records.history'].value, 'optional');
  assert.equal(readJson(root, '.agents/harness-install.json').profile, 'basic');
  assert.equal(applyCompose(createCompose(root, {})).changed, 0);
});

test('기록 요구 + 커밋 허용을 확정하면 훅 설정·규칙·양식이 함께 바뀌고 종료 검사 없는 rules 결정은 게이트 설정 파일과 충돌한다', t => {
  const root = fixture(t);
  scenarioTeam(root);
  const plan = createCompose(root, { set: { 'protection.allowCommitPush': true, 'records.history': 'required', 'rules.baseBranch': 'main' } });
  applyCompose(plan);
  assert.deepEqual(readJson(root, '.agents/hooks/blockGitMutation.config.json'), { allowCommitPush: true, requireHistoryDoc: true, historyBase: 'main' });
  assert.ok(existsSync(join(root, 'docs/templates/history.md')), '기록을 선택하면 양식(basic)을 설치한다');
  assert.match(readAt(root, 'docs/harness-rules.md'), /작업 기록: PR마다 `docs\/history\/` 기록 한 건을 남긴다\(기록 없는 push는 훅이 차단\)/);
  assert.ok(diagnose(root).notes.some(note => /지침의 금지 문구/.test(note)), '지침과 다른 팀 확정은 안내로 남긴다');
  write(root, '.agents/hooks/verifierGate.config.json', '{"checks":[{"name":"test","command":"npm test"}]}\n');
  const gateOff = createCompose(root, { set: { 'verification.gate': 'rules' } });
  assert.ok(gateOff.conflicts.some(c => c.id === 'gate.config-vs-decision' && c.blocking));
  assert.throws(() => applyCompose(gateOff), /적용을 막는 충돌/);
});

test('팀 묶음은 구성 명세를 함께 옮긴다', t => {
  const source = fixture(t), target = fixture(t);
  scenarioBare(source); scenarioBare(target);
  applyCompose(createCompose(source, { app: 'claude', set: { 'protection.allowCommitPush': false, 'records.history': 'none' } }));
  const preset = exportPreset(source);
  assert.ok(preset.files[teamSpecPath]);
  applyPlan(createPlan(target, { app: 'claude' }));
  const imported = importPreset(target, preset);
  assert.ok(imported.written.includes(teamSpecPath));
  assert.equal(readJson(target, teamSpecPath).decisions['protection.allowCommitPush'].status, 'confirmed');
  const plan = createCompose(target, {});
  assert.equal(plan.decisions['protection.allowCommitPush'].status, 'confirmed', '가져온 명세의 팀 확정을 잇는다');
});

test('결정 값 파싱 — JSON·쉼표 목록·불리언·both를 받고 잘못된 값은 거부한다', () => {
  assert.deepEqual(parseDecisionValue('apps', 'both'), ['claude', 'codex']);
  assert.deepEqual(parseDecisionValue('apps', 'codex'), ['codex']);
  assert.equal(parseDecisionValue('protection.allowCommitPush', 'true'), true);
  assert.deepEqual(parseDecisionValue('protection.protectedBranches', 'main, release'), ['main', 'release']);
  assert.deepEqual(parseDecisionValue('protection.protectedBranches', '["main"]'), ['main']);
  assert.deepEqual(parseDecisionValue('verification.checks', '["npm test", {"name":"lint","command":"npm run lint"}]'), [{ name: 'test', command: 'npm test' }, { name: 'lint', command: 'npm run lint' }]);
  assert.deepEqual(parseDecisionValue('verification.checks', '[]'), []);
  assert.equal(parseDecisionValue('records.history', 'required'), 'required');
  assert.throws(() => parseDecisionValue('records.history', 'always'), /값이 잘못/);
  assert.throws(() => parseDecisionValue('protection.allowCommitPush', 'yes'), /값이 잘못/);
  assert.throws(() => parseDecisionValue('nope', 'x'), /알 수 없는 결정 키/);
  assert.throws(() => parseDecisionValue('apps', 'cursor'), /값이 잘못/);
});

test('워크플로 읽기 — run 단계(한 줄·블록)와 branches(인라인·목록)를 읽는다', () => {
  const text = 'on:\n  push:\n    branches: [main, "release/*"]\n  pull_request:\n    branches:\n      - develop\njobs:\n  a:\n    steps:\n      - run: npm ci\n      - run: |\n          npm test\n          npm run lint\n      - name: x\n        run: "make check"\n';
  assert.deepEqual(workflowCommands(text), ['npm ci', 'npm test', 'npm run lint', 'make check']);
  assert.deepEqual(workflowBranches(text), ['main', 'release/*', 'develop']);
});

test('규칙 문서 생성 구간은 명세만으로 결정되고 미확인 항목을 표시한다', () => {
  const base = key => ({ value: null, status: 'evidence', basis: 'x', evidence: [] });
  const decisions = Object.fromEntries(decisionKeys.map(key => [key, base(key)]));
  Object.assign(decisions, {
    apps: { value: ['claude'], status: 'evidence', basis: 'x', evidence: [] },
    'rules.guidance': { value: ['CONTRIBUTING.md'], status: 'evidence', basis: 'x', evidence: [] },
    'rules.baseBranch': { value: 'main', status: 'evidence', basis: 'x', evidence: [] },
    'rules.branchPrefixes': { value: ['feat/'], status: 'assumed', basis: 'x', evidence: [] },
    'protection.protectedBranches': { value: ['main'], status: 'assumed', basis: 'x', evidence: [] },
    'protection.allowCommitPush': { value: false, status: 'pending', basis: 'x', evidence: [] },
    'protection.blockAttribution': { value: false, status: 'assumed', basis: 'x', evidence: [] },
    'verification.checks': { value: [{ name: 'test', command: 'npm test' }], status: 'evidence', basis: 'x', evidence: [] },
    'verification.gate': { value: 'rules', status: 'pending', basis: 'x', evidence: [] },
    'records.history': { value: 'none', status: 'pending', basis: 'x', evidence: [] },
  });
  const text = renderPolicySection(decisions, { profile: 'minimal' });
  assert.equal(text, renderPolicySection(decisions, { profile: 'minimal' }), '결정적이다');
  assert.match(text, /미확인 항목 3건: `protection.allowCommitPush`, `verification.gate`, `records.history`/);
  assert.match(text, /- `npm test`/);
  assert.doesNotMatch(text, /AI 작성 표기/, '커밋 차단 상태에서는 표기 정책을 쓰지 않는다');
});
