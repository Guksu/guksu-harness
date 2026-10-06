import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assessCodexHooks, inspectCodexHooks } from './codexHooks.mjs';
import { createPlan, applyPlan } from './harnessManager.mjs';
import { prepareProbe, runProbe } from './hookProbe.mjs';
import { verify } from './teamCompose.mjs';

function data() {
  const root = '/tmp/harness-schema-test';
  const handler = { type: 'command', command: 'node private-command.mjs TOKEN=PRIVATE_VALUE' };
  return { root, cwd: root, registry: { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [handler] }] } },
    config: { config: { api_key: 'PRIVATE_VALUE' }, layers: [{ name: { type: 'project', dotCodexFolder: join(root, '.codex') }, disabledReason: null }] },
    listing: { data: [{ cwd: root, errors: [], warnings: [], hooks: [{ source: 'project', sourcePath: join(root, '.codex/hooks.json'), handlerType: 'command', command: handler.command, matcher: 'Bash', eventName: 'preToolUse', enabled: true, trustStatus: 'trusted', isManaged: false }] }] },
    feature: { name: 'hooks', enabled: true } };
}

test('발견·활성·신뢰를 모두 확인하며 명령·설정 값은 출력하지 않는다', () => {
  const result = assessCodexHooks(data());
  assert.equal(result.ready, true);
  assert.equal(result.hooks[0].state, 'ready');
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_VALUE|private-command|harness-schema-test/);
});

test('신뢰 변경·개별 비활성·기능 비활성·비활성 계층·경고를 성공으로 처리하지 않는다', () => {
  for (const [mutate, reason] of [
    [d => { d.listing.data[0].hooks[0].trustStatus = 'modified'; }, 'hook-review-required'],
    [d => { d.listing.data[0].hooks[0].enabled = false; }, 'hook-disabled'],
    [d => { d.feature.enabled = false; }, 'hooks-disabled'],
    [d => { d.config.layers[0].disabledReason = 'untrusted PRIVATE_VALUE'; }, 'project-layer-disabled'],
    [d => { d.listing.data[0].warnings.push('PRIVATE_VALUE'); }, 'discovery-warnings'],
    [d => { d.feature = null; }, 'hooks-feature-unknown'],
  ]) {
    const d = data(); mutate(d);
    const result = assessCodexHooks(d);
    assert.equal(result.ready, false);
    assert.ok(result.reasons.includes(reason));
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_VALUE/);
  }
});

test('다른 명령·등록 출처·중복 응답과 알 수 없는 형식을 보수적으로 처리한다', () => {
  for (const mutate of [
    d => { d.listing.data[0].hooks[0].command = 'different'; },
    d => { d.listing.data[0].hooks[0].source = 'user'; },
    d => { d.listing.data[0].hooks.push(d.listing.data[0].hooks[0]); },
  ]) {
    const d = data(); mutate(d);
    assert.ok(assessCodexHooks(d).reasons.includes('hook-missing'));
  }
  const d = data(); d.registry.hooks.PreToolUse[0].hooks[0].type = 'prompt';
  assert.throws(() => assessCodexHooks(d), /unsupported-registry/);
});

