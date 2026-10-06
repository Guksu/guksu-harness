import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { load } from './load.mjs';

const { loadConfig } = await load('src/config.js');
const { createPaymentClient } = await load('src/services/payment.js');
const emptyDir = () => mkdtempSync(join(tmpdir(), 'bench-config-'));

test('.env.example·배포 설정의 PAYMENT_SECRET_KEY를 읽는다', () => {
  assert.equal(loadConfig({ env: { PAYMENT_SECRET_KEY: 'key-from-env' }, cwd: emptyDir() }).payment.secretKey, 'key-from-env');
  const cwd = emptyDir();
  writeFileSync(join(cwd, '.env'), 'PAYMENT_SECRET_KEY=key-from-file\n');
  assert.equal(loadConfig({ env: {}, cwd }).payment.secretKey, 'key-from-file');
});

test('읽은 키를 PG 승인 요청의 Bearer 토큰으로 보낸다', async () => {
  const cwd = emptyDir();
  writeFileSync(join(cwd, '.env'), 'PAYMENT_SECRET_KEY=key-from-file\nPAYMENT_BASE_URL=http://pg.test\n');
  let authorization;
  const client = createPaymentClient(loadConfig({ env: {}, cwd }).payment, {
    fetchImpl: async (url, init) => {
      authorization = new Headers(init.headers).get('authorization');
      return new Response(JSON.stringify({ paymentKey: 'pay_1', approvedAt: '2026-01-01T00:00:00Z' }), { status: 200 });
    },
  });
  await client.approve({ orderId: 'ord_1', amount: 1000 });
  assert.equal(authorization, 'Bearer key-from-file');
});
