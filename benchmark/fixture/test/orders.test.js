import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildContainer } from '../src/container.js';

const fixedClock = () => {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 0, 1, 9, 0, tick++));
};

const setup = () => buildContainer({ payment: { baseUrl: 'http://pg.test', secretKey: 'test', timeoutMs: 1000 } }, { clock: fixedClock() });

test('주문을 만들면 금액을 계산하고 재고를 예약한다', () => {
  const { orders, inventory } = setup();
  const order = orders.create({ customerId: 'c-1', items: [{ sku: 'TEE-BLK-M', quantity: 2 }], couponCode: 'WELCOME10' });
  assert.equal(order.id, 'ord_000001');
  assert.equal(order.status, 'pending');
  assert.equal(order.subtotal, 38000);
  assert.equal(order.discount, 3800);
  assert.equal(order.total, 37200);
  assert.equal(inventory.available('TEE-BLK-M'), 38);
});

test('목록은 최신순이고 customerId로 거를 수 있다', () => {
  const { orders } = setup();
  orders.create({ customerId: 'c-1', items: [{ sku: 'CAP-NVY', quantity: 1 }] });
  orders.create({ customerId: 'c-2', items: [{ sku: 'CAP-NVY', quantity: 1 }] });
  orders.create({ customerId: 'c-1', items: [{ sku: 'SOCKS-3P', quantity: 1 }] });
  assert.deepEqual(orders.list().map((order) => order.id), ['ord_000003', 'ord_000002', 'ord_000001']);
  assert.deepEqual(orders.list({ customerId: 'c-1' }).map((order) => order.id), ['ord_000003', 'ord_000001']);
});

test('없는 상품·잘못된 수량은 거절한다', () => {
  const { orders } = setup();
  assert.throws(() => orders.create({ customerId: 'c-1', items: [{ sku: 'NOPE', quantity: 1 }] }), { code: 'unknown_sku' });
  assert.throws(() => orders.create({ customerId: 'c-1', items: [{ sku: 'CAP-NVY', quantity: 0 }] }), { code: 'invalid_request' });
});

test('없는 주문 조회는 order_not_found', () => {
  assert.throws(() => setup().orders.get('ord_999999'), { code: 'order_not_found' });
});
