import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync, appendFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync, spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { prepareProbe, reportProbe, runProbe, startupProbe } from './hookProbe.mjs';
import { verify } from './teamCompose.mjs';
import { claudeLaunchContext } from './runtimeEvidence.mjs';
import { createPlan, applyPlan } from './harnessManager.mjs';

const fixture = (t, app = 'codex') => {
  const parent = mkdtempSync(join(tmpdir(), 'harness-probe-test-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  return prepareProbe(join(parent, 'new fixture'), app).root;
};
const events = root => readFileSync(join(root, '.probe/events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const invoke = (root, hook, event, tool, input, call = 'test-call') => spawnSync(process.execPath, [join(root, '.probe/observer.mjs'), hook], {
  cwd: join(root, 'apps/web'), env: { ...process.env, CLAUDE_PROJECT_DIR: root }, encoding: 'utf8',
  input: JSON.stringify({ hook_event_name: event, tool_name: tool, tool_input: input, session_id: 'synthetic-test-session', tool_use_id: call, cwd: join(root, 'apps/web') }),
});
const syntheticEvents = root => {
  invoke(root, 'observe', 'SessionStart');
  invoke(root, 'observe', 'PostToolUse', 'Bash', { command: 'git status --short' });
  invoke(root, 'branchGuard', 'PreToolUse', 'Edit', { file_path: 'guard-target.txt' });
  invoke(root, 'blockGitMutation', 'PreToolUse', 'Bash', { command: 'git commit --allow-empty -m harness-hook-probe' });
  invoke(root, 'blockSecretAccess', 'PreToolUse', 'Bash', { command: 'cat .env' });
};

test('새 독립 저장소만 준비하고 기존 경로·저장소 내부는 거부한다', t => {
  const root = fixture(t);
  assert.equal(execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim(), 'main');
  assert.throws(() => prepareProbe(root, 'codex'), /새 디렉터리/);
  assert.throws(() => prepareProbe(join(root, 'nested'), 'codex'), /저장소 밖/);
  assert.equal(existsSync(join(root, 'nested')), false);
  assert.equal(existsSync(join(root, '.probe/execution.json')), false);
  assert.equal(reportProbe(root).ok, false);
  assert.ok(reportProbe(root).results.every(item => item.state === 'unverified'));
});

test('앱별 기존 등록 명령을 계측하며 하위 cwd에서도 실제 차단 코드·stderr를 보존한다', t => {
  for (const app of ['codex', 'claude']) {
    const root = fixture(t, app);
    const result = invoke(root, 'branchGuard', 'PreToolUse', 'Edit', { file_path: 'guard-target.txt' });
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /보호 브랜치/);
    assert.equal(events(root)[0].cwd, 'apps/web');
    assert.equal(events(root)[0].exitCode, 2);
  }
});

test('이벤트에는 명령·출력·비밀·세션 원문을 저장하지 않고 스크립트 시험을 앱 통합으로 승격하지 않는다', t => {
  const root = fixture(t);
  syntheticEvents(root);
  const log = readFileSync(join(root, '.probe/events.jsonl'), 'utf8');
  assert.doesNotMatch(log, /cat \.env|harness-hook-probe|synthetic-test-session|not-a-secret|tool_input|transcript/);
  const report = reportProbe(root);
  assert.ok(report.results.every(item => item.state === 'observed'));
  assert.equal(report.integration, 'unverified');
  assert.equal(report.ok, false);
});

test('거부 뒤 PostToolUse·파일 변경·HEAD 변경은 실패이며 모델의 성공 문구는 사용하지 않는다', t => {
  const root = fixture(t);
  syntheticEvents(root);
  invoke(root, 'observe', 'PostToolUse', 'Bash', { command: 'cat .env' });
  writeFileSync(join(root, 'apps/web/guard-target.txt'), 'changed\n');
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'unexpected'], { cwd: root });
  assert.deepEqual(reportProbe(root).results.map(item => item.state), ['observed', 'failed', 'failed', 'failed']);
});

test('설정 변경·새 비활성 설정·손상 이벤트는 미확인으로 보고한다', t => {
  const root = fixture(t);
  syntheticEvents(root);
  writeFileSync(join(root, '.agents/hooks/branchGuard.config.json'), '{"protectedBranches":[]}');
  let report = reportProbe(root);
  assert.ok(report.issues.some(issue => issue.includes('branchGuard.config')));
  assert.ok(report.results.every(item => item.state === 'unverified'));
  appendFileSync(join(root, '.probe/events.jsonl'), 'broken\n');
  report = reportProbe(root);
  assert.ok(report.issues.some(issue => issue.includes('이벤트 로그')));
});

test('실행 이전 이벤트와 다른 세션은 현재 CLI 검증의 근거가 아니다', t => {
  const root = fixture(t);
  syntheticEvents(root);
  writeFileSync(join(root, '.probe/execution.json'), JSON.stringify({ surface: 'cli', cliVersion: 'test', startedAt: '9999-01-01T00:00:00Z', finishedAt: '9999-01-02T00:00:00Z', exitCode: 0 }));
  assert.ok(reportProbe(root).results.every(item => item.state === 'unverified'));
  assert.equal(reportProbe(root).ok, false);
});

