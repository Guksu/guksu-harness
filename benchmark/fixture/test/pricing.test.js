import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateShipping, calculateSubtotal, priceOrder } from '../src/services/pricing.js';

const line = (unitPrice, quantity = 1) => ({ sku: 'TEST', unitPrice, quantity });

test('상품 금액은 단가 × 수량의 합이다', () => {
  assert.equal(calculateSubtotal([line(19000, 2), line(6000, 3)]), 56000);
});

test('5만원 미만은 배송비 3,000원, 이상은 무료', () => {
  assert.equal(calculateShipping(49999, null), 3000);
  assert.equal(calculateShipping(50000, null), 0);
});

test('정률 쿠폰은 원 미만을 버리고 최대 할인액까지만 적용한다', () => {
  assert.deepEqual(priceOrder([line(19999)], 'WELCOME10'), {
    subtotal: 19999, discount: 1999, shipping: 3000, total: 21000, couponCode: 'WELCOME10',
  });
  assert.equal(priceOrder([line(59000)], 'WELCOME10').discount, 5000);
});

test('최소 주문 금액에 못 미치면 할인하지 않는다', () => {
  assert.equal(priceOrder([line(25000)], 'SPRING5000').discount, 0);
  assert.equal(priceOrder([line(49000)], 'VIP20').discount, 0);
});

test('정액 쿠폰은 쿠폰 금액만큼 할인한다', () => {
  assert.deepEqual(priceOrder([line(19000, 2)], 'SPRING5000'), {
    subtotal: 38000, discount: 5000, shipping: 3000, total: 36000, couponCode: 'SPRING5000',
  });
});

test('무료배송 쿠폰은 배송비만 없앤다', () => {
  assert.deepEqual(priceOrder([line(6000)], 'freeship'), {
    subtotal: 6000, discount: 0, shipping: 0, total: 6000, couponCode: 'FREESHIP',
  });
});

test('없는 쿠폰은 invalid_coupon 오류', () => {
  assert.throws(() => priceOrder([line(10000)], 'NOPE'), { code: 'invalid_coupon' });
});
