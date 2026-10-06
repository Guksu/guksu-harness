// 판매 상품. 상품 서비스 연동 전까지 고정 목록을 쓴다. stock은 서버 시작 시점의 재고다.
export const PRODUCTS = Object.freeze({
  'TEE-BLK-M': { name: '베이직 티셔츠 블랙 M', price: 19000, stock: 40 },
  'TEE-WHT-L': { name: '베이직 티셔츠 화이트 L', price: 19000, stock: 25 },
  'HOODIE-GRY-L': { name: '후드 집업 그레이 L', price: 59000, stock: 8 },
  'CAP-NVY': { name: '볼캡 네이비', price: 25000, stock: 12 },
  'SOCKS-3P': { name: '양말 3켤레 세트', price: 6000, stock: 100 },
});

export function createCatalog(products = PRODUCTS) {
  return {
    find(sku) {
      const product = products[sku];
      return product ? { sku, name: product.name, price: product.price } : null;
    },
    initialStock() {
      return Object.fromEntries(Object.entries(products).map(([sku, product]) => [sku, product.stock]));
    },
  };
}
