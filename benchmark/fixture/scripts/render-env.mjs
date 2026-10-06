// 배포 파이프라인이 런타임 환경 파일을 만들 때 쓴다. 키 목록은 .env.example과 같아야 한다.
import { readFileSync } from 'node:fs';

const keys = readFileSync(new URL('../.env.example', import.meta.url), 'utf8')
  .split('\n')
  .map((line) => line.split('=')[0].trim())
  .filter(Boolean);

const missing = keys.filter((key) => process.env[key] == null);
if (missing.length) {
  process.stderr.write(`missing environment: ${missing.join(', ')}\n`);
  process.exit(1);
}
process.stdout.write(keys.map((key) => `${key}=${process.env[key]}`).join('\n') + '\n');
