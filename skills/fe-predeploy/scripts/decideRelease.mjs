#!/usr/bin/env node
// 체크리스트 JSON: { checks: [{name, status: pass|fail|skip, severity: blocker|warn,
// required: boolean, reason?: string, applicable?: false}] }. 필수 여부 기본값은 blocker 기준.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export function decideRelease({ checks }) {
  if (!Array.isArray(checks) || checks.length === 0) return { verdict: '판정 보류', reasons: ['검사 결과 없음'] };
  for (const check of checks) {
    if (!check || typeof check.name !== 'string' || !['pass', 'fail', 'skip'].includes(check.status) ||
        !['blocker', 'warn'].includes(check.severity) ||
        (check.required != null && typeof check.required !== 'boolean') ||
        (check.applicable != null && typeof check.applicable !== 'boolean') ||
        (check.status === 'skip' && (typeof check.reason !== 'string' || !check.reason.trim()))) {
      throw new Error('검사 이름·상태·심각도·skip 사유를 확인하세요');
    }
  }
  const failures = checks.filter(c => c.status === 'fail' && c.severity === 'blocker');
  if (failures.length) return { verdict: '배포 불가', reasons: failures.map(c => c.name) };
  const skipped = checks.filter(c => c.status === 'skip' && c.applicable !== false && (c.required ?? c.severity === 'blocker'));
  if (skipped.length) return { verdict: '판정 보류', reasons: skipped.map(c => `${c.name}: ${c.reason}`) };
  if (!checks.some(c => c.status === 'pass' && (c.required ?? c.severity === 'blocker'))) {
    return { verdict: '판정 보류', reasons: ['통과한 필수 검사 없음'] };
  }
  return { verdict: '배포 가능', reasons: checks.filter(c => c.status !== 'pass').map(c => `${c.name}: ${c.reason ?? c.status}`) };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = decideRelease(JSON.parse(readFileSync(process.argv[2], 'utf8')));
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.verdict === '배포 가능' ? 0 : result.verdict === '배포 불가' ? 1 : 2;
  } catch (error) { console.error(error.message); process.exitCode = 2; }
}
