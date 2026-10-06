// 도메인 오류. app.js가 code를 HTTP 상태로 바꾼다.
export class DomainError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.status = status;
  }
}

export class ValidationError extends DomainError {
  constructor(message, code = 'invalid_request') {
    super(message, code, 400);
  }
}

export class NotFoundError extends DomainError {
  constructor(message, code = 'not_found') {
    super(message, code, 404);
  }
}

export class ConflictError extends DomainError {
  constructor(message, code = 'conflict') {
    super(message, code, 409);
  }
}

export class PaymentError extends DomainError {
  constructor(message, code = 'payment_failed') {
    super(message, code, 502);
  }
}
