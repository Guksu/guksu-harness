import assert from 'node:assert/strict';
import { test } from 'node:test';
import { load } from './load.mjs';

const { priceOrder } = await load('src/services/pricing.js');
const { COUPONS } = await load('src/services/coupons.js');
const line = (unitPrice, quantity = 1) => ({ sku: 'T', unitPrice, quantity });

test('정액 쿠폰 할인은 상품 금액까지만, 배송비는 그대로', () => {
  assert.deepEqual(priceOrder([line(6000)], 'SORRY10000'), {
    subtotal: 6000, discount: 6000, shipping: 3000, total: 3000, couponCode: 'SORRY10000',
  });
});

test('상품 금액이 쿠폰보다 크면 쿠폰 금액 전부를 할인한다', () => {
  assert.equal(priceOrder([line(60000)], 'SORRY10000').total, 50000);
  assert.equal(priceOrder([line(19000, 2)], 'SPRING5000').discount, 5000);
});

test('모든 쿠폰·금액 조합에서 할인은 상품 금액을 넘지 않고 결제 금액은 음수가 아니다', () => {
  for (const code of Object.keys(COUPONS)) {
    for (let amount = 0; amount <= 120000; amount += 500) {
      const price = priceOrder([line(amount)], code);
      assert.ok(price.discount >= 0 && price.discount <= price.subtotal, `${code} ${amount}: discount ${price.discount}`);
      assert.equal(price.total, price.subtotal - price.discount + price.shipping, `${code} ${amount}`);
      assert.ok(price.total >= price.shipping && price.total >= 0, `${code} ${amount}: total ${price.total}`);
    }
  }
});

test('기존 정률·무료배송 규칙은 그대로다', () => {
  assert.equal(priceOrder([line(59000)], 'WELCOME10').discount, 5000);
  assert.equal(priceOrder([line(100000)], 'VIP20').discount, 20000);
  assert.equal(priceOrder([line(6000)], 'FREESHIP').total, 6000);
});
