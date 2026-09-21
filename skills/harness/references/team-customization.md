# 팀 커스텀 가이드 — 뼈대 위에 우리 팀 것을 얹기

이 문서는 하네스를 팀에 맞게 바꾸려는 사람을 위한 안내다. 원칙은 하나다. **뼈대(코어)는 고치지 말고, 팀 것은 팀 자리에 둔다.** 그래야 `npx guksu-harness update`가 코어를 새 버전으로 바꿔도 팀이 만든 것이 그대로 남는다.

## 1. 어디를 고쳐도 되나

| 바꾸고 싶은 것 | 고칠 곳 | 업데이트 때 |
|---|---|---|
| 작업 규칙 추가·변경 | `docs/harness-rules.md` (팀 규칙) | 건드리지 않음 |
| 보호 브랜치, 커밋 허용, 기록 요구 | `.agents/hooks/*.config.json` | 건드리지 않음 |
| 우리 도메인 작업 절차 | 팀 스킬 `.claude/skills/{이름}/` 또는 `.agents/skills/{이름}/` | 건드리지 않음 |
| 우리만의 차단·검사 | 팀 훅 `.agents/hooks/{이름}.mjs` + 앱 등록 파일에 직접 등록 | 건드리지 않음 |
| 작업 기록·인계 양식 | `docs/templates/*.md` | 팀 수정과 새 버전을 합침(3-way 병합) |
| 규칙 포인터 | `CLAUDE.md`·`AGENTS.md` | 건드리지 않음 |
| CI 검사 트리거·노드 버전 | `.github/workflows/harness-check.yml` | 건드리지 않음 |

고치면 안 되는 것: 코어 훅 4종(`.agents/hooks/blockGitMutation.mjs` 등)과 코어 규칙 사본(`.agents/harness-core-rules.md`). 고치면 다음 `update`가 충돌로 멈춘다. 꼭 고쳐야 하면 §6의 `eject`를 쓴다.

## 2. 팀 규칙 쓰기

`docs/harness-rules.md`는 `init`이 한 번 만들고 그 뒤로는 팀 파일이다. 코어 규칙 7개는 `.agents/harness-core-rules.md`에 있고, 팀 규칙이 코어보다 우선한다.

```markdown
## 팀 규칙

1. **커밋 메시지는 한국어 Conventional Commits로 쓴다.** 예: `feat: 로그인 화면 추가`
2. **규칙 3 대신:** 작업 기록은 PR 단위가 아니라 스프린트 단위로 `docs/history/`에 하나만 남긴다.
```

코어 규칙을 바꾸고 싶으면 "규칙 N 대신 …"으로 적는다. 코어 사본을 직접 고치지 않는다. 스킬과 에이전트는 두 파일을 함께 읽는다.

## 3. 훅 설정값

훅 옆 `.agents/hooks/{훅이름}.config.json`이 팀 파일이다. 설정 항목은 `hooks-and-permissions.md`에 있다. 자주 바꾸는 것:

```json
// .agents/hooks/branchGuard.config.json
{ "protectedBranches": ["main", "release"] }

// .agents/hooks/blockGitMutation.config.json
{ "allowCommitPush": true, "requireHistoryDoc": true, "historyBase": "origin/main" }
```

설정 파일에 토큰·비밀번호를 넣지 않는다. 팀 묶음(§7)으로 다른 저장소에 복사되는 파일이다.

## 4. 팀 스킬

프로젝트 스킬 경로에 `{이름}/SKILL.md`를 만든다. Claude Code는 `.claude/skills/`, Codex는 `.agents/skills/`를 읽는다. 두 앱을 함께 쓰면 한쪽에 만들고 다른 쪽에 같은 내용을 복사한다(심볼릭 링크는 Windows에서 깨진다).

이름 규칙: 코어 스킬 9종(`harness`, `branch`, `pr`, `history`, `handoff`, `retro`, `loop`, `fe-craft`, `fe-predeploy`)과 **다른 이름**을 쓴다. 같은 이름이면 앱에 따라 어느 쪽이 불릴지 보장할 수 없다. 코어 스킬의 동작을 바꾸고 싶으면 팀 규칙(§2)에 적는다. 스킬들이 규칙 파일을 읽기 때문에 그것으로 충분한 경우가 대부분이다.

