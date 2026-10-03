import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPlan, applyPlan, status, rollback } from './harnessManager.mjs';
import { diagnose } from './teamCompose.mjs';
import { readTranscriptUsage, failureSignature, runChecks } from '../assets/hooks/verifierGate.mjs';

const fixture = t => {
  const root = mkdtempSync(join(tmpdir(), 'harness-hardening-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
};
test('Codex 등록 명령은 실제 Git 저장소의 하위 폴더에서도 보호 브랜치를 차단한다', t => {
  const root = fixture(t);
  execFileSync('git', ['init', '-b', 'main', root], { stdio: 'ignore' });
  applyPlan(createPlan(root, { app: 'codex' }));
  const cwd = join(root, 'apps', 'web');
  mkdirSync(cwd, { recursive: true });
  const hooks = JSON.parse(readFileSync(join(root, '.codex/hooks.json'))).hooks;
  const command = hooks.PreToolUse.find(entry => entry.matcher.includes('apply_patch')).hooks[0].command;
  const run = config => {
    if (config) writeFileSync(join(root, '.agents/hooks/branchGuard.config.json'), JSON.stringify(config));
    return spawnSync(command, { shell: true, cwd, input: JSON.stringify({ cwd, tool_name: 'apply_patch' }), encoding: 'utf8' });
  };
  assert.equal(run().status, 2);
  assert.match(run().stderr, /보호 브랜치/);
  assert.equal(run({ protectedBranches: 7 }).status, 2);
  assert.equal(run({ protectedBranches: [] }).status, 0);
});
test('토큰 사용량 미측정과 실제 0을 구분하고 손상·음수는 거부한다', () => {
  assert.equal(readTranscriptUsage('').status, 'empty');
  assert.equal(readTranscriptUsage('{"usage":{"input_tokens":100}}').status, 'unsupported');
  assert.equal(readTranscriptUsage('broken').status, 'invalid');
  assert.equal(readTranscriptUsage('{"message":{"usage":{"input_tokens":-1}}}').total, null);
  assert.deepEqual(readTranscriptUsage('{"message":{"usage":{"input_tokens":0}}}'), { status: 'measured', total: 0, records: 1 });
});
test('지원하지 않는 transcript로 예산 게이트를 통과할 수 없다', t => {
  const root = fixture(t);
  copyFileSync(new URL('../assets/hooks/verifierGate.mjs', import.meta.url), join(root, 'verifierGate.mjs'));
  writeFileSync(join(root, 'usage.jsonl'), '{"usage":{"input_tokens":100}}');
  writeFileSync(join(root, 'verifierGate.config.json'), JSON.stringify({ checks: [{ name: 'ok', command: 'node -e "process.exit(0)"' }], maxTokens: 10 }));
  const result = spawnSync(process.execPath, [join(root, 'verifierGate.mjs')], { input: JSON.stringify({ cwd: root, transcript_path: join(root, 'usage.jsonl') }), encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /unsupported/);
});
test('긴 출력 뒤의 다른 실패와 숫자가 다른 테스트 이름을 구분한다', () => {
  const run = name => runChecks({ checks: [{ name: 'test', command: `node -e "console.log('banner '.repeat(600)); console.error('FAIL ${name}'); process.exit(1)"` }] });
  assert.notEqual(failureSignature(run('login')), failureSignature(run('checkout')));
  assert.notEqual(failureSignature([{ name: 'test', output: 'FAIL test1' }]), failureSignature([{ name: 'test', output: 'FAIL test2' }]));
});
test('의존성 없는 Node 검사는 node_modules 없이 실행 후보가 된다', t => {
  const root = fixture(t);
  writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }));
  assert.equal(diagnose(root).commands[0].runnable, 'likely');
});

test('5.1 Codex 등록을 읽고 관리 항목만 갱신하며 복원할 수 있다', async t => {
  const root = fixture(t);
  applyPlan(createPlan(root, { app: 'codex', verifier: true }));
  const manifestPath = join(root, '.agents/harness-install.json');
  const registryPath = join(root, '.codex/hooks.json');
  const manifest = JSON.parse(readFileSync(manifestPath));
  const registry = JSON.parse(readFileSync(registryPath));
  for (const item of manifest.ownedHooks) {
    const entry = registry.hooks[item.event].find(entry => JSON.stringify(entry) === JSON.stringify(item.entry));
    const path = item.entry.hooks[0].command.match(/\.agents\/hooks\/[^" ]+\.mjs/)[0];
    item.entry.hooks[0].command = `node "${path}"`;
    entry.hooks[0].command = item.entry.hooks[0].command;
  }
  const custom = { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo user-hook' }] };
  registry.hooks.PreToolUse.push(custom);
  writeFileSync(manifestPath, JSON.stringify(manifest));
  writeFileSync(registryPath, JSON.stringify(registry));
  assert.ok((await status(root)).hooks.every(item => item.registered.codex));
  const applied = applyPlan(createPlan(root));
  const updated = JSON.parse(readFileSync(registryPath));
  assert.ok(updated.hooks.PreToolUse.some(entry => JSON.stringify(entry) === JSON.stringify(custom)));
  assert.equal(updated.hooks.PreToolUse.length, 4);
  assert.ok(updated.hooks.Stop[0].hooks[0].command.includes('git rev-parse'));
  assert.equal(applyPlan(createPlan(root)).changed, 0);
  rollback(root, applied.backup);
  assert.deepEqual(JSON.parse(readFileSync(registryPath)), registry);
});
