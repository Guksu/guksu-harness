// 재고 예약. 주문 생성 시 예약하고, 취소되면 되돌린다.
import { ConflictError } from '../errors.js';

export function createInventory(initialStock = {}) {
  const stock = new Map(Object.entries(initialStock));
  const reservations = new Map();

  const available = (sku) => stock.get(sku) ?? 0;

  return {
    available,

    // 모든 품목의 재고를 먼저 확인한 뒤 차감한다. 일부만 예약된 상태를 남기지 않는다.
    reserve(orderId, items) {
      if (reservations.has(orderId)) throw new ConflictError(`이미 예약된 주문입니다: ${orderId}`, 'already_reserved');
      for (const item of items) {
        if (available(item.sku) < item.quantity) {
          throw new ConflictError(`재고가 부족합니다: ${item.sku}`, 'out_of_stock');
        }
      }
      for (const item of items) stock.set(item.sku, available(item.sku) - item.quantity);
      reservations.set(orderId, items.map(({ sku, quantity }) => ({ sku, quantity })));
    },

    release(orderId) {
      const items = reservations.get(orderId);
      if (!items) return false;
      for (const item of items) stock.set(item.sku, available(item.sku) + item.quantity);
      reservations.delete(orderId);
      return true;
    },
  };
}
