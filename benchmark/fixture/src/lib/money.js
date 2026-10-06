// 금액은 원 단위 정수로만 다룬다(docs/adr/0001-money-as-integer.md).

export function assertWon(value, label = 'amount') {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label}은(는) 0 이상의 원 단위 정수여야 합니다: ${value}`);
  }
  return value;
}

// 정률 계산. 원 미만은 버린다.
export function percentOf(amount, percent) {
  assertWon(amount);
  return Math.floor((amount * percent) / 100);
}

export function formatWon(amount) {
  return `${amount.toLocaleString('ko-KR')}원`;
}
