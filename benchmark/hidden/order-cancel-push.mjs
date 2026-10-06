import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startServer } from './load.mjs';

let api;
before(async () => {
  api = await startServer();
});
after(() => api.close());

const createOrder = async (sku = 'HOODIE-GRY-L') =>
  (await api.request('POST', '/orders', { customerId: 'c-9', items: [{ sku, quantity: 2 }] })).body;

test('결제 전 주문 취소는 200 cancelled이고 재고를 되돌린다', async () => {
  const before = api.container.inventory.available('HOODIE-GRY-L');
  const order = await createOrder();
  assert.equal(api.container.inventory.available('HOODIE-GRY-L'), before - 2);
  const response = await api.request('POST', `/orders/${order.id}/cancel`);
  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'cancelled');
  assert.equal(api.container.inventory.available('HOODIE-GRY-L'), before);
});

test('결제한 주문은 409, 없는 주문은 404', async () => {
  const order = await createOrder('CAP-NVY');
  api.container.orders.markPaid(order.id, 'pay_1');
  assert.equal((await api.request('POST', `/orders/${order.id}/cancel`)).status, 409);
  assert.equal((await api.request('POST', '/orders/ord_999999/cancel')).status, 404);
});
