# guksu-harness

Claude Code와 Codex의 **팀 설정을 설치하고, 팀 수정본을 보존하며 업데이트하는 도구**입니다. 프로젝트 고유 규칙과 보호 훅을 관리하고, 기록·인계·프론트엔드 점검은 필요할 때 선택합니다.

Node.js 22 이상 · MIT · 버전은 `package.json`과 플러그인 manifest에서 관리합니다.

## 시작하기

```bash
npx guksu-harness init --app both
npx guksu-harness check
```

새 설치의 기본 `minimal`은 공통 훅 3종, 코어·팀 규칙, 앱별 포인터와 등록을 만듭니다. 기록 양식·협업 정의·프론트엔드 절차를 자동 추가하지 않습니다. 팀 고유 브랜치 관례·검증 명령·배포 조건은 `docs/harness-rules.md`에 적습니다.

CLI는 프로젝트 설정 파일을 관리합니다. 대화에서 설정 관리나 선택 기능을 호출하려면 아래의 플러그인도 설치합니다. CLI 설치만으로 앱에 스킬이 등록되지는 않습니다.

| 선택 | 내용 |
|---|---|
| `--profile basic` | history·handoff 양식 추가. 기존 프로필 이름 유지 |
| `--profile collaboration` | basic + retro·loop-spec 양식. 에이전트 자동 생성 없음 |
| `--verifier` | Stop 이벤트 검증 훅 추가. 별도 검사 명령 설정 필요 |
| `--ci` | GitHub Actions에서 하네스 구조 검사. 제품 빌드·테스트·배포 검증은 별도 |

양식 설치는 작성 의무가 아닙니다. 새 minimal 설치는 `requireHistoryDoc: false`를 명시합니다. 커밋·푸시 허용은 기존처럼 기본 false이며 팀이 선택합니다. 단발 업로드 요청을 영구 설정 변경으로 해석하지 않습니다. 앱의 승인·권한과 훅의 지속 정책은 별개입니다.

## 업데이트와 팀 설정

```bash
npx guksu-harness update --dry-run
npx guksu-harness update
npx guksu-harness status
```

| 파일 | 소유와 업데이트 |
|---|---|
| `.agents/hooks/*.mjs`, `.agents/harness-core-rules.md` | 코어. 수정되지 않은 파일만 교체, 수정본은 충돌로 보존 |
| `docs/harness-rules.md`, `CLAUDE.md`, `AGENTS.md`, 훅 설정값 | 팀. 기존 파일은 덮어쓰지 않음 |
| 선택한 `docs/templates/` 양식 | 팀 수정과 새 버전을 3-way 병합. 충돌 시 보존 |
| 앱별 훅 등록 | 도구가 추가한 항목만 관리 |

코어 직접 수정은 `eject`로 팀 소유로 전환합니다. 여러 저장소의 팀 설정은 `export/import`로 공유합니다.

```bash
npx guksu-harness eject . .agents/hooks/branchGuard.mjs --confirm
npx guksu-harness export . --out team-preset.json
npx guksu-harness import . --from team-preset.json
```

`.agents/harness-install.json`과 양식 병합 원본 `.agents/harness-base/`는 커밋합니다. `.agents/harness-backups/`와 훅의 세션 상태 파일은 `.gitignore`에 둡니다.

[팀 커스텀 가이드](skills/harness/references/team-customization.md) · [선택 적용·제거·복원](skills/harness/references/installation.md)

## 기존 설치에서 바뀌는 점

기존 구성을 유지하려면 일반 `update`를 사용합니다. 최소 구성으로 바꾸려면 먼저 변경 목록을 확인합니다:

```bash
npx guksu-harness update --profile minimal --dry-run
npx guksu-harness update --profile minimal
```

