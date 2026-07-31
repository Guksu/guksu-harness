import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

// instrument.js는 브라우저 주입용 플레인 스크립트(수출 없음)라 부수효과 import로 설치한다.
// Node에도 EventTarget·타이머·fetch가 있어 핵심 계측 로직을 그대로 검증할 수 있다.
const recordedFetches = [];
globalThis.fetch = async (input, init = {}) => {
  recordedFetches.push({ input, init });
  return { ok: true };
};
await import('./instrument.js');
const api = globalThis.__fePredeploy;

test('설치 — 전역 API가 생기고 재주입해도 안전(멱등)하다', async () => {
  assert.ok(api && typeof api.report === 'function');
  await import('./instrument.js?dup=1').catch(() => {});
  assert.equal(globalThis.__fePredeploy, api, '재설치로 상태가 초기화되면 안 된다');
});

test('리스너 계측 — add/remove 짝, once는 잔존으로 세지 않는다', () => {
  const target = new EventTarget();
  const fn = () => {};
  target.addEventListener('ping', fn);
  assert.equal(api.report().activeListeners, 1);
  assert.equal(api.report().listenersByType.ping, 1);

  target.removeEventListener('ping', fn);
  assert.equal(api.report().activeListeners, 0);

  target.addEventListener('ping', fn, { once: true });
  assert.equal(api.report().activeListeners, 0, 'once 리스너는 발화 시 자동 해제되므로 잔존 아님');
});

test('타이머 계측 — interval은 clear까지 잔존, timeout은 발화하면 스스로 빠진다', async () => {
  const id = setInterval(() => {}, 60_000);
  assert.equal(api.report().activeIntervals, 1);
  clearInterval(id);
  assert.equal(api.report().activeIntervals, 0);

  setTimeout(() => {}, 10);
  assert.equal(api.report().activeTimeouts, 1);
  await delay(30);
  assert.equal(api.report().activeTimeouts, 0);

  const tid = setTimeout(() => {}, 60_000);
  clearTimeout(tid);
  assert.equal(api.report().activeTimeouts, 0);
});

test('요청 계측 — fetch가 기록되고 countRequests로 중복 클릭을 판정한다', async () => {
  api.resetRequests();
  await fetch('/api/submit', { method: 'POST' });
  await fetch('/api/submit', { method: 'POST' });
  await fetch('/api/other');

  assert.equal(api.report().requestCount, 3);
  assert.equal(api.countRequests('/api/submit'), 2);
  assert.equal(api.countRequests('/api/submit', 'POST'), 2);
  assert.equal(api.countRequests('/api/submit', 'GET'), 0);
  assert.equal(recordedFetches.length, 3, '원본 fetch로 그대로 위임되어야 한다');

  api.resetRequests();
  assert.equal(api.report().requestCount, 0);
});

test('console.error 수집 — 메시지가 요약 기록된다', () => {
  const before = api.report().consoleErrors.length;
  console.error('boom: something failed');
  const errors = api.report().consoleErrors;
  assert.equal(errors.length, before + 1);
  assert.ok(errors.at(-1).includes('boom'));
});
