import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';
import { buildContainer } from '../src/container.js';

let server;
let baseUrl;
let pgStatus = 200;

const fakePg = async () => new Response(JSON.stringify({ paymentKey: 'pay_test_1', approvedAt: '2026-01-01T00:00:00Z' }), { status: pgStatus });

before(async () => {
  const container = buildContainer({ payment: { baseUrl: 'http://pg.test', secretKey: 'test', timeoutMs: 1000 } }, { fetchImpl: fakePg });
  server = createServer(createApp(container));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

const request = async (method, path, body) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
};

test('주문 생성·조회·목록', async () => {
  const created = await request('POST', '/orders', { customerId: 'c-1', items: [{ sku: 'HOODIE-GRY-L', quantity: 1 }] });
  assert.equal(created.status, 201);
  assert.equal(created.body.total, 59000);
  const detail = await request('GET', `/orders/${created.body.id}`);
  assert.equal(detail.body.id, created.body.id);
  const list = await request('GET', '/orders?customerId=c-1');
  assert.ok(Array.isArray(list.body));
  assert.equal(list.body[0].id, created.body.id);
});

test('잘못된 쿠폰은 400, 없는 경로는 404', async () => {
  const invalid = await request('POST', '/orders', { customerId: 'c-1', items: [{ sku: 'CAP-NVY', quantity: 1 }], couponCode: 'NOPE' });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error, 'invalid_coupon');
  assert.equal((await request('GET', '/nope')).status, 404);
});

test('결제 승인과 PG 인증 실패', async () => {
  const order = (await request('POST', '/orders', { customerId: 'c-2', items: [{ sku: 'CAP-NVY', quantity: 1 }] })).body;
  pgStatus = 401;
  const failed = await request('POST', `/orders/${order.id}/pay`);
  assert.equal(failed.status, 502);
  assert.equal(failed.body.error, 'payment_unauthorized');
  pgStatus = 200;
  const paid = await request('POST', `/orders/${order.id}/pay`);
  assert.equal(paid.status, 200);
  assert.equal(paid.body.status, 'paid');
});
