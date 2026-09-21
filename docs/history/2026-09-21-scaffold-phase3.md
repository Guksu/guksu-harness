# 팀 스캐폴딩 3단계 — 팀 커스텀 가이드, 팀 묶음 export/import

| 항목 | 내용 |
|---|---|
| 날짜 | 2026-09-21 |
| 브랜치 | feat/scaffold-phase3 |
| PR | 미생성 |
| 기준 | origin/main의 293b4e4 (v4.1.0) |
| 버전 | 4.2.0 |

## 1. 개요

스캐폴딩 설계(`docs/design/2026-09-21-scaffold.md`)의 마지막 단계다. 팀이 뼈대 위에 무엇을 어디에 두는지 안내하는 가이드를 쓰고, 팀 설정 묶음을 다른 저장소로 옮기는 `export`/`import` 명령을 넣었다. 구조 검사 error 0, 테스트 143개 통과. npm 배포는 하지 않았다.

## 2. 작업 내용

- `skills/harness/references/team-customization.md` — 팀 커스텀 가이드(9절). README·SKILL.md에서 링크.
- `skills/harness/scripts/harnessManager.mjs` — `exportPreset()`·`importPreset()`. 팀 소유·수정 파일만 담는 규칙(`presetRules`), 템플릿은 사본·번들과 다를 때만, 상태 파일 제외. import는 허용 종류 경로만 쓰고 기존 파일은 `--force` 없이는 건너뜀, 백업 생성, 실패 시 되돌림. `rollback`이 묶음 백업도 복원.
- `bin/guksu-harness.mjs` — `export --out`, `import --from [--force]`. import는 설치된 프로젝트에서만.
- 테스트 4건 추가(관리자 3, 명령 1).
- 문서 — README, `installation.md`(팀 묶음 절), harness SKILL.md, CHANGELOG 4.2.0, 설계서 상태(3단계 완료, 프리셋 계층은 묶음으로 대체).

## 3. 검증 결과

| 검증 | 명령 | 결과 |
|---|---|---|
| 구조 검사 | `npm run check` | error 0 · warn 0 |
| 전체 테스트 | `npm test` | 143 통과 · 실패 0 |
| export/import | 두 임시 프로젝트 사이 왕복, 거부 경로 5종, force·복원 | 통과(테스트로 고정) |
| npm 배포 | — | 미실행 |

## 4. 확인 필요 · 후속

- npm 배포(`npm view guksu-harness`로 이름 확인 후 `npm publish`). 배포 뒤 `--ci` 워크플로와 `npx` 명령을 실제 저장소에서 한 번 확인한다.
- 실제 팀 도입 후 피드백으로 가이드를 고친다. 여러 저장소 자동 갱신은 요구가 나오면 설계 문답을 다시 연다.

## 5. 주의사항

- 묶음 파일에는 훅 설정값이 그대로 들어간다. 비밀이 없는지 확인한 뒤 공유한다.
- 팀 훅의 앱 등록은 묶음에 없다. import 후 직접 등록한다.
- 가져온 템플릿은 다음 `update`에서 병합 대상이 된다.
