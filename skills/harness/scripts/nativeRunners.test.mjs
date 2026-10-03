import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, rmSync, existsSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { diagnose, createCompose, applyCompose, planVerification } from './teamCompose.mjs';
import { verificationPlan, discoverWorkspaces } from './workspaces.mjs';
import { parseNxGraph, parseTurboGraph } from './nativeRunners.mjs';
import { executeCheck } from '../assets/hooks/verifierGate.mjs';

const write = (root, path, value) => { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), typeof value === 'string' ? value : JSON.stringify(value)); };
const git = (root, ...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe', encoding: 'utf8' }).trim();
const commit = root => { git(root, 'add', '.'); git(root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture'); };
const nativeOptions = { affected: true, base: 'main', nativeRunner: true };

function fixture(t, runner, realModules = null) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'guksu-native-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(root, 'package.json', { private: true, name: 'fixture', packageManager: 'npm@10.9.4', workspaces: ['packages/*'] });
  write(root, '.gitignore', 'node_modules\n.nx\n.turbo\n.runner-calls\n');
  write(root, runner === 'nx' ? 'nx.json' : 'turbo.json', runner === 'nx' ? {} : { tasks: { test: { dependsOn: ['^test'] }, 'api#test': { dependsOn: ['ui#test'] } } });
  for (const name of ['api', 'ui', 'web', 'independent']) {
    write(root, `packages/${name}/package.json`, { name, version: '1.0.0', scripts: { test: 'node --version' }, dependencies: name === 'web' ? { ui: '*' } : {} });
    write(root, `packages/${name}/src.js`, 'initial\n');
  }
  if (runner === 'nx') write(root, 'packages/api/project.json', { name: 'api', implicitDependencies: ['ui'], targets: { test: { executor: 'nx:run-commands', options: { command: 'node --version' } } } });
  if (realModules) {
    execFileSync('npm', ['install', '--package-lock-only', '--ignore-scripts', '--offline', '--no-audit', '--no-fund', '--cache', join(tmpdir(), 'guksu-test-npm-cache')], { cwd: root, stdio: 'pipe' });
    symlinkSync(realModules, join(root, 'node_modules'), 'dir');
  }
  git(root, 'init', '-b', 'main');
  commit(root);
  return root;
}

function stub(root, runner, overrides = {}) {
  const projects = ['api', 'ui', 'web', 'independent'].map(name => ({ name, path: `packages/${name}`, dependencies: ['api', 'web'].includes(name) ? ['ui'] : [] }));
  const graph = runner === 'nx' ? { graph: {
    nodes: Object.fromEntries(projects.map(item => [item.name, { name: item.name, data: { root: item.path } }])),
    dependencies: Object.fromEntries(projects.map(item => [item.name, item.dependencies.map(target => ({ source: item.name, target, type: 'implicit' }))])),
  } } : { packages: projects };
  const tasks = projects.map(item => ({ taskId: `${item.name}#test`, package: item.name, dependencies: item.dependencies.map(name => `${name}#test`) }));
  write(root, `node_modules/${runner}/package.json`, { name: runner, version: runner === 'nx' ? '23.2.1' : '2.11.7', bin: { [runner]: 'cli.cjs' } });
  write(root, `node_modules/${runner}/responses.json`, { graph, affected: runner === 'nx' ? ['ui', 'api', 'web'] : { packages: { items: projects.filter(item => item.name !== 'independent').map(({ name, path }) => ({ name, path })) } }, dry: { tasks, globalCacheInputs: { files: {} } }, ...overrides });
  write(root, `node_modules/${runner}/cli.cjs`, `
const fs=require('node:fs');const data=require('./responses.json');
const args=process.argv.slice(2);const input=fs.readFileSync(0,'utf8');
fs.appendFileSync('.runner-calls',JSON.stringify({args,input})+'\\n');
if(data.invalid){console.log('private-output-should-not-leak');process.exit(0);}
if(data.exit){process.exit(data.exit);}
console.log(JSON.stringify(args.includes('--affected')?data.affected:args.includes('--dry=json')?data.dry:data.graph));
`);
}
const plan = root => verificationPlan(root, diagnose(root).decisions['verification.checks'].value, nativeOptions);

test('기본 진단·계획은 runner를 실행하지 않고 명시한 조회만 Nx 암묵 의존 관계를 사용한다', t => {
  const root = fixture(t, 'nx'); stub(root, 'nx');
  write(root, 'packages/ui/src.js', 'changed');
  const report = diagnose(root);
  assert.ok(report.commands.every(check => check.command.includes('.bin/nx')));
  assert.equal(verificationPlan(root, report.decisions['verification.checks'].value, { affected: true, base: 'main' }).selection.mode, 'all');
  assert.equal(existsSync(join(root, '.runner-calls')), false);
  const result = plan(root);
  assert.equal(result.native.status, 'resolved');
  assert.deepEqual(result.selection.projects, ['api', 'ui', 'web']);
  assert.ok(!result.checks.some(check => check.workspace === 'independent'));
  const calls = readFileSync(join(root, '.runner-calls'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(calls.map(call => call.args), [['graph', '--print'], ['show', 'projects', '--affected', '--json', '--stdin']]);
  assert.equal(calls[1].input, 'packages/ui/src.js\n');
});

test('Nx project.json만 있는 프로젝트도 진단하며 하위 명시 targets를 보존한다', t => {
  const root = fixture(t, 'nx');
  rmSync(join(root, 'packages/api/package.json'));
  const inventory = discoverWorkspaces(join(root, 'packages/api'));
  assert.equal(inventory.current, 'api');
  const project = inventory.projects.find(item => item.name === 'api');
  assert.equal(project.manifest, 'packages/api/project.json');
  assert.ok(project.targets.test);
  assert.ok(diagnose(root).commands.find(check => check.workspace === 'api').command.includes("'api:test'"));
});

test('Turbo 태스크의 교차 패키지 의존 관계를 합치고 원시 dry-run 출력은 보고하지 않는다', t => {
  const root = fixture(t, 'turbo');
  const projects = ['api', 'ui', 'web', 'independent'].map(name => ({ name, path: `packages/${name}`, dependencies: name === 'web' ? ['ui'] : [] }));
  stub(root, 'turbo', { graph: { packages: projects }, affected: { packages: { items: [{ name: 'ui', path: 'packages/ui' }] } } });
  write(root, 'packages/ui/src.js', 'changed');
  const result = plan(root);
  assert.equal(result.native.status, 'resolved');
  assert.deepEqual(result.selection.projects, ['api', 'ui', 'web']);
  assert.ok(result.native.queries.some(query => query.args.includes('--dry=json')));
  assert.equal(result.native.globalCacheInputs, undefined);
});

test('미설치·조회 실패·손상된 JSON·불일치 그래프는 전체 명세를 유지한다', t => {
  const root = fixture(t, 'nx');
  write(root, 'packages/ui/src.js', 'changed');
  assert.equal(plan(root).native.status, 'fallback');
  for (const overrides of [{ invalid: true }, { exit: 1 }, { affected: ['unknown'] }, { graph: { graph: { nodes: {}, dependencies: {} } } }]) {
    stub(root, 'nx', overrides);
    const result = plan(root);
    assert.equal(result.native.status, 'fallback');
    assert.equal(result.selection.mode, 'all');
    assert.equal(result.checks.length, 4);
    assert.ok(!JSON.stringify(result.native).includes('private-output-should-not-leak'));
    if (overrides.graph) assert.ok(result.issues.length > 0, '알려진 프로젝트 목록 불일치는 전체 검사 통과로 숨기지 않는다');
  }
});

test('루트 정책·삭제·공통 입력·대응 불가 명령에는 범위를 축소하지 않는다', t => {
  const root = fixture(t, 'turbo'); stub(root, 'turbo');
  write(root, 'packages/ui/src.js', 'changed');
  write(root, 'AGENTS.md', 'shared');
  assert.equal(plan(root).native.status, 'skipped');
  assert.equal(existsSync(join(root, '.runner-calls')), false);
  rmSync(join(root, 'AGENTS.md'));
  rmSync(join(root, 'packages/api/src.js'));
  assert.equal(plan(root).selection.mode, 'all');
  write(root, 'packages/api/src.js', 'initial\n');
  stub(root, 'turbo', { dry: { tasks: [], globalCacheInputs: { files: { 'packages/ui/src.js': 'hash' } } } });
  assert.match(plan(root).native.reason, /공통 입력/);
  stub(root, 'turbo');
  const checks = diagnose(root).decisions['verification.checks'].value;
  checks[0].command = 'node custom-check.mjs';
  assert.equal(verificationPlan(root, checks, nativeOptions).selection.mode, 'all');
});

test('native 결과가 빈 목록이어도 실제 변경·사용 패키지는 검사한다', t => {
  const root = fixture(t, 'nx'); stub(root, 'nx', { affected: [] });
  write(root, 'packages/ui/src.js', 'changed');
  assert.deepEqual(plan(root).selection.projects, ['api', 'ui', 'web']);
  assert.throws(() => verificationPlan(root, [], { nativeRunner: true }), /--affected/);
  assert.throws(() => parseNxGraph({}), /JSON/);
  assert.throws(() => parseTurboGraph({}), /JSON/);
});

test('CLI는 --native-runner 옵션을 명시적으로 전달하고 조회 결과를 JSON에 남긴다', t => {
  const root = fixture(t, 'nx'); stub(root, 'nx');
  applyCompose(createCompose(root, { app: 'codex' }));
  commit(root);
  write(root, 'packages/ui/src.js', 'changed');
  const cli = new URL('../../../bin/guksu-harness.mjs', import.meta.url).pathname;
  const result = spawnSync(process.execPath, [cli, 'verify', root, '--plan', '--affected', '--base', 'main', '--native-runner', '--json'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.native.status, 'resolved');
  assert.deepEqual(report.selection.projects, ['api', 'ui', 'web']);
  assert.equal(report.native.version, '23.2.1');
});

const realModules = process.env.GUKSU_RUNNER_MODULES;
for (const runner of ['nx', 'turbo']) test(`실제 ${runner} 설치본: 암묵·태스크 의존 관계와 로컬 변경 조회`, { skip: !realModules }, t => {
  const root = fixture(t, runner, realModules);
  applyCompose(createCompose(root, { app: 'codex' }));
  commit(root);
  write(root, 'packages/ui/src.js', 'changed');
  const result = planVerification(root, nativeOptions);
  assert.equal(result.native.status, 'resolved', JSON.stringify(result.native));
  assert.deepEqual(result.selection.projects, ['api', 'ui', 'web']);
  assert.ok(!result.checks.some(check => check.workspace === 'independent'));
  const callsBefore = result.native.queries;
  assert.ok(callsBefore.every(query => !query.args.includes('run') || query.args.includes('--dry=json')));
  // New files and staged changes are unioned with native results.
  write(root, 'packages/web/new source.js', 'new');
  git(root, 'add', 'packages/ui/src.js');
  const withUntracked = planVerification(root, nativeOptions);
  for (const name of ['api', 'ui', 'web']) assert.ok(withUntracked.selection.projects.includes(name));
  // A runner may conservatively select all packages (e.g. untracked paths with spaces).
  // Its broader answer must not be narrowed by our manifest-only estimate.
  if (runner === 'nx') {
    const check = result.checks.find(item => item.workspace === 'api');
    const execution = executeCheck({ ...check, timeoutMs: 20000 }, root);
    assert.equal(execution.state, 'pass', execution.output);
  }
});
