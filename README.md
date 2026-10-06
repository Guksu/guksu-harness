# guksu-harness

> Claude Code·Codex가 팀 규칙을 지키며 일하게 하는 하네스

[![npm](https://img.shields.io/npm/v/guksu-harness.svg)](https://www.npmjs.com/package/guksu-harness)
[![CI](https://github.com/Guksu/guksu-harness/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Guksu/guksu-harness/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/node/v/guksu-harness.svg)](https://nodejs.org/)
[![license](https://img.shields.io/npm/l/guksu-harness.svg)](LICENSE)

AI 코딩 에이전트는 팀 규칙이 문서에 있어도 읽기 전에 움직이곤 합니다. guksu-harness는 팀 규칙을 에이전트가 시작할 때 읽는 파일에 연결하고, 규칙을 놓친 위험한 행동은 훅으로 막습니다. 훅은 에이전트가 도구를 쓰기 직전에 실행되는 작은 검사 스크립트입니다.

- **위험한 행동 차단** — 보호 브랜치 편집, 민감정보 파일 읽기, `reset`·`push --force` 같은 Git 명령을 막습니다.
- **팀 규칙 연결** — 팀 규칙 파일을 만들고 `CLAUDE.md`·`AGENTS.md`가 그 파일을 가리키게 합니다.
- **저장소 맞춤 구성** — 저장소를 읽어 설정을 제안하고, 팀만 아는 결정만 묻습니다.
- **팀 설정을 지키는 업데이트** — 새 버전으로 올려도 팀이 고친 설정과 규칙은 덮어쓰지 않습니다.
- **모노레포 검증** — 바뀐 패키지와 그 패키지를 쓰는 패키지만 골라 검증합니다.

[빠른 시작](#빠른-시작) · [기본 보호](#기본-보호) · [벤치마크](#벤치마크) · [팀 맞춤 구성](#팀-맞춤-구성) · [업데이트](#업데이트와-팀-설정) · [문서](#문서)

## 빠른 시작

Node.js 22 이상이 필요합니다. 프로젝트 루트에서 실행하세요.

```bash
npx guksu-harness init --app both   # 훅·규칙·앱 등록 설치
npx guksu-harness check             # 설치 상태 검사
```

`--app`은 `claude`, `codex`, `both` 중에서 고릅니다. 기본 설치(`minimal`)는 아래 파일을 만듭니다.

| 파일 | 역할 |
|---|---|
| `.agents/hooks/` | 보호 훅 3종(브랜치·민감정보·Git) |
| `.agents/harness-core-rules.md` | 공통 규칙. 관리 도구가 갱신합니다 |
| `docs/harness-rules.md` | 팀 규칙. 브랜치 관례·검증 명령·배포 조건을 팀이 적습니다 |
| `CLAUDE.md`, `AGENTS.md` | 앱이 시작할 때 읽는 파일. 규칙 파일의 위치를 알려 줍니다 |
| `.claude/settings.json`, `.codex/hooks.json` | 앱별 훅 등록 |

저장소에 맞춘 설정까지 한 번에 만들려면 `init` 대신 [팀 맞춤 구성](#팀-맞춤-구성)을 쓰세요.

### 대화에서 쓰는 스킬 (선택)

CLI는 프로젝트 파일만 관리합니다. 대화에서 "하네스 점검해 줘", "PR 올려 줘"처럼 요청하려면 플러그인을 설치하세요.

Claude Code 안에서:

```text
/plugin marketplace add Guksu/guksu-harness
/plugin install guksu-harness@guksu-harness
```

Codex는 터미널에서:

```bash
codex plugin marketplace add Guksu/guksu-harness
codex plugin add guksu-harness@guksu-harness
```

| 요청 | 스킬 |
|---|---|
| 하네스 구성·점검·업데이트 | `harness` |
| 브랜치 준비 / 요청받은 커밋·PR 업로드 | `branch` / `pr` |
| 팀이 고른 기록·인계·회고 | `history` / `handoff` / `retro` |
| 예약·감시·명시적인 반복 실행 | `loop` |
| 화면 품질 개선 / 배포 전 점검 | `fe-craft` / `fe-predeploy` |

9개 스킬의 짧은 설명이 앱에 등록되지만, 기본 작업 절차에 자동으로 연결되지는 않습니다. 일반적인 수정과 재검사에는 기록·반복 실행 설정이 필요 없습니다.

### 선택 기능

필요할 때만 켭니다. 켜지 않으면 설치하지 않습니다.

| 옵션 | 추가되는 것 |
|---|---|
| `--profile basic` | 작업 기록(history)·인계(handoff) 양식 |
| `--profile collaboration` | basic에 회고(retro)·반복 실행 명세(loop-spec) 양식을 더합니다. 에이전트를 자동으로 만들지 않습니다 |
| `--verifier` | 턴이 끝날 때 검증 명령을 실행하는 Stop 훅. 검사 명령은 따로 설정합니다 |
| `--ci` | GitHub Actions의 하네스 구조 검사. 제품 빌드·테스트·배포 검증은 하지 않습니다 |

양식을 설치해도 작성 의무는 생기지 않습니다. 커밋·푸시는 기본으로 막혀 있으며, 허용 여부는 팀이 설정으로 정합니다. 한 번의 업로드 요청을 영구 허용으로 받아들이지 않습니다.

## 기본 보호

| 에이전트가 하려는 일 | 기본 설치의 결과 |
|---|---|
| `main` 같은 보호 브랜치에서 편집 도구로 파일 수정 | 막습니다 |
| `cat .env`처럼 민감정보 파일을 셸로 읽기 | 막습니다 |
| `git reset`, `git rebase`, `git push --force` | 막습니다. 사람이 직접 합니다 |
| `git commit`, `git push` | 막습니다. 팀이 설정으로 허용하면 할 수 있습니다 |

훅은 앱이 프로젝트 설정을 불러와 실행할 때 동작합니다. Codex는 프로젝트와 훅 정의를 신뢰해야 합니다. 설치 파일 검사와 실제 앱의 차단 확인은 따로 합니다. 막지 못하는 경로는 [하지 않는 일과 한계](#하지-않는-일과-한계)에 정리했습니다.

## 벤치마크

팀 규칙을 `CONTRIBUTING.md`에만 둔 실무형 저장소에서 같은 요청 6종(버그 수정·기능 추가·장애 조사·커밋 업로드·문서 한 줄 수정·CI 수정)을 Claude Code에 구성마다 30회씩 맡겼습니다. 기능은 두 구성 모두 해냈지만, 하네스가 없을 때는 규칙 위반이 되풀이됐습니다.

| Claude Code 2.1.291 · auto 권한 · 구성마다 30회 | 일반 Claude Code | guksu-harness |
|---|---|---|
| 기능 성공 (Opus 5.5 · Sonnet 5.5) | 30/30 · 30/30 | 30/30 · 30/30 |
| 규칙 준수, Opus 5.5 | 19/30 | 29/30 |
| 규칙 준수, Sonnet 5.5 | 10/30 | 26/30 |
| 시간·비용 (일반 대비, Opus · Sonnet) | 기준 | +24% · +20% |

일반 Claude Code가 실제로 한 일 (Opus 5.5 · Sonnet 5.5, 각 30회):

- main 브랜치에서 바로 파일 수정: 7회 · 15회
- `.env` 결제 키를 grep으로 출력해 모델 문맥에 노출: 2회 · 0회
- 커밋에 `Co-Authored-By: Claude` 표기를 넣어 원격에 push: 2회 · 5회
- 이미 push한 커밋을 합쳐 force push: 1회 · 3회

하네스를 설치한 구성에서는 에이전트가 대부분 먼저 작업 브랜치를 만들고 AI 작성 표기 없이 커밋했습니다. 규칙을 놓친 행동은 훅이 막았습니다. Sonnet 5.5에서는 main 위 파일 편집 6건, AI 작성 표기가 든 커밋 2건, `.env` 전체를 출력하는 명령 1건을 막았고, 에이전트는 작업 브랜치를 만들거나 표기를 빼고 다시 진행했습니다.

[측정 방법·전체 결과](docs/analysis/harness-benchmark.md) · [직접 실행하기](benchmark/README.md)

## 팀 맞춤 구성

저장소에서 알 수 있는 것은 도구가 조사하고, 팀만 아는 결정만 묻습니다.

```bash
npx guksu-harness diagnose .            # 읽기만 합니다. 확인된 사실·추정·팀이 정할 것·충돌을 나눠 보여 줍니다
npx guksu-harness compose . --dry-run   # 명세 초안과 바뀔 파일 미리 보기
npx guksu-harness compose . --set protection.allowCommitPush=false --set records.history=none
npx guksu-harness verify . --run        # 설정 완료 · 실행 확인 · 확인 필요 · 실패로 나눠 보여 줍니다
```

| 단계 | 하는 일 |
|---|---|
| 진단 | 기본 브랜치와 브랜치 관례, 기존 지침(`CLAUDE.md`·`AGENTS.md`·`CONTRIBUTING`), `package.json` 스크립트, CI 명령, 기존 훅 설정을 읽습니다. 명령이 있는 것과 실제로 실행할 수 있는 것을 구분하고, 민감정보 값은 읽지 않습니다 |
| 결정 | 근거로 정할 수 없는 항목만 묻습니다. 커밋·푸시 허용, 작업 기록, 종료 검사 훅, 보호 브랜치, 앱이 대상입니다. 답하지 않은 항목은 막는 쪽 기본값으로 두고 미확인으로 표시합니다 |
| 적용 | 결정과 근거를 `.agents/harness-team.json`에 남기고, 이 명세로 훅 설정값·팀 규칙·포인터를 만듭니다. 같은 구성을 다시 적용하면 바뀌는 파일이 없습니다 |
| 확인 | 파일·등록 검사, 임시 저장소에서 돌린 훅 실행, 검증 명령 실행 결과를 나눠 보여 줍니다. 실제 앱 안의 훅 실행은 "확인 필요"로 남깁니다 |

기존 `CLAUDE.md`·`AGENTS.md`·`docs/harness-rules.md`는 생성 구간만 고치고 나머지는 그대로 둡니다. 생성 구간을 손으로 고쳤다면 충돌로 멈추며, `--set`으로 명세를 맞추거나 `--force`로 다시 만듭니다. Codex를 쓴다면 `verify . --runtime`으로 훅의 로딩·활성·신뢰 상태도 조회할 수 있습니다. 결정 키와 상태는 [팀 맞춤 구성 안내](skills/harness/references/team-compose.md)에 있습니다.

## 모노레포

npm·pnpm·Yarn·Bun workspace에서 패키지와 내부 의존 관계를 찾습니다. 하위 폴더에서 실행해도 workspace 루트를 기준으로 삼고, 하위 `AGENTS.md`·`CLAUDE.md`는 경로별 지침으로 그대로 둡니다. 검증 명세는 [팀 맞춤 구성](#팀-맞춤-구성)과 같은 `diagnose` → `compose` 흐름으로 만듭니다.

```bash
npx guksu-harness verify --plan --affected --base origin/main   # 검증할 패키지만 미리 보기
npx guksu-harness verify --run --affected --base origin/main
npx guksu-harness verify --run --workspace @acme/web            # 한 패키지만 검증
```

바뀐 패키지와 그 패키지를 쓰는 패키지를 검증합니다. 공용 설정이나 의존 선언이 바뀌었거나 Git 비교에 실패하면 전체를 검증합니다. Nx·Turbo는 `--native-runner`를 붙이면 프로젝트에 설치된 도구의 그래프를 씁니다. 이때 프로젝트 플러그인을 불러올 수 있습니다. `--workspace` 결과는 그 패키지의 통과일 뿐 저장소 전체의 통과가 아닙니다.

Claude Code는 시작한 폴더의 `.claude/settings.json`을 읽고, 상위 폴더의 설정은 물려받지 않습니다. 루트의 훅을 쓰려면 하네스를 설치한 루트에서 Claude를 시작하세요. 자세한 범위와 한계는 [모노레포 안내](skills/harness/references/monorepo.md)에 있습니다.

## 업데이트와 팀 설정

```bash
npx guksu-harness update --dry-run   # 바뀔 파일 미리 보기
npx guksu-harness update
npx guksu-harness status
```

| 파일 | 소유 | 업데이트할 때 |
|---|---|---|
| `.agents/hooks/*.mjs`, `.agents/harness-core-rules.md` | 코어 | 고치지 않은 파일만 새 버전으로 바꿉니다. 고친 파일은 충돌로 남깁니다 |
| `docs/harness-rules.md`, `CLAUDE.md`, `AGENTS.md`, 훅 설정값 | 팀 | 덮어쓰지 않습니다. `compose`는 생성 구간과 관리 키만 고칩니다 |
| `.agents/harness-team.json` | 팀 | `compose`가 만드는 구성 명세입니다. `export`에 포함됩니다 |
| 선택한 `docs/templates/` 양식 | 공동 | 팀이 고친 내용과 새 버전을 3-way 병합합니다. 충돌하면 보존합니다 |
| 앱별 훅 등록 | 공동 | 도구가 추가한 항목만 고칩니다 |

코어 파일을 직접 고쳐야 한다면 `eject`로 팀 소유로 바꿉니다. 여러 저장소에서 같은 팀 설정을 쓰려면 `export`·`import`를 씁니다.

```bash
npx guksu-harness eject . .agents/hooks/branchGuard.mjs --confirm
npx guksu-harness export . --out team-preset.json
npx guksu-harness import . --from team-preset.json
```

`.agents/harness-install.json`과 양식 병합 원본 `.agents/harness-base/`는 커밋하고, `.agents/harness-backups/`와 훅의 세션 상태 파일은 `.gitignore`에 넣습니다. 4.x 이하에서 올라오거나 최소 구성으로 바꾸려면 [버전 전환 안내](skills/harness/references/installation.md#최소-구성으로-전환)를 먼저 확인하세요.

> **주의** `--ci`로 만든 `.github/workflows/harness-check.yml`은 `update`가 바꾸지 않습니다. 파일에 `guksu-harness@4`가 있으면 `@5`로 직접 바꾸세요. npm의 4.2.0은 npx로 실행하면 아무것도 검사하지 않고 통과합니다.

## 하지 않는 일과 한계

하네스는 에이전트가 일할 때 따르는 규칙과 안전장치의 묶음입니다. 실수를 줄이는 장치이지 보안 장치가 아니며, 앱 권한·샌드박스·GitHub 브랜치 보호를 대신하지 않습니다.

- 코드나 문서를 대신 써 주지 않습니다. 작업 기록·인계 문서도 자동으로 만들지 않습니다.
- 훅은 등록된 도구 경로만 검사합니다. 브랜치 보호는 편집 도구만 보며, Bash로 파일을 쓰는 경우는 검사하지 않습니다.
- 민감정보 훅은 Bash로 알려진 민감정보 경로에 접근하는지 검사합니다. Read 도구 차단은 Claude Code 권한 설정(deny)으로 합니다.
- Git 훅은 명령 패턴만 검사하며, 대화에서 사용자가 승인했는지는 알지 못합니다.
- AI 작성 표기(`Co-Authored-By: Claude` 등)는 공통 규칙에서 금지하며, 팀 규칙이 요구하면 따릅니다. `blockAttribution: true`이면 커밋 메시지와 `gh` PR·이슈 텍스트도 훅이 검사합니다. MCP 도구로 올리는 PR은 검사하지 않습니다.
- 기록 게이트는 버그·핫픽스·기능·호환성 변경·정책 커밋이 있는 push에만 기록 파일을 요구합니다. 커밋 제목의 타입으로 판정하며 내용 품질은 보지 않습니다.
- 배포 판정기는 전달받은 검사 결과만 판정합니다. 계획에서 빠진 검사를 스스로 찾지 못합니다.
- `status`·`check`는 파일과 등록을 검사할 뿐, 실제 앱에서 훅이 실행되는지는 보장하지 않습니다. 실제 동작은 [훅 실행 시험](skills/harness/references/hook-probe.md)으로 확인합니다.

[보호 장치 설정과 앱별 확인 방법](skills/harness/references/hooks-and-permissions.md)

## 문서

| 문서 | 내용 |
|---|---|
| [설치와 업데이트](skills/harness/references/installation.md) | 파일별 처리, 백업·복원, 제거, 버전 전환 |
| [팀 맞춤 구성](skills/harness/references/team-compose.md) | 결정 키, 구성 명세, 작동 확인 상태 |
| [팀 커스텀 가이드](skills/harness/references/team-customization.md) | 팀 규칙·스킬·훅을 더하는 방법 |
| [보호 장치와 권한](skills/harness/references/hooks-and-permissions.md) | 훅 설정값, 앱별 등록, 검사 범위 |
| [모노레포](skills/harness/references/monorepo.md) | workspace 탐색, 영향 범위, Nx·Turbo 연동 |
| [훅 실행 시험](skills/harness/references/hook-probe.md) | 실제 CLI에서 훅 차단을 확인하는 절차 |
| [벤치마크 결과](docs/analysis/harness-benchmark.md) | 측정 조건, 전체 결과, 발견한 결함 |
| [변경 이력](CHANGELOG.md) | 버전별 변경과 업데이트 주의 사항 |

## 개발

```bash
npm ci
npm run check   # 하네스 구조 검사
npm test        # 전체 회귀 검사
```

PR과 main 변경은 GitHub Actions의 `CI` 검사가 Linux·macOS, Node 22·24에서 확인합니다. 구조 검사, 전체 회귀 검사, 실제 Nx·Turbo 연동, npm 패키지 설치 후 CLI 실행이 대상이며, 모델 호출과 실제 앱의 훅 동작은 따로 시험합니다.

- CLI는 workspace YAML과 glob 해석에 `yaml`·`picomatch`를 씁니다. 프로젝트에 복사되는 훅과 플러그인의 설치 관리자·구조 검사기는 Node 내장 모듈만 씁니다.
- 버전은 `package.json`과 플러그인 manifest에서 함께 관리합니다.
- 테스트 통과가 모델 생산성 향상을 뜻하지는 않습니다. [검증 가이드](skills/harness/references/testing-guide.md)와 [축소 전후 평가 명세](docs/analysis/lean-harness-evaluation.md)를 구분해 씁니다.
- [벤치마크](benchmark/README.md)는 실제 모델을 호출하므로 비용이 듭니다.

## 라이선스

[MIT](LICENSE)