function mock(t, { mode = 'trusted', probe = false } = {}) {
  const parent = mkdtempSync(join(tmpdir(), 'harness-runtime-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const root = join(parent, 'project');
  if (probe) prepareProbe(root, 'codex');
  else { mkdirSync(root); applyPlan(createPlan(root, { app: 'codex' })); mkdirSync(join(root, 'apps/web'), { recursive: true }); }
  const binaries = join(parent, 'bin'); mkdirSync(binaries);
  const log = join(parent, 'calls.jsonl');
  writeFileSync(join(binaries, 'codex'), `#!${process.execPath}
const fs=require('fs'),readline=require('readline');
const root=${JSON.stringify(root)}, log=${JSON.stringify(log)}, mode=${JSON.stringify(mode)};
if(process.argv.includes('--version')) { console.log('codex mock'); process.exit(0); }
if(!process.argv.includes('app-server')) { fs.appendFileSync(log,'MODEL_EXECUTION\\n'); process.exit(1); }
let initialized=false;
readline.createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line); fs.appendFileSync(log,m.method+'\\n');
 if(m.method==='initialized') { initialized=true; return; }
 if(mode==='timeout') return;
 if(m.method==='initialize') { console.log(JSON.stringify({id:m.id,result:{userAgent:'mock'}})); return; }
 if(!initialized) throw Error('missing initialized');
 if(mode==='unsupported' && m.method==='hooks/list') { console.log(JSON.stringify({id:m.id,error:{code:-32601,message:'PRIVATE_VALUE'}})); return; }
 if(mode==='invalid' && m.method==='hooks/list') { console.log('not json PRIVATE_VALUE'); return; }
 let result;
 if(m.method==='config/read') result={config:{secret:'PRIVATE_VALUE'},layers:[{name:{type:'project',dotCodexFolder:root+'/.codex'},disabledReason:null}]};
 if(m.method==='hooks/list') {
   const registry=JSON.parse(fs.readFileSync(root+'/.codex/hooks.json','utf8'));
   const hooks=Object.entries(registry.hooks).flatMap(([event,groups])=>groups.flatMap(g=>g.hooks.map(h=>({source:'project',sourcePath:root+'/.codex/hooks.json',handlerType:'command',command:h.command,eventName:event[0].toLowerCase()+event.slice(1),matcher:g.matcher??null,enabled:true,trustStatus:mode==='untrusted'?'untrusted':'trusted',isManaged:false}))));
   result={data:[{cwd:m.params.cwds[0],errors:[],warnings:[],hooks}]};
 }
 if(m.method==='experimentalFeature/list') result=m.params.cursor?{data:[{name:'hooks',enabled:true}],nextCursor:null}:{data:[],nextCursor:'page-2'};
 if(!result) throw Error('Unexpected method '+m.method);
 const output=JSON.stringify({id:m.id,result})+'\\n';
 const encoded=Buffer.from(output), at=encoded.indexOf(Buffer.from('한'));
 if(mode==='unicode' && at>=0) { process.stdout.write(encoded.subarray(0,at+1)); setTimeout(()=>process.stdout.write(encoded.subarray(at+1)),10); }
 else process.stdout.write(output);
});
`, { mode: 0o700 });
  const originalPath = process.env.PATH;
  process.env.PATH = `${binaries}:${originalPath}`;
  t.after(() => { process.env.PATH = originalPath; });
  return { root, log };
}

test('읽기 API만 사용하며 페이지 탐색·하위 cwd를 보존하고 실제 훅 실행으로 승격하지 않는다', async t => {
  const { root, log } = mock(t);
  const result = await inspectCodexHooks(join(root, 'apps/web'));
  assert.equal(result.ready, true);
  assert.equal(result.cwd, 'apps/web');
  assert.equal(result.hookIntegration, 'unverified');
  assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n'), ['initialize', 'initialized', 'config/read', 'hooks/list', 'experimentalFeature/list', 'experimentalFeature/list']);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_VALUE/);
});

test('지원하지 않는 API·손상 응답·timeout을 미확인으로 남긴다', async t => {
  for (const [mode, reason] of [['unsupported', 'unsupported-method'], ['invalid', 'invalid-json'], ['timeout', 'timeout']]) {
    await t.test(mode, async sub => {
      const { root } = mock(sub, { mode });
      const result = await inspectCodexHooks(root, { timeoutMs: 500 });
      assert.equal(result.ready, false);
      assert.ok(result.reasons.includes(reason));
      assert.doesNotMatch(JSON.stringify(result), /PRIVATE_VALUE/);
    });
  }
});

test('UTF-8 문자가 파이프 청크 경계에서 나뉘어도 명령을 정확히 비교한다', async t => {
  const { root } = mock(t, { mode: 'unicode' });
  const path = join(root, '.codex/hooks.json');
  const registry = JSON.parse(readFileSync(path, 'utf8'));
  registry.hooks.PreToolUse[0].hooks[0].command += ' 한글';
  writeFileSync(path, JSON.stringify(registry));
  assert.equal((await inspectCodexHooks(root)).ready, true);
});

test('기본 verify는 앱 서버를 시작하지 않으며 --runtime만 조회하고 하위 cwd를 유지한다', async t => {
  const { root, log } = mock(t, { mode: 'untrusted' });
  await verify(root);
  assert.equal(existsSync(log), false);
  const cli = fileURLToPath(new URL('../../../bin/guksu-harness.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [cli, 'verify', join(root, 'apps/web'), '--runtime', '--json'], { encoding: 'utf8' });
  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.verification.runtime.apps.codex.hookPreflight.cwd, 'apps/web');
  assert.equal(report.verification.runtime.apps.codex.hookPreflight.status, 'attention');
  assert.equal(report.verification.runtime.apps.codex.hookIntegration, 'unverified');
});

test('Codex 사전 진단이 준비되지 않으면 실제 모델을 실행하지 않는다', async t => {
  const { root, log } = mock(t, { mode: 'untrusted', probe: true });
  const report = await runProbe(root);
  assert.equal(report.preflight.status, 'attention');
  assert.equal(report.execution, null);
  assert.equal(report.ok, false);
  assert.equal(existsSync(join(root, '.probe/execution.json')), false);
  assert.doesNotMatch(readFileSync(log, 'utf8'), /MODEL_EXECUTION|thread\/|turn\/|write/);
});
