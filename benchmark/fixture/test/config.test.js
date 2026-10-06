import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadConfig, parseDotEnv } from '../src/config.js';

test('.env 파서는 주석·빈 줄·따옴표를 처리한다', () => {
  assert.deepEqual(parseDotEnv('# 주석\n\nPORT=9000\nNAME="order service"\nBROKEN\n'), {
    PORT: '9000',
    NAME: 'order service',
  });
});

test('기본 포트는 8080이고 환경 변수가 .env보다 우선한다', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'order-config-'));
  assert.equal(loadConfig({ env: {}, cwd }).port, 8080);
  writeFileSync(join(cwd, '.env'), 'PORT=9000\nPAYMENT_TIMEOUT_MS=1500\n');
  assert.equal(loadConfig({ env: {}, cwd }).port, 9000);
  assert.equal(loadConfig({ env: {}, cwd }).payment.timeoutMs, 1500);
  assert.equal(loadConfig({ env: { PORT: '7000' }, cwd }).port, 7000);
});
