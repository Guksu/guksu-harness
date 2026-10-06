import { ConflictError, NotFoundError, ValidationError } from '../errors.js';
import { priceOrder } from './pricing.js';

const MAX_LINES = 50;
const MAX_QUANTITY = 99;

function validateOrderInput(input) {
  if (!input || typeof input !== 'object') throw new ValidationError('주문 본문이 필요합니다');
  const { customerId, items, couponCode } = input;
  if (typeof customerId !== 'string' || !customerId.trim()) throw new ValidationError('customerId가 필요합니다');
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_LINES) {
    throw new ValidationError(`주문 상품은 1~${MAX_LINES}줄이어야 합니다`);
  }
  for (const item of items) {
    if (typeof item?.sku !== 'string' || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > MAX_QUANTITY) {
      throw new ValidationError(`상품 줄 형식이 잘못되었습니다: ${JSON.stringify(item)}`);
    }
  }
  if (couponCode != null && typeof couponCode !== 'string') throw new ValidationError('couponCode는 문자열이어야 합니다');
  return { customerId: customerId.trim(), items, couponCode: couponCode ?? null };
}

export function createOrderService({ store, inventory, catalog, idGenerator, clock = () => new Date() }) {
  return {
    create(input) {
      const { customerId, items, couponCode } = validateOrderInput(input);
      const lines = items.map((item) => {
        const product = catalog.find(item.sku);
        if (!product) throw new ValidationError(`없는 상품입니다: ${item.sku}`, 'unknown_sku');
        return { sku: product.sku, name: product.name, unitPrice: product.price, quantity: item.quantity };
      });
      const price = priceOrder(lines, couponCode);
      const id = idGenerator();
      inventory.reserve(id, lines);
      return store.insert({ id, customerId, status: 'pending', items: lines, ...price, createdAt: clock().toISOString() });
    },

    // 최신순. 같은 시각이면 나중에 만든 주문이 먼저다.
    list({ customerId } = {}) {
      return store
        .all()
        .filter((order) => !customerId || order.customerId === customerId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
    },

    get(id) {
      const order = store.find(id);
      if (!order) throw new NotFoundError(`주문이 없습니다: ${id}`, 'order_not_found');
      return order;
    },

    markPaid(id, paymentKey) {
      const order = this.get(id);
      if (order.status !== 'pending') throw new ConflictError(`결제할 수 없는 상태입니다: ${order.status}`, 'invalid_status');
      return store.update(id, { status: 'paid', paymentKey, paidAt: clock().toISOString() });
    },
  };
}
