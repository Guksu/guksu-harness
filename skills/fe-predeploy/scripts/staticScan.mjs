#!/usr/bin/env node
// fe-predeploy 정적 스캔 — 프론트엔드(퓨어 JS·React·Next.js) 소스의 배포 전 위험 신호를
// 휴리스틱으로 잡는다. 규칙 기반이 아니라 휴리스틱이므로 결과는 "확정 버그"가 아니라
// "사람이 확인할 후보 목록"이다(오탐 가능 — severity로 구분: blocker는 오탐이 거의 없는 것만).
// 사용: node staticScan.mjs <프로젝트 경로> [--json]  → blocker 발견 시 exit 1
import { readdirSync, readFileSync, realpathSync, existsSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCAN_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);
const EXCLUDED_DIRS = new Set([
  'node_modules', '.next', '.git', 'dist', 'build', 'out', 'coverage', 'public', '_workspace',
]);
const TEST_FILE = /(\.test\.|\.spec\.|__tests__|__mocks__)/;

const lineOf = (source, index) => source.slice(0, index).split('\n').length;

// effect-no-cleanup: useEffect( 이후 괄호 균형으로 콜백 블록을 잘라 본문을 본다.
const effectBlocks = (source) => {
  const blocks = [];
  const re = /useEffect\s*\(/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    for (let i = open; i < source.length; i += 1) {
      if (source[i] === '(') depth += 1;
      else if (source[i] === ')') {
        depth -= 1;
        if (depth === 0) {
          blocks.push({ body: source.slice(open + 1, i), line: lineOf(source, m.index) });
          break;
        }
      }
    }
  }
  return blocks;
};