test('재실행·설정 변경은 모델을 호출하기 전에 차단한다', async t => {
  const root = fixture(t);
  writeFileSync(join(root, '.probe/execution.json'), '{}');
  await assert.rejects(runProbe(root), /새 시험/);
  rmSync(join(root, '.probe/execution.json'));
  writeFileSync(join(root, '.codex/hooks.json'), '{}');
  await assert.rejects(runProbe(root), /변경된 시험/);
});

test('Claude 시작 CLI가 정상 종료해도 훅 이벤트가 없으면 모델을 실행하지 않고 원문을 숨긴다', async t => {
  const root = fixture(t, 'claude');
  const binaries = join(root, '.probe/bin');
  mkdirSync(binaries);
  writeFileSync(join(binaries, 'claude'), `#!${process.execPath}\nif(process.argv.includes('--version')) console.log('fake-cli-test'); else { console.log(JSON.stringify({type:'system',subtype:'init',model:'test-model'})); console.log('PRIVATE_OUTPUT_SENTINEL'); }\n`, { mode: 0o700 });
  const originalPath = process.env.PATH;
  process.env.PATH = `${binaries}:${originalPath}`;
  try {
    const report = await runProbe(root);
    assert.equal(report.startup.execution.exitCode, 0);
    assert.equal(report.startup.execution.cliVersion, 'fake-cli-test');
    assert.equal(report.startup.execution.model, 'test-model');
    assert.equal(report.execution, null);
    assert.equal(existsSync(join(root, '.probe/execution.json')), false);
    assert.equal(report.ok, false);
    assert.doesNotMatch(JSON.stringify(report), /PRIVATE_OUTPUT_SENTINEL/);
  } finally { process.env.PATH = originalPath; }
});

