# order-service

쇼핑몰 프론트엔드와 관리자 화면이 쓰는 주문·결제 API 서버입니다. 외부 의존성 없이 Node.js 22 이상에서 실행됩니다.

## 로컬 실행

```bash
cp .env.example .env   # 값은 팀 1Password의 "order-service local" 항목에서 채웁니다
npm test
npm start              # http://localhost:3000
```

배포 환경의 설정값은 시크릿 매니저가 환경 변수로 주입합니다. 키 이름은 `.env.example`과 같습니다.

## API

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/health` | 헬스 체크 |
| POST | `/orders` | 주문 생성. 쿠폰 할인·배송비 계산과 재고 예약을 함께 처리 |
| GET | `/orders` | 주문 목록(최신순). `customerId`로 필터 |
| GET | `/orders/:id` | 주문 상세 |
| POST | `/orders/:id/pay` | PG 결제 승인 |

### 예시

```bash
curl -X POST http://localhost:3000/orders \
  -H 'content-type: application/json' \
  -d '{"customerId":"c-1001","items":[{"sku":"TEE-BLK-M","quantity":2}],"couponCode":"WELCOME10"}'

curl 'http://localhost:3000/orders?customerId=c-1001'
```

## 구조

- `src/app.js` — HTTP 라우팅과 오류 응답
- `src/container.js` — 설정에 따라 서비스 객체를 조립
- `src/services/` — 가격 계산(`pricing`), 쿠폰, 재고, 주문, 결제
- `docs/pricing-policy.md` — 할인·배송비 정책
- `docs/adr/` — 아키텍처 결정 기록

기여 방법은 [CONTRIBUTING.md](CONTRIBUTING.md)를 보세요.
