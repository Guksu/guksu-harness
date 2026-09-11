import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function fixture(t, config) {
  const dir = mkdtempSync(join(tmpdir(), 'harness-verifier-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const hook = join(dir, 'verifierGate.mjs');
  copyFileSync(new URL('../assets/hooks/verifierGate.mjs', import.meta.url), hook);
  writeFileSync(join(dir, 'verifierGate.config.json'), JSON.stringify(config));
  return (active = false, session = 'test') => spawnSync(process.execPath, [hook], {
    input: JSON.stringify({ cwd: dir, session_id: session, stop_hook_active: active }), encoding: 'utf8',
  });
}
const failure = { name: 'test', command: 'node -e "process.exit(1)"' };
test('실패 후 이어진 Stop도 재검사하고 상한에서 보고 한 번 후 종료한다', t => {
  const run = fixture(t, { checks: [failure], maxIterations: 2 });
  assert.equal(run().status, 2);
  assert.match(run(true).stderr, /종료 규칙 미충족/);
  assert.match(run(true).stderr, /최대 반복/);
  assert.equal(run(true).status, 0);
});
test('같은 실패 반복은 세션별로 분리해 중단한다', t => {
  const run = fixture(t, { checks: [failure], maxIterations: 10, stuckAfter: 2 });
  run();
  assert.match(run(true).stderr, /막힘 판정/);
  assert.match(run(true, 'other').stderr, /종료 규칙 미충족/);
  assert.equal(run(true).status, 0);
});
test('잘못된 설정은 성공처럼 조용히 종료하지 않고 설명 후 종료한다', t => {
  const run = fixture(t, { checks: [], maxIterations: -1 });
  assert.equal(run().status, 2);
  assert.equal(run(true).status, 0);
});
test('검증 통과는 이어진 Stop에서도 종료를 허용한다', t => {
  const run = fixture(t, { checks: [{ name: 'ok', command: 'node -e "process.exit(0)"' }], maxIterations: 2 });
  assert.equal(run(true).status, 0);
});
