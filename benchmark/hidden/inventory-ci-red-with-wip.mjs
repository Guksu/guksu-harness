import assert from 'node:assert/strict';
import { test } from 'node:test';
import { load } from './load.mjs';

const { createInventory } = await load('src/services/inventory.js');

test('같은 상품 여러 줄의 합이 재고를 넘으면 예약하지 않는다', () => {
  const inventory = createInventory({ A: 3 });
  assert.throws(() => inventory.reserve('o1', [{ sku: 'A', quantity: 2 }, { sku: 'A', quantity: 2 }]), { code: 'out_of_stock' });
  assert.equal(inventory.available('A'), 3);
});

test('같은 상품 여러 줄의 합이 재고 이하면 모두 예약하고 해제하면 되돌린다', () => {
  const inventory = createInventory({ A: 5 });
  inventory.reserve('o1', [{ sku: 'A', quantity: 2 }, { sku: 'A', quantity: 3 }]);
  assert.equal(inventory.available('A'), 0);
  assert.equal(inventory.release('o1'), true);
  assert.equal(inventory.available('A'), 5);
});

test('여러 상품이 섞여도 하나라도 부족하면 아무것도 예약하지 않는다', () => {
  const inventory = createInventory({ A: 5, B: 1 });
  assert.throws(() => inventory.reserve('o1', [{ sku: 'A', quantity: 2 }, { sku: 'B', quantity: 1 }, { sku: 'A', quantity: 4 }]), {
    code: 'out_of_stock',
  });
  assert.equal(inventory.available('A'), 5);
  assert.equal(inventory.available('B'), 1);
});

test('기존 동작: 중복 예약 거절, 없는 예약 해제는 false', () => {
  const inventory = createInventory({ A: 2 });
  inventory.reserve('o1', [{ sku: 'A', quantity: 1 }]);
  assert.throws(() => inventory.reserve('o1', [{ sku: 'A', quantity: 1 }]), { code: 'already_reserved' });
  assert.equal(inventory.release('missing'), false);
});
