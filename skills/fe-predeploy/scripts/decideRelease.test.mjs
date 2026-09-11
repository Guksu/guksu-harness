import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideRelease } from './decideRelease.mjs';
const build = { name: 'build', status: 'pass', severity: 'blocker' };
const browser = { name: 'browser', status: 'skip', severity: 'blocker', reason: '도구 없음' };
test('필수 브라우저 검사가 빠지면 정적 검사 통과만으로 배포 가능 판정을 내리지 않는다', () => {
  assert.equal(decideRelease({ checks: [build, browser] }).verdict, '판정 보류');
});
test('알려진 차단 실패는 미검증 항목보다 우선한다', () => {
  assert.equal(decideRelease({ checks: [{ ...build, status: 'fail' }, browser] }).verdict, '배포 불가');
});
test('해당 없음은 사유가 있을 때 제외하고 필수 검사가 통과해야 한다', () => {
  assert.equal(decideRelease({ checks: [build, { ...browser, applicable: false }] }).verdict, '배포 가능');
  assert.equal(decideRelease({ checks: [{ ...browser, applicable: false }] }).verdict, '판정 보류');
});
test('빈 결과·선택 검사만의 통과는 보류, 사유 없는 skip은 오류다', () => {
  assert.equal(decideRelease({ checks: [] }).verdict, '판정 보류');
  assert.equal(decideRelease({ checks: [{ ...build, severity: 'warn' }] }).verdict, '판정 보류');
  assert.throws(() => decideRelease({ checks: [{ ...browser, reason: '' }] }));
});
