# 팀 맞춤 구성 — 진단 → 결정 → 명세 → 적용 → 작동 확인

"우리 저장소를 분석하고, 우리 팀이 Claude Code와 Codex로 일할 때 필요한 하네스를 구성해줘" 요청을 처리하는 흐름이다. 저장소에서 알 수 있는 것은 도구가 조사하고, 팀만 아는 결정만 묻는다. 설계와 인수 시나리오는 `docs/design/2026-09-26-team-compose.md`에 있다.

```bash
npx guksu-harness diagnose <프로젝트> [--json]        # 읽기만. 사실·추정·팀이 정할 것·충돌·검증 명령 후보
npx guksu-harness compose  <프로젝트> --dry-run        # 명세 초안과 변경 미리보기. 파일을 바꾸지 않는다
npx guksu-harness compose  <프로젝트> --set 키=값 ...  # 결정 반영 → 명세 저장 → 설정·규칙·포인터·훅 생성 → 구조 검사
npx guksu-harness verify   <프로젝트> [--run]          # 설정 완료 / 실행 확인 / 확인 필요 / 실패
```

## 1. 대화에서 진행하는 방법

1. `diagnose --json`을 실행하고 결과를 그대로 근거로 쓴다. 사실은 근거 파일·명령과 함께, 추정은 추정이라고, 충돌은 양쪽 출처와 함께 보여 준다. 민감정보 값은 읽지 않는다.
2. `questions` 배열에 있는 항목만 묻는다. 각 항목의 `question`·`options[].impact`(또는 `impact`)를 그대로 쓰고, 한 번에 묶어서 묻는다. 저장소 근거(`evidence`)나 이전 팀 확정(`confirmed`)으로 정해진 항목은 다시 묻지 않는다. 사용자가 "추천대로", "기본값으로"라고 하면 그대로 진행한다.
3. 답을 `compose --set 키=값`으로 넘긴다. 답을 여러 개 받았으면 `--set`을 반복하거나 `--decisions 답.json`({"키": 값})을 쓴다. 먼저 `--dry-run`으로 변경 목록을 보여 주고, 사용자가 이미 적용을 요청했으면 바로 적용한다.
4. 답하지 않은 항목은 차단·최소 기본값으로 적용되고 명세와 규칙 문서에 "미확인"으로 남는다. 커밋·푸시 허용처럼 권한을 넓히는 값은 답 없이 켜지지 않는다. 기존 파일이 허용이고 지침이 금지하면 값을 바꾸지 않고 충돌로 보인다.
5. `verify`(가능하면 `--run`)를 실행하고 네 상태를 구분해 보고한다. 훅 스크립트 시험은 앱 통합의 증거가 아니다. "확인 필요"의 절차를 사용자에게 그대로 전달한다.
6. 보고에는 적용한 정책과 근거, 변경한 파일, 검증 결과, 남은 확인 항목(미확인 결정·앱 안 실행·실행하지 못한 명령)을 넣는다.

## 2. 결정 키

| 키 | 값 | 저장소 근거로 정해지는 경우 | 묻는 경우 (답 없을 때 기본값) |
|---|---|---|---|
| `apps` | `claude`, `codex`, `both` | `.claude/`·`CLAUDE.md`, `.codex/`·`AGENTS.md`·`.agents/skills/`, 설치 기록 | 단서 없음 (claude) |
| `rules.baseBranch` | 브랜치 이름 | `origin/HEAD`, 로컬 `main`·`master` | `develop`·`dev`도 있을 때 (origin/HEAD 또는 main) |
| `protection.protectedBranches` | 브랜치 목록 | 기존 `branchGuard.config.json`; 기준 브랜치 | 기존 설정에 기준 브랜치가 없거나 장수 브랜치(develop·release·staging·production)가 더 있을 때 (기준 브랜치 포함) |
| `protection.allowCommitPush` | true / false | 기존 `blockGitMutation.config.json`; 지침의 커밋·푸시 금지 문장 | 근거 없음 또는 지침과 설정 충돌 (false. 충돌이면 기존 파일 값 유지) |
| `protection.blockAttribution` | true / false | 기존 설정 | 커밋 허용일 때 (false) |
| `verification.checks` | 명령 목록 | `package.json` scripts(test·lint·typecheck·check·build), CI `run:` 단계, Makefile. 자리표시자와 CI가 부르는데 없는 스크립트는 제외 | 후보 없음 (빈 목록) |
| `verification.gate` | rules / stop-hook | 기존 `verifierGate.config.json`(stop-hook); 명령 없음(rules) | 검증 명령이 있을 때 (rules) |
| `records.history` | none / optional / required | 기존 `requireHistoryDoc`(생략은 암묵적 true), 설치된 basic·collaboration 프로필(optional), 지침의 기록 의무 문장(required) | 근거 없음 (none). `docs/history/`에 기록이 있으면 optional을 기본으로 묻는다 |