test('루트 대조군과 하위 cwd를 별도 명세로 보존한다', t => {
  const parent = mkdtempSync(join(tmpdir(), 'harness-probe-root-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const prepared = prepareProbe(join(parent, 'fixture'), 'claude', { cwd: 'root' });
  assert.equal(prepared.cwd, prepared.root);
  assert.equal(reportProbe(prepared.root).cwd, '.');
  assert.ok(existsSync(join(prepared.root, 'guard-target.txt')));
  assert.equal(existsSync(join(prepared.root, 'apps/web/guard-target.txt')), false);
});

test('시험기 종료 요청은 실행 중인 CLI도 중단하고 미확인으로 기록한다', { timeout: 10000 }, async t => {
  const root = fixture(t, 'claude');
  const binaries = join(root, '.probe/bin');
  mkdirSync(binaries);
  writeFileSync(join(binaries, 'claude'), `#!${process.execPath}\nif(process.argv.includes('--version')) console.log('fake-cli-test'); else { require('fs').writeFileSync('../../.probe/child.pid', String(process.pid)); setInterval(()=>{},1000); }\n`, { mode: 0o700 });
  const child = spawn(process.execPath, [fileURLToPath(new URL('./hookProbe.mjs', import.meta.url)), 'run', root], { env: { ...process.env, PATH: `${binaries}:${process.env.PATH}` }, stdio: 'ignore' });
  const finished = new Promise(resolve => child.on('close', resolve));
  t.after(() => { try { child.kill('SIGKILL'); } catch {} });
  const pidFile = join(root, '.probe/child.pid');
  const deadline = Date.now() + 5000;
  while (!existsSync(pidFile) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
  assert.ok(existsSync(pidFile));
  const cliPid = Number(readFileSync(pidFile, 'utf8'));
  child.kill('SIGTERM');
  assert.equal(await finished, 1);
  assert.throws(() => process.kill(cliPid, 0), /ESRCH/);
  const report = reportProbe(root);
  assert.equal(report.startup.execution.error, 'interrupted');
  assert.equal(report.execution, null);
  assert.equal(report.ok, false);
});

function startupFixture(t, mode = 'success') {
  const parent = mkdtempSync(join(tmpdir(), 'harness-startup-test-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const { root } = prepareProbe(join(parent, 'root'), 'claude', { cwd: 'root' });
  const binaries = join(parent, 'bin'); mkdirSync(binaries);
  writeFileSync(join(binaries, 'claude'), `#!${process.execPath}
const fs=require('fs'),cp=require('child_process');
const root=${JSON.stringify(root)},mode=${JSON.stringify(mode)};
if(process.argv.includes('--version')) { console.log('fake-startup-test'); process.exit(0); }
const startup=process.argv.includes('--init-only');
fs.appendFileSync(root+'/.probe/calls.jsonl',JSON.stringify({startup,args:process.argv.slice(2)})+'\\n');
if(mode==='unsupported') process.exit(2);
if(startup && mode==='unexpected-model') { console.log(JSON.stringify({type:'assistant',message:{content:[]}})); setTimeout(()=>{},10000); }
else if(startup && mode!=='stale') {
 cp.spawnSync(process.execPath,[root+'/.probe/observer.mjs','observe'],{cwd:root,env:{...process.env,CLAUDE_PROJECT_DIR:mode==='wrong-directory'?root+'/apps/web':root},input:JSON.stringify({hook_event_name:'SessionStart',session_id:'test-session',cwd:root}),stdio:['pipe','ignore','ignore']});
 console.log('PRIVATE_STARTUP_SENTINEL');
 if(mode==='failure') process.exit(1);
}
`, { mode: 0o700 });
  const originalPath = process.env.PATH;
  process.env.PATH = `${binaries}:${originalPath}`;
  t.after(() => { process.env.PATH = originalPath; });
  return root;
}

test('시작 훅 관찰만으로 가드 통합을 확인하지 않고 run은 매번 새 시작 진단을 거친다', async t => {
  const root = startupFixture(t);
  const startup = await startupProbe(root);
  assert.equal(startup.ok, true);
  assert.equal(startup.sessionStartCount, 1);
  assert.deepEqual(startup.projectCwds, ['.']);
  assert.equal(startup.hookIntegration, 'unverified');
  assert.equal(reportProbe(root).ok, false);
  assert.equal(reportProbe(root).execution, null);
  assert.doesNotMatch(JSON.stringify(startup), /PRIVATE_STARTUP_SENTINEL/);
  const report = await runProbe(root);
  const calls = readFileSync(join(root, '.probe/calls.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(calls.map(call => call.startup), [true, true, false]);
  assert.equal(calls[0].args[calls[0].args.indexOf('--tools') + 1], '');
  assert.equal(report.execution.mode, 'model');
  assert.equal(report.ok, false); // Fake model emits no tool events.
  await assert.rejects(startupProbe(root), /새 시험/);
});

test('미지원·실행 실패·다른 프로젝트 경로·오래된 이벤트·예상 밖 모델 응답은 시작 통과가 아니다', async t => {
  for (const mode of ['unsupported', 'failure', 'wrong-directory', 'stale', 'unexpected-model']) {
    await t.test(mode, async sub => {
      const root = startupFixture(sub, mode);
      if (mode === 'stale') {
        spawnSync(process.execPath, [join(root, '.probe/observer.mjs'), 'observe'], { cwd: root,
          env: { ...process.env, CLAUDE_PROJECT_DIR: root }, input: JSON.stringify({hook_event_name:'SessionStart', session_id:'old', cwd:root}) });
        const old = events(root).map(event => ({ ...event, at: '2000-01-01T00:00:00.000Z' }));
        writeFileSync(join(root, '.probe/events.jsonl'), old.map(JSON.stringify).join('\n') + '\n');
      }
      const report = await runProbe(root);
      assert.equal(report.startup.ok, false);
      assert.equal(report.execution, null);
      assert.equal(existsSync(join(root, '.probe/execution.json')), false);
      const calls = readFileSync(join(root, '.probe/calls.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
      assert.ok(calls.every(call => call.startup));
    });
  }
});

test('verify는 Claude 시작 위치와 루트 설정의 범위를 구분하되 실제 앱을 시작하지 않는다', async t => {
  const probeRoot = startupFixture(t);
  const root = join(probeRoot, '../installed');
  mkdirSync(root);
  applyPlan(createPlan(root, { app: 'claude', profile: 'minimal' }));
  const nested = join(root, 'apps/web');
  mkdirSync(join(nested, '.claude'), { recursive: true });
  writeFileSync(join(nested, '.claude/settings.json'), '{"env":{"PRIVATE_SENTINEL":"never-read"}}');
  const cli = fileURLToPath(new URL('../../../bin/guksu-harness.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [cli, 'verify', nested, '--json'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  const context = report.verification.runtime.apps.claude.launchContext;
  assert.equal(context.cwd, 'apps/web');
  assert.equal(context.status, 'attention');
  assert.equal(context.cwdSettingsPresent, true);
  assert.equal(context.hookIntegration, 'unverified');
  assert.ok(report.items.some(item => item.subject === 'Claude 시작 위치' && item.state === 'unverified'));
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE_SENTINEL|never-read/);
  assert.equal(existsSync(join(probeRoot, '.probe/calls.jsonl')), false);
  const aligned = await verify(root);
  assert.equal(aligned.verification.runtime.apps.claude.launchContext.status, 'aligned');
});

test('실제 worktree와 심볼릭 경로에서도 Claude 시작 위치는 해당 설치 루트 기준이다', t => {
  const root = fixture(t, 'claude');
  const linked = join(root, '../worktree');
  execFileSync('git', ['worktree', 'add', '-b', 'test-worktree', linked], { cwd: root, stdio: 'ignore' });
  mkdirSync(join(linked, 'apps/web'), { recursive: true });
  const context = claudeLaunchContext(linked, join(linked, 'apps/web'));
  assert.equal(context.cwd, 'apps/web');
  assert.equal(context.status, 'attention');
  assert.equal(context.rootSettingsPresent, false);
  assert.equal(claudeLaunchContext(root, root).status, 'aligned');
  const alias = join(root, '../alias');
  symlinkSync(root, alias);
  assert.equal(claudeLaunchContext(alias, root).cwd, '.');
  assert.equal(claudeLaunchContext(alias, alias).status, 'aligned');
});
