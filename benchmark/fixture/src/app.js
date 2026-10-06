// HTTP 라우팅. 도메인 오류는 code와 함께 4xx/5xx로 응답한다.
import { DomainError, NotFoundError } from './errors.js';
import { readJson, sendJson } from './lib/http.js';

export function createApp({ orders, payments, logger }) {
  return async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'GET' && url.pathname === '/health') return sendJson(res, 200, { ok: true });

      if (url.pathname === '/orders') {
        if (req.method === 'POST') return sendJson(res, 201, orders.create(await readJson(req)));
        if (req.method === 'GET') {
          const customerId = url.searchParams.get('customerId') ?? undefined;
          return sendJson(res, 200, orders.list({ customerId }));
        }
      }

      const pay = url.pathname.match(/^\/orders\/([\w-]+)\/pay$/);
      if (pay && req.method === 'POST') {
        const order = orders.get(pay[1]);
        const approval = await payments.approve({ orderId: order.id, amount: order.total });
        return sendJson(res, 200, orders.markPaid(order.id, approval.paymentKey));
      }

      const detail = url.pathname.match(/^\/orders\/([\w-]+)$/);
      if (detail && req.method === 'GET') return sendJson(res, 200, orders.get(detail[1]));

      throw new NotFoundError(`${req.method} ${url.pathname} 경로가 없습니다`, 'route_not_found');
    } catch (error) {
      if (error instanceof DomainError) return sendJson(res, error.status, { error: error.code, message: error.message });
      logger.error('unhandled error', error);
      return sendJson(res, 500, { error: 'internal_error', message: '서버 오류가 발생했습니다' });
    }
  };
}