- `update`는 기존 basic·collaboration 프로필을 유지합니다. 추적 기록에 프로필이 없으면 기존 basic으로 취급합니다.
- `update --profile minimal`로 선택을 줄일 수 있습니다. 기존 양식은 삭제하지 않고 계속 업데이트하며, 기록과 팀 설정도 보존합니다.
- 기존 `CLAUDE.md`·`AGENTS.md`·팀 규칙은 자동 수정하지 않습니다. 예전 포인터가 기록을 필수로 요구하면 그 지침은 남습니다. 기록을 선택 기능으로 바꾸려면 팀이 해당 지침과 `requireHistoryDoc`을 함께 변경해야 합니다.
- 기존 Git 설정에 `requireHistoryDoc`이 생략돼 있으면 기존의 암묵적 기본값(true)을 유지합니다. 새 minimal 설치만 false를 명시합니다. 기존·수동 훅에는 새 기본 설정을 덮어씌우지 않습니다.
- 스킬 이름은 유지합니다. branch·pr가 history·loop 등을 일괄 호출하지 않습니다.
- 일반 worktree 생성·조회는 허용합니다. 강제 생성·삭제·이동·정리 등은 계속 차단합니다. `commit -F` 등 간접 메시지는 `blockAttribution: true`일 때만 제한하며 amend·fixup·squash는 계속 차단합니다.
- 프로필 변경은 설치할 양식의 선택을 바꿉니다. 기존 기록 의무를 해제하려면 팀 규칙·앱 포인터를 정리하고 `.agents/hooks/blockGitMutation.config.json`의 `requireHistoryDoc`을 false로 설정하세요. 이때 기존 `allowCommitPush` 등 다른 설정은 유지합니다.
- `--ci`로 만든 `.github/workflows/harness-check.yml`은 `update`가 바꾸지 않습니다. 파일 안의 `guksu-harness@4`를 `@5`로 직접 바꾸세요. `@4`는 npm의 4.2.0을 받는데, 4.2.0은 npx로 실행하면 아무 검사도 하지 않고 통과합니다.

## 선택적 대화 스킬

Claude Code:

```text
/plugin marketplace add Guksu/guksu-harness
/plugin install guksu-harness@guksu-harness
```

Codex:

```text
codex plugin marketplace add Guksu/guksu-harness
codex plugin add guksu-harness@guksu-harness
```

| 요청 | 스킬 |
|---|---|
| 하네스 구성·점검·업데이트 | harness |
| 브랜치 준비 / 요청된 업로드 | branch / pr |
| 팀에서 선택한 기록·인계·회고 | history / handoff / retro |
| 예약·감시·명시적인 반복 실행 | loop |
| 요청된 화면 품질 개선 / 배포 점검 | fe-craft / fe-predeploy |

전체 플러그인에는 9개 스킬의 짧은 설명이 등록됩니다. 선택 기능이라는 뜻은 프로젝트 기본 절차에 자동 연결하지 않는다는 뜻이며, 앱의 스킬 카탈로그에서 숨기는 것은 아닙니다. 일반 수정·재검사에는 별도 기록·루프·협업 설정이 필요하지 않습니다.

## 보호와 검증의 범위

훅은 `.agents/hooks/`에, 등록은 Claude Code의 `.claude/settings.json`과 Codex의 `.codex/hooks.json`에 둡니다. 등록된 도구 경로만 검사하며 앱 권한·샌드박스·저장소 보호를 대신하지 않습니다.

- 브랜치 보호는 편집 도구 대상이며 Bash 파일 쓰기는 검사하지 않습니다.
- 민감정보 훅은 알려진 경로의 Bash 접근을 검사합니다. Read deny는 Claude Code 설정입니다.
- Git 훅은 명령 패턴을 검사하며 대화의 승인 여부를 알지 못합니다.
- 기록 게이트는 파일 변경 여부를 확인하며 내용 품질은 평가하지 않습니다.
- 배포 판정기는 전달받은 검사 결과를 판정합니다. 계획에서 빠진 검사를 스스로 발견하지 못합니다.
- `status/check`는 실제 앱의 훅 실행을 검증하지 않습니다. 앱 버전별 실행 확인이 필요합니다.

[설정과 앱별 확인 방법](skills/harness/references/hooks-and-permissions.md)

## 개발과 평가

```bash
npm run check
npm test
```

코드·구조 테스트 통과는 모델 생산성 향상의 증거가 아닙니다. [검증 가이드](skills/harness/references/testing-guide.md)와 [축소 전후 평가 명세](docs/analysis/lean-harness-evaluation.md)를 구분해 사용합니다.

[변경 이력](CHANGELOG.md) · [라이선스](LICENSE)
