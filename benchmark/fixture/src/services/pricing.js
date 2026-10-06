// 주문 금액 계산. 정책: docs/pricing-policy.md
import { ValidationError } from '../errors.js';
import { assertWon, percentOf } from '../lib/money.js';
import { findCoupon } from './coupons.js';

export const SHIPPING_FEE = 3000;
export const FREE_SHIPPING_THRESHOLD = 50000;

export function calculateSubtotal(items) {
  return items.reduce((sum, item) => sum + assertWon(item.unitPrice, 'unitPrice') * item.quantity, 0);
}

export function calculateDiscount(subtotal, coupon) {
  if (!coupon || subtotal < (coupon.minOrder ?? 0)) return 0;
  if (coupon.type === 'percent') {
    return Math.min(percentOf(subtotal, coupon.value), coupon.maxDiscount ?? Number.POSITIVE_INFINITY);
  }
  if (coupon.type === 'fixed') return coupon.value;
  return 0;
}

export function calculateShipping(subtotal, coupon) {
  if (coupon?.type === 'shipping' && subtotal >= (coupon.minOrder ?? 0)) return 0;
  return subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING_FEE;
}

export function priceOrder(items, couponCode) {
  const coupon = couponCode ? findCoupon(couponCode) : null;
  if (couponCode && !coupon) throw new ValidationError(`존재하지 않는 쿠폰입니다: ${couponCode}`, 'invalid_coupon');
  const subtotal = calculateSubtotal(items);
  const discount = calculateDiscount(subtotal, coupon);
  const shipping = calculateShipping(subtotal, coupon);
  return { subtotal, discount, shipping, total: subtotal - discount + shipping, couponCode: coupon?.code ?? null };
}
