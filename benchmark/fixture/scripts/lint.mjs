// 팀 린트 규칙. 외부 도구 없이 src/와 test/의 흔한 실수를 막는다.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 인자로 프로젝트 경로를 받을 수 있다. 생략하면 이 스크립트의 상위 폴더다.
const root = resolve(process.argv[2] ?? fileURLToPath(new URL('..', import.meta.url)));
const rules = [
  { id: 'no-console', pattern: /\bconsole\.(log|debug|info)\(/, scope: 'src/', message: '로그는 주입받은 logger를 쓰세요' },
  { id: 'no-debugger', pattern: /\bdebugger\b/, scope: '', message: 'debugger 문을 지우세요' },
  { id: 'no-only', pattern: /\b(?:test|it|describe)\.only\(/, scope: 'test/', message: '.only가 남아 있습니다' },
  { id: 'no-trailing-space', pattern: /[ \t]+$/, scope: '', message: '줄 끝 공백' },
];

const files = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(?:js|mjs)$/.test(name) ? [path] : [];
  });

const problems = [];
for (const file of [...files(join(root, 'src')), ...files(join(root, 'test'))]) {
  const path = relative(root, file);
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, index) => {
      for (const rule of rules) {
        if (path.startsWith(rule.scope) && rule.pattern.test(line)) {
          problems.push(`${path}:${index + 1} ${rule.id} — ${rule.message}`);
        }
      }
    });
}

if (problems.length) {
  process.stderr.write(`${problems.join('\n')}\n\n린트 실패 ${problems.length}건\n`);
  process.exit(1);
}
process.stdout.write('lint ok\n');
