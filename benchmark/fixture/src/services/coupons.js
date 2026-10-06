// 운영 중인 쿠폰. 쿠폰 서비스가 분리되기 전까지 코드로 관리한다.
// 규칙은 docs/pricing-policy.md를 따른다.
export const COUPONS = Object.freeze({
  WELCOME10: { type: 'percent', value: 10, maxDiscount: 5000, minOrder: 0 },
  VIP20: { type: 'percent', value: 20, maxDiscount: 20000, minOrder: 50000 },
  SPRING5000: { type: 'fixed', value: 5000, minOrder: 30000 },
  SORRY10000: { type: 'fixed', value: 10000, minOrder: 0 }, // CS 보상용. 최소 주문 금액 없음
  FREESHIP: { type: 'shipping', minOrder: 0 },
});

export function findCoupon(code) {
  if (typeof code !== 'string') return null;
  const normalized = code.trim().toUpperCase();
  const coupon = COUPONS[normalized];
  return coupon ? { code: normalized, ...coupon } : null;
}