const SECRET_PATTERNS = [
  /sk_live_[A-Za-z0-9]{8,}/,
  /AKIA[0-9A-Z]{16}/,
  /ghp_[A-Za-z0-9]{20,}/,
  /AIza[0-9A-Za-z_-]{20,}/,
  /(?:api[_-]?key|secret|token|password)\s*[:=]\s*['"`][A-Za-z0-9_-]{20,}['"`]/i,
];

const EFFECT_LEAK_SOURCES = /addEventListener|setInterval|\.subscribe\s*\(|new\s+WebSocket|\.addListener\s*\(/;

export const scanSource = (source, { file, isNext = false } = {}) => {
  const findings = [];
  const push = (rule, severity, line, message) => findings.push({ rule, severity, file, line, message });
  const jsx = /\.(jsx|tsx)$/.test(file ?? '');

  // 파일 단위 휴리스틱 — 등록만 있고 해제 수단(짝 함수·AbortController)이 전혀 없는 파일
  if (/\baddEventListener\s*\(/.test(source)
    && !/\bremoveEventListener\s*\(/.test(source)
    && !/AbortController|signal\s*:/.test(source)) {
    push('listener-no-cleanup', 'warn', lineOf(source, source.search(/\baddEventListener\s*\(/)),
      'addEventListener만 있고 removeEventListener/AbortController가 없다 — 리스너 누수 후보');
  }
  if (/\bsetInterval\s*\(/.test(source) && !/\bclearInterval\s*\(/.test(source)) {
    push('interval-no-clear', 'warn', lineOf(source, source.search(/\bsetInterval\s*\(/)),
      'setInterval만 있고 clearInterval이 없다 — 타이머 누수 후보');
  }
  for (const block of effectBlocks(source)) {
    if (EFFECT_LEAK_SOURCES.test(block.body) && !/\breturn\b/.test(block.body)) {
      push('effect-no-cleanup', 'warn', block.line,
        'useEffect가 리스너·타이머·구독을 등록하는데 클린업 return이 없다 — 언마운트 누수 후보');
    }
  }

  // 라인 단위
  const lines = source.split('\n');
  lines.forEach((text, i) => {
    if (/\bconsole\.log\s*\(/.test(text)) {
      push('console-log', 'warn', i + 1, 'console.log 잔존 — 배포 번들에서 제거 대상');
    }
    if (/(^|[^.\w])debugger\b/.test(text)) {
      push('debugger', 'blocker', i + 1, 'debugger 문 잔존 — 배포 불가');
    }
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(text)) {
        push('secret-literal', 'blocker', i + 1,
          '시크릿으로 보이는 리터럴 — 클라이언트 번들에 포함되면 그대로 유출이다 (값은 기록하지 않음)');
        break;
      }
    }
    if (/dangerouslySetInnerHTML/.test(text)) {
      push('dangerous-html', 'warn', i + 1, 'dangerouslySetInnerHTML — XSS 표면, sanitize 여부 확인');
    }
    if (isNext && jsx && /<img[\s/>]/.test(text)) {
      push('next-img-tag', 'warn', i + 1, 'Next.js에서 <img> 태그 — next/image 사용 검토(최적화·CLS)');
    }
  });

  // Next.js 클라이언트 컴포넌트에서 비공개 env 참조 — 빌드에 인라인되지 않아 undefined가 되거나,
  // 우회해서 넣으면 그대로 노출된다.
  if (isNext && /^\s*['"]use client['"]/.test(source)) {
    const envRe = /process\.env\.(?!NEXT_PUBLIC_)[A-Z0-9_]+/g;
    let m;
    while ((m = envRe.exec(source)) !== null) {
      push('env-secret-client', 'warn', lineOf(source, m.index),
        `'use client' 파일에서 비공개 env 참조(${m[0].slice(12)}) — 클라이언트에선 undefined이거나 노출 위험`);
    }
  }

  return findings;
};

const walk = (dir, files = []) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name)) walk(join(dir, entry.name), files);
    } else if (SCAN_EXTENSIONS.has(extname(entry.name))
      && !TEST_FILE.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      files.push(join(dir, entry.name));
    }
  }
  return files;
};

const detectNext = (root) => {
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    if (pkg.dependencies?.next || pkg.devDependencies?.next) return true;
  } catch { /* package.json 없음·파싱 실패 → config 파일로 판정 */ }
  return ['next.config.js', 'next.config.mjs', 'next.config.ts'].some((f) => existsSync(join(root, f)));
};

export const scanProject = async (root) => {
  const isNext = detectNext(root);
  const files = walk(root).filter((f) => !TEST_FILE.test(relative(root, f)));
  const findings = [];
  for (const file of files) {
    findings.push(...scanSource(readFileSync(file, 'utf8'), { file: relative(root, file), isNext }));
  }
  return { findings, scannedFiles: files.length, isNext };
};

// 심링크 경로 호출 시 ESM URL(realpath) ↔ argv[1](원문) 불일치로 CLI가 침묵 종료되지 않게
// 양쪽을 realpath로 정규화해 비교한다 (훅 4종과 동일한 규칙).
const toRealPath = (p) => { try { return realpathSync(p); } catch { return p; } };
const isDirectRun = process.argv[1] != null
  && toRealPath(process.argv[1]) === toRealPath(fileURLToPath(import.meta.url));

if (isDirectRun) {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const root = args.find((a) => !a.startsWith('--'));
  if (!root) {
    console.error('사용: node staticScan.mjs <프로젝트 경로> [--json]');
    process.exit(64);
  }
  const result = await scanProject(root);
  const blockers = result.findings.filter((f) => f.severity === 'blocker');
  if (json) {
    console.log(JSON.stringify({ ...result, blockerCount: blockers.length }, null, 2));
  } else {
    for (const f of result.findings) {
      console.log(`[${f.severity}] ${f.file}:${f.line} ${f.rule} — ${f.message}`);
    }
    console.log(`\n스캔 ${result.scannedFiles}개 파일 — blocker ${blockers.length}건, warn ${result.findings.length - blockers.length}건`);
  }
  process.exit(blockers.length > 0 ? 1 : 0);
}
