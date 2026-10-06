// 고객 알림. 발송은 메시지 대행사 클라이언트(send)에 맡긴다.
export function createNotifier({ send }) {
  return {
    async orderConfirmed(order) {
      await send({
        to: order.customerId,
        template: 'order-confirmed',
        data: { orderId: order.id, total: order.total },
      });
    },

    async orderPaid(order) {
      await send({
        to: order.customerId,
        template: 'order-paid',
        data: { orderId: order.id, paidAt: order.paidAt },
      });
    },
  };
}