`rules.guidance`(따라야 할 기존 지침 파일)와 `rules.branchPrefixes`(브랜치 접두어)는 묻지 않고 저장소에서 읽는다. 접두어는 지침 문장 → 기존 브랜치 이름 → 기본값(`feat/ fix/ refactor/ docs/`) 순서로 정하고 출처를 표시한다.

`--set` 값 형식: 불리언은 `true`/`false`, 목록은 쉼표(`main,release`) 또는 JSON 배열, 검증 명령은 JSON 배열(`'["npm test","npm run lint"]'`) 또는 명령 하나, 없음은 `[]`. 앱은 `claude`·`codex`·`both`.

## 3. 결정 상태

| 상태 | 뜻 | 다음 진단에서 |
|---|---|---|
| `confirmed` | 팀이 `--set`으로 답함 | 유지한다 |
| `evidence` | 저장소 근거(파일·명령)로 정함 | 저장소가 바뀌면 따라간다 |
| `assumed` | 추정. 팀이 바꿀 수 있음 | 저장소가 바뀌면 따라간다 |
| `pending` | 미확인. 안전한 기본값 적용 | 계속 질문에 나온다 |

compose가 만든 파일은 다음 진단의 근거가 되지 않는다. 기록된 해시와 같은 파일에서 나온 값은 명세의 상태를 그대로 잇는다. 그래서 같은 구성을 다시 적용하면 변경 0건이고, 미확인은 미확인으로 남는다.

## 4. 명세와 생성 파일

명세 `.agents/harness-team.json`은 팀 소유 파일이다. 커밋하고, `export`/`import` 묶음에도 들어간다.

```json
{
  "schemaVersion": 1,
  "tool": "guksu-harness",
  "composedWith": "5.0.0",
  "decisions": { "protection.allowCommitPush": { "value": false, "status": "confirmed", "basis": "팀 결정 (compose --set)", "evidence": [] } },
  "generated": { ".agents/hooks/branchGuard.config.json": "<sha256>", "docs/harness-rules.md": "<생성 구간 sha256>" }
}
```

| 생성 대상 | 내용 | 규칙 |
|---|---|---|
| `.agents/hooks/branchGuard.config.json` | `protectedBranches` | 기존 파일은 관리 키만 맞추고 다른 키·형식을 보존. 실제 동작이 같으면 바꾸지 않는다. 새 파일은 관리 키를 명시 |
| `.agents/hooks/blockGitMutation.config.json` | `allowCommitPush`, `requireHistoryDoc`, `blockAttribution`(허용일 때), `historyBase`(기준 브랜치를 팀이 확정했을 때만) | 같음 |
| `.agents/hooks/verifierGate.config.json` | `checks`, `maxIterations 10`, `stuckAfter 3` | gate=stop-hook일 때만. 기존 다른 키 보존 |
| `docs/harness-rules.md` | `<!-- guksu-harness:team-policy start/end -->` 구간에 네 영역의 정책·근거·미확인 표시 | 구간 밖은 팀 자리. 파일이 없으면 팀 규칙 양식 뒤에 붙인다 |
| `CLAUDE.md`·`AGENTS.md` | `## 하네스` 절이 없으면 `<!-- guksu-harness:pointer start/end -->` 구간 추가 | 기존 내용 보존. 절이 있으면 그대로 |
| 훅·코어 규칙·등록·양식 | `init`/`update`와 같은 계획 | 프로필은 기존 설치를 유지하고, 팀이 기록을 선택(confirmed)했을 때만 basic으로 올린다 |

