# 팀 스캐폴딩 1단계 — npm 명령, 파일 소유권, 규칙 파일 분리

| 항목 | 내용 |
|---|---|
| 날짜 | 2026-09-21 |
| 브랜치 | claude/focused-planck-898vo6 |
| PR | https://github.com/Guksu/guksu-harness/pull/21 |
| 기준 | origin/main의 3d8f8b4 (v3.0.0) |
| 버전 | 4.0.0 |

## 1. 개요

`npx guksu-harness init`으로 뼈대를 만들고 `update`로 코어만 갱신하는 스캐폴딩 1단계를 구현했다. 구조 검사 error 0, 테스트 131개 통과. npm 배포와 실제 앱 안 훅 실행은 하지 않았다.

배경: 설계 문답(`docs/design/2026-09-21-scaffold.md`)에서 "코어·프로젝트 두 계층, 코어는 확장만, 코어 규칙은 플러그인 소유, npm 명령 + 플러그인 스킬 두 진입점, 4.0.0"을 결정했다.

## 2. 작업 내용

- `bin/guksu-harness.mjs`, `bin/guksu-harness.test.mjs`, `package.json` — `init`·`update`·`status`·`check`·`eject` 명령. 관리 로직은 기존 `harnessManager.mjs`를 호출한다. `files`에서 테스트 파일은 제외.
- `skills/harness/scripts/harnessManager.mjs` — 소유권 모델. 코어 규칙 사본 `.agents/harness-core-rules.md`를 추적 대상에 추가하고, 프로젝트 파일(`docs/harness-rules.md`, `CLAUDE.md`, `AGENTS.md`)은 없을 때만 생성. `ejected` 기록과 `eject()` 추가. v3 규칙 파일 전환(원본이면 교체, 수정본이면 보존 + 안내). `isInstalled`, `corePaths`, `version` 내보내기.
- `skills/harness/assets/harness-team-rules.md`, `pointer.md` — 팀 규칙·규칙 포인터 양식. `harness-rules.md` 머리말을 코어 소유로 고침.
- `skills/harness/scripts/validateHarness.mjs` — 코어 사본·팀 규칙 파일 검사, v3 구조 안내, `package.json` 버전 일치.
- 문서 — README(진입점을 `npx`로, 소유권 표), `installation.md`(명령·소유권 표·eject·v3 전환), `hooks-and-permissions.md`, harness SKILL.md, `agent-design.md`, `orchestrator-template.md`, `testing-guide.md`, CHANGELOG 4.0.0, 설계서 상태.

## 3. 검증 결과

| 검증 | 명령 | 결과 |
|---|---|---|
| 구조 검사 | `npm run check` | error 0 · warn 0 |
| 전체 테스트 | `npm test` | 131 통과 · 실패 0 |
| 명령 실행 | 임시 프로젝트에서 init(dry-run·실제) → 재init 거부 → check → update(변경 없음) → 코어 수정 후 update 충돌 → eject → update 통과 | 통과(테스트로 고정) |
| v3 전환 | v3.0.0 형태 설치본(원본·수정본) 두 가지 | 통과(테스트로 고정) |
| 패키지 내용 | `npm pack --dry-run` | bin·skills·설명 파일 포함, 테스트 파일 제외 |
| npm 배포 | — | 미실행 |

## 4. 확인 필요 · 후속

- 배포 전 `npm view guksu-harness`로 이름이 비어 있는지 확인한다. 있으면 `@guksu/harness`로 바꾼다(package.json `name`과 README 명령).
- 2단계: 문서 템플릿 3-way 병합(`.agents/harness-base/`), `init --ci`.
- 3단계: 팀 커스텀 가이드, 프로젝트 하네스 묶음 내보내기/가져오기.

## 5. 주의사항

- v3에서 `docs/harness-rules.md`를 고친 팀은 `update` 후 파일이 그대로 남는다. `status`가 "코어 규칙 전문이 남아 있다"고 알리면 코어 규칙 7개를 지우고 포인터만 남긴다.
- `eject`는 추적 해제만 한다. 되돌리려면 파일을 지우고 `harness-install.json`의 `ejected` 항목을 제거한 뒤 `update`한다.
- 설계서와 다른 점 하나: v3 규칙 수정본을 충돌이 아닌 보존으로 처리했다(설계서 6절에 기록).
