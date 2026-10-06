import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createInventory } from '../src/services/inventory.js';

test('예약하면 재고가 줄고 해제하면 돌아온다', () => {
  const inventory = createInventory({ A: 5, B: 2 });
  inventory.reserve('o1', [{ sku: 'A', quantity: 3 }, { sku: 'B', quantity: 2 }]);
  assert.equal(inventory.available('A'), 2);
  assert.equal(inventory.available('B'), 0);
  assert.equal(inventory.release('o1'), true);
  assert.equal(inventory.available('A'), 5);
  assert.equal(inventory.available('B'), 2);
});

test('재고가 부족하면 아무것도 예약하지 않는다', () => {
  const inventory = createInventory({ A: 5, B: 1 });
  assert.throws(() => inventory.reserve('o1', [{ sku: 'A', quantity: 3 }, { sku: 'B', quantity: 2 }]), {
    code: 'out_of_stock',
  });
  assert.equal(inventory.available('A'), 5);
  assert.equal(inventory.available('B'), 1);
});

test('같은 주문을 두 번 예약할 수 없다', () => {
  const inventory = createInventory({ A: 5 });
  inventory.reserve('o1', [{ sku: 'A', quantity: 1 }]);
  assert.throws(() => inventory.reserve('o1', [{ sku: 'A', quantity: 1 }]), { code: 'already_reserved' });
});

test('없는 예약 해제는 false', () => {
  assert.equal(createInventory({}).release('missing'), false);
});