적용은 번들 파일과 팀 파일을 한 계획으로 묶어 백업 한 건으로 쓴다. 되돌리기는 `harnessManager.mjs rollback --backup <경로>`다.

## 5. 충돌

| 종류 | 적용 | 해결 |
|---|---|---|
| 생성한 파일·구간을 compose 이후 직접 고침(드리프트) | 막는다 | 그 값을 정하는 키를 `--set`으로 확정하면 받아들이거나 덮어쓴다. `--force`는 명세대로 다시 만든다(백업 남김). 구간 밖 수정은 충돌이 아니다 |
| 훅 설정·명세·설치 기록 JSON이 깨짐 | 막는다 | 파일을 고친다 |
| 명세는 rules인데 `verifierGate.config.json`이 있음 | 막는다 | 파일을 지우거나 stop-hook으로 바꾼다 |
| stop-hook인데 검증 명령이 없음 | 막는다 | 명령을 정하거나 rules로 둔다 |
| 기존 `update` 충돌(수정된 코어 파일 등) | 막는다 | 기존 안내와 같다 |
| 지침 금지 vs 설정 허용, 보호 브랜치에 기준 브랜치 없음, CI가 부르는 스크립트 없음, 지침 기록 의무 vs 설정 비활성 | 진행한다 | 질문으로 나온다. 답이 없으면 권한 값은 바꾸지 않고, 보호 브랜치는 기준 브랜치를 더한 목록을 제안한다. 저장소 불일치(CI 스크립트)는 팀이 고친다 |

## 6. 작동 확인의 네 상태

| 상태 | 증거 | 예 |
|---|---|---|
| 설정 완료 | 파일·등록·구조 검사, 설정과 명세의 일치 | 훅 파일이 번들과 같다, `.claude/settings.json`에 등록이 있다 |
| 실행 확인 | 이 도구가 실제로 실행한 결과 | 임시 저장소의 보호 브랜치에서 설치된 branchGuard가 exit 2, `verify --run`의 `npm test` exit 0 |
| 확인 필요 | 앱이나 팀 환경에서만 확인할 수 있음 | Claude Code·Codex 안의 훅 실행(절차 제공), `--run` 없이 남긴 검증 명령, 기록 게이트 |
| 실패 | 기대와 다른 결과 | 등록이 없다, 설정이 명세와 다르다, 검증 명령 exit ≠ 0 |

훅 스크립트 시험은 프로젝트의 실제 설정 파일을 읽고 판정 기대치도 그 설정에서 만든다(허용 설정이면 일반 커밋은 통과, force push는 차단). 실제 앱 안의 실행은 `hooks-and-permissions.md` §8 절차로 사용자가 확인한다.

## 7. 한계

- 지침 문장의 정책 판독은 문구 패턴이다. 커밋·푸시 금지와 기록 의무만 읽고, 근거 줄을 함께 보여 준다. 잘못 읽었으면 `--set`으로 바로잡는다.
- 검증 명령 추출은 `package.json`·CI 워크플로·Makefile 중심이다. 다른 생태계는 표지 파일(pyproject·Cargo.toml·go.mod)로 후보만 제안한다.
- 워크플로 읽기는 흔한 형태(`run:` 한 줄·블록, `branches:` 인라인·목록)만 다룬다.
- 여러 저장소를 함께 구성하거나 감시하지 않는다. 명세를 다른 저장소에 가져오면 그 저장소에서 다시 진단해 충돌을 본다.