작성법은 `skill-authoring.md`를 따른다. 구조 검사(`npx guksu-harness check`)가 frontmatter와 참조 파일을 확인한다.

## 5. 팀 훅

`.agents/hooks/{이름}.mjs`를 만들고 앱 등록 파일에 직접 항목을 추가한다. 관리 도구는 자기가 넣은 항목만 관리하므로 팀이 넣은 등록은 건드리지 않는다.

입력·출력 계약은 코어 훅과 같다. stdin으로 JSON(`tool_input`, `cwd` 등)을 받고, 차단하려면 stderr에 이유를 쓰고 exit 2로 끝낸다. Claude Code와 Codex의 등록 형식 차이는 `hooks-and-permissions.md` §1에 있다. 코어 훅 파일을 복사해 시작하면 편하지만, 복사본 이름을 코어 이름과 다르게 둔다.

## 6. 코어 파일을 꼭 고쳐야 할 때 — eject

```bash
npx guksu-harness eject .agents/hooks/branchGuard.mjs --confirm
```

그 파일은 팀 소유가 되고 이후 업데이트를 받지 않는다. 코어의 버그 수정도 들어오지 않으므로 마지막 수단으로 쓴다. 되돌리려면 파일을 지우고 `.agents/harness-install.json`의 `ejected`에서 경로를 빼고 `update`를 실행한다.

## 7. 여러 저장소에 같은 팀 설정 쓰기 — export / import

팀 규칙·훅 설정값·팀 훅·팀 스킬·고친 템플릿·CI 워크플로를 한 파일로 묶어 다른 저장소에 옮긴다.

```bash
# 기준 저장소에서
npx guksu-harness export . --out team-preset.json

# 다른 저장소에서 (먼저 init이 되어 있어야 한다)
npx guksu-harness init . --app both
npx guksu-harness import . --from team-preset.json
```

- 묶음에 코어 파일은 들어가지 않는다. 코어는 각 저장소의 `update`가 준다.
- 규칙 포인터(`CLAUDE.md`·`AGENTS.md`)와 작업 기록은 프로젝트 고유라 넣지 않는다.
- 이미 있고 내용이 다른 파일은 건너뛴다. 덮어쓰려면 `--force`. 덮어쓰기 전 내용은 백업에 남는다. `init`이 만든 뒤 손대지 않은 파일(초기 양식 그대로인 팀 규칙·템플릿·CI 워크플로)은 그냥 덮어쓴다.
- 묶음 파일은 허용된 종류의 경로만 쓴다. 코어 훅 이름이나 프로젝트 밖 경로가 들어 있으면 거부한다.
- 묶음 파일을 팀 저장소에 커밋해 두면 새 저장소를 만들 때 `init` + `import` 두 번으로 끝난다.

## 8. 업데이트 순서

1. `npx guksu-harness update --dry-run`으로 무엇이 바뀌는지 본다.
2. 충돌이 있으면 안내대로 정리한다. 코어 파일 충돌은 파일을 지우거나 `eject`, 템플릿 충돌은 직접 합친다.
3. `npx guksu-harness update`로 적용한다.
4. `npx guksu-harness check`가 error 0인지 본다. CI 워크플로가 있으면 PR에서도 같은 검사가 돈다.
5. `.agents/harness-install.json`, `.agents/harness-base/`, 바뀐 코어 파일을 함께 커밋한다.

## 9. 흔한 실수

| 증상 | 원인 | 해결 |
|---|---|---|
| `update`가 충돌로 멈춤 | 코어 훅이나 코어 규칙 사본을 고침 | 고친 내용을 팀 규칙·설정값·팀 훅으로 옮기고 파일을 지운 뒤 `update`. 꼭 필요하면 `eject` |
| 팀 스킬이 안 불림 | 코어 스킬과 같은 이름, 또는 앱이 읽는 경로가 아님 | 이름을 바꾸고 `.claude/skills/`·`.agents/skills/` 중 앱에 맞는 경로에 둠 |
| 팀원마다 템플릿 병합 결과가 다름 | `.agents/harness-base/`를 커밋하지 않음 | 사본 디렉터리를 커밋 |
| `import` 뒤 훅이 안 먹음 | 등록 파일(`.claude/settings.json`·`.codex/hooks.json`)은 묶음에 없음 | `init`이 코어 등록을 만든다. 팀 훅 등록은 직접 추가 |
