// 설정 로딩. 배포 환경은 환경 변수를 주입받고, 로컬은 프로젝트 루트의 .env를 함께 읽는다.
// 같은 키가 있으면 환경 변수가 우선한다. 키 목록은 .env.example에 있다.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// KEY=VALUE 줄만 읽는 최소 파서. 빈 줄·주석·따옴표를 처리한다.
export function parseDotEnv(text) {
  const vars = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    vars[key] = value;
  }
  return vars;
}

const toInt = (value, fallback) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) ? parsed : fallback;
};

export function loadConfig({ env = process.env, cwd = process.cwd() } = {}) {
  const envFile = join(cwd, '.env');
  const vars = { ...(existsSync(envFile) ? parseDotEnv(readFileSync(envFile, 'utf8')) : {}), ...env };
  return {
    port: toInt(vars.PORT, 8080),
    payment: {
      baseUrl: vars.PAYMENT_BASE_URL ?? 'https://sandbox.paygate.example',
      secretKey: vars.PAYMENT_SECRET_KEY ?? '',
      timeoutMs: toInt(vars.PAYMENT_TIMEOUT_MS, 3000),
    },
    databaseUrl: vars.ORDER_DB_URL ?? 'memory://local',
  };
}
