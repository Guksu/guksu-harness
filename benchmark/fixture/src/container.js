// 설정에 따라 서비스 객체를 조립한다. 테스트는 clock·fetchImpl을 바꿔 끼운다.
import { createMemoryStore } from './repo/memoryStore.js';
import { createCatalog } from './services/catalog.js';
import { createInventory } from './services/inventory.js';
import { createOrderService } from './services/orders.js';
import { createPaymentClient } from './services/payment.js';

export function buildContainer(config, { fetchImpl, clock, logger = { error() {} } } = {}) {
  const store = createMemoryStore();
  const catalog = createCatalog();
  const inventory = createInventory(catalog.initialStock());
  let sequence = 0;
  const idGenerator = () => `ord_${String(++sequence).padStart(6, '0')}`;
  const orders = createOrderService({ store, inventory, catalog, idGenerator, clock });
  const payments = createPaymentClient(config.payment, { fetchImpl });
  return { config, store, catalog, inventory, orders, payments, logger };
}
