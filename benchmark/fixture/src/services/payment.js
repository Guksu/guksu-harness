// PG 결제 승인 클라이언트. 키는 Bearer 토큰으로 보낸다.
import { PaymentError } from '../errors.js';

export function createPaymentClient({ baseUrl, secretKey, timeoutMs }, { fetchImpl = globalThis.fetch } = {}) {
  return {
    async approve({ orderId, amount }) {
      let response;
      try {
        response = await fetchImpl(`${baseUrl}/v1/payments/approve`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${secretKey}`,
            'content-type': 'application/json',
            'idempotency-key': orderId,
          },
          body: JSON.stringify({ orderId, amount }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        throw new PaymentError(`PG 연결 실패: ${error.message}`, 'payment_unreachable');
      }
      if (response.status === 401) {
        throw new PaymentError('PG 인증 실패(401). 결제 키 설정을 확인하세요', 'payment_unauthorized');
      }
      if (!response.ok) throw new PaymentError(`PG 승인 실패(${response.status})`, 'payment_failed');
      const body = await response.json();
      return { paymentKey: body.paymentKey, approvedAt: body.approvedAt };
    },
  };
}
