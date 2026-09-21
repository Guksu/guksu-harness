# 팀 스캐폴딩 2단계 — 템플릿 3-way 병합, CI 검사 워크플로

| 항목 | 내용 |
|---|---|
| 날짜 | 2026-09-21 |
| 브랜치 | claude/focused-planck-898vo6 |
| PR | 미생성 |
| 기준 | origin/main의 3601735 (v4.0.0) |
| 버전 | 4.1.0 |

## 1. 개요

팀이 고친 문서 템플릿이 코어 업데이트를 계속 받도록 3-way 병합을 넣고, `init --ci`로 PR마다 검사하는 GitHub Actions 워크플로를 뼈대에 추가했다. 구조 검사 error 0, 테스트 139개 통과. 실제 GitHub Actions 실행과 npm 배포는 하지 않았다.

## 2. 작업 내용

- `skills/harness/scripts/harnessManager.mjs` — 템플릿을 공동 파일로 처리. 원본 사본 `.agents/harness-base/`, `mergeThreeWay()`(git merge-file), 계획 동작 `merge`·`preserve`(사본 없음), 충돌 시 사본 미갱신, 제거 때 사본 삭제, 복원 대상에 사본 포함. `--ci` 옵션으로 워크플로를 프로젝트 파일로 생성. `status`에 `customized` 상태와 `base` 유무.
- `bin/guksu-harness.mjs` — `init`·`update`에 `--ci`. 충돌 안내 문구에 템플릿 경우 추가. 다음 할 일에 사본 커밋 안내.
- `skills/harness/assets/harness-check.yml` — 워크플로 자산. `npx --yes guksu-harness@4 check .`.
- 테스트 — 병합 성공·충돌·사본 없는 설치본·제거·복원·`--ci` 1회 생성·명령 흐름 8건 추가.
- 문서 — README(양식 병합·`--ci`), `installation.md`(병합 규칙 표·CI 절·소유권 표), harness SKILL.md, `.gitignore` 주석, CHANGELOG 4.1.0, 설계서 상태.

## 3. 검증 결과

| 검증 | 명령 | 결과 |
|---|---|---|
| 구조 검사 | `npm run check` | error 0 · warn 0 |
| 전체 테스트 | `npm test` | 139 통과 · 실패 0 |
| 병합 시나리오 | 번들 템플릿을 임시로 바꿔 새 버전을 흉내 낸 테스트 | 다른 곳 수정은 합침, 같은 곳 수정은 충돌, 사본 없는 설치본은 보존 후 다음부터 병합 |
| 실제 GitHub Actions | — | 미실행. 워크플로는 npm 배포 후에만 동작 |

## 4. 확인 필요 · 후속

- npm 배포 후 `--ci` 워크플로가 실제 PR에서 도는지 확인한다. 배포 전에는 `npx --yes guksu-harness@4`를 찾지 못해 실패한다.
- 3단계: 팀 커스텀 가이드, 프로젝트 하네스 묶음 내보내기/가져오기.

## 5. 주의사항

- `.agents/harness-base/`는 커밋한다. 팀원마다 사본이 다르면 병합 결과가 달라진다.
- 병합에는 git이 필요하다. 없으면 충돌로 표시하고 파일을 보존한다.
- 4.0 설치본은 첫 업데이트에서 사본만 등록한다. 그 업데이트의 템플릿 변경분은 팀 수정본에 반영되지 않는다(다음 업데이트부터 반영).
