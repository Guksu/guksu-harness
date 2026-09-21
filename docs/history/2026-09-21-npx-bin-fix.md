# npx 실행 결함 수정 — 심볼릭 링크 경유 실행

| 항목 | 내용 |
|---|---|
| 날짜 | 2026-09-21 |
| 브랜치 | fix/npx-bin-symlink |
| PR | https://github.com/Guksu/guksu-harness/pull/24 |
| 기준 | origin/main의 0e99d37 (v4.2.0) |
| 버전 | 4.2.1 |

## 1. 개요

배포된 4.2.0을 `npx guksu-harness@4 init`으로 실행하면 아무것도 하지 않고 종료 코드 0으로 끝났다. 원인은 명령 파일의 직접 실행 판정이 npx가 쓰는 `node_modules/.bin` 심볼릭 링크 경로와 실제 파일 경로를 문자열로 비교해 어긋난 것이다. 양쪽을 realpath로 맞춰 고쳤다. 4.2.0은 저장소 안에서 `node bin/…`로만 검증해 놓쳤다.

## 2. 작업 내용

- `bin/guksu-harness.mjs` — 직접 실행 판정에 realpath 비교 적용(훅 스크립트와 같은 방식).
- `bin/guksu-harness.test.mjs` — `.bin` 심볼릭 링크 경유로 `--help`·`init`을 실행하는 테스트 추가.
- 버전 4.2.1, CHANGELOG.

## 3. 검증 결과

| 검증 | 명령 | 결과 |
|---|---|---|
| 구조 검사 | `npm run check` | error 0 · warn 0 |
| 전체 테스트 | `npm test` | 144 통과 · 실패 0 |
| 배포본 방식 | `npm pack` → 임시 프로젝트에 설치 → `node_modules/.bin/guksu-harness init . --app both --ci` → `check` | 훅 3종 생성, error 0 |
| 레지스트리 4.2.0 재현 | 저장소 밖에서 `npx --yes guksu-harness@4 init` | 출력 없이 exit 0, 파일 미생성 (결함 확인) |

## 4. 확인 필요 · 후속

- 머지 후 4.2.1 배포. 배포 뒤 저장소 밖 디렉터리에서 `npx --yes guksu-harness@4 --help`가 사용법을 출력하는지 확인한다.
- 앞으로 배포 전 검증에 "pack → 설치 → .bin 실행"을 포함한다(`testing-guide.md`에 반영 예정 없음 — 테스트가 이제 링크 경유를 고정한다).

## 5. 주의사항

- 이 저장소 안에서 `npx guksu-harness`를 실행하면 npx가 로컬 프로젝트(같은 이름)를 우선해 "not found"가 난다. 배포본 확인은 저장소 밖에서 한다.
