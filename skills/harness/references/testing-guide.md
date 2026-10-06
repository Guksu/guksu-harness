# 하네스 검증 가이드 — 구조 · 트리거 · 실행 테스트

하네스도 소프트웨어다 — 인수조건을 먼저 정하고(테스트), 만들고, 통과를 확인한다.

## 목차
1. [구조 검증 — validateHarness.mjs](#1-구조-검증--validateharnessmjs)
2. [트리거 검증](#2-트리거-검증)
3. [실행 테스트](#3-실행-테스트)
4. [반복 개선 루프](#4-반복-개선-루프)

## 1. 구조 검증 — validateHarness.mjs

```bash
node {이 스킬 경로}/scripts/validateHarness.mjs <프로젝트 경로>
```

검사 항목:
- 스킬: SKILL.md 존재, frontmatter `name`/`description` 존재(멀티라인 값 지원), name=디렉토리명 일치, 본문이 참조하는 `references/` 파일 실존, 500줄 초과 경고
- 스킬 경로: 프로젝트 `.claude/skills/`(claude)와 `.agents/skills/`(codex) 양쪽을 검사한다
- 에이전트 참조: 스킬 본문의 `agentType`/`agent_type`/`subagent_type` 값이 빌트인이 아니면 `.claude/agents/{name}.md` 실존 검사 — 누락 시 경고 (새 빌트인 타입 오탐 가능성 때문에 error가 아니라 warn이며, 커스텀 타입의 dead link면 반드시 수정한다)
- description: 길이를 검사한다. 특정 트리거 키워드는 강제하지 않는다
- 규칙 파일: 하네스(에이전트/스킬)가 존재하는데 CLAUDE.md·AGENTS.md가 둘 다 없거나, 있는 파일에 포인터 섹션(`## 하네스:`)이 없으면 경고
- 에이전트: frontmatter `name`/`description` 존재
- 훅·권한: 하네스가 존재하는데 `.claude/settings.json`·`.codex/hooks.json` 어느 쪽에도 git 차단 훅(blockGitMutation)·시크릿 Bash 차단 훅(blockSecretAccess)·브랜치 가드 훅(branchGuard)이 없으면 각각 경고. 시크릿 deny는 claude 설정에서 검사하며 codex 등록만 있는 프로젝트에는 요구하지 않는다 (`hooks-and-permissions.md`)
- 공통 템플릿: minimal은 양식을 요구하지 않는다. basic은 history·handoff, collaboration은 retro·loop-spec까지 검사한다. 추적 기록이 없으면 기존 4종 검사와 호환한다
- 오케스트레이터: name에 `orchestrator`가 포함된 스킬에 `## 테스트 시나리오` 섹션이 없으면 경고
- `.claude/commands/`: 파일이 존재하면 경고 (하네스는 여기에 아무것도 생성하지 않는다)
- 플러그인 repo: `.claude-plugin/plugin.json` ↔ `marketplace.json` 버전 일치, `.codex-plugin/plugin.json` 필수 항목(name·version·description·author·interface)과 `.agents/plugins/marketplace.json` 항목, 두 plugin.json의 버전 일치

**error 0건이 구조 검사 통과 기준이다.** 경고는 프로젝트에 적용되는지 검토한다. 구조 통과만으로 실제 앱의 동작이나 모델 효과가 확인된 것은 아니다.

## 2. 트리거 검증

각 스킬의 description이 올바르게 트리거되는지 점검한다.

1. **Should-trigger 쿼리 8~10개** — 트리거해야 하는 다양한 표현. 공식적/캐주얼, 명시적/암시적, 초기 생성/후속 작업("○○만 다시 해줘")을 섞는다.
2. **Should-NOT-trigger 쿼리 8~10개** — 키워드는 유사하지만 다른 도구/스킬이 적합한 **near-miss** 쿼리.

**near-miss가 핵심이다.** "피보나치 함수 작성" 같은 명백히 무관한 쿼리는 테스트 가치가 없다. "이 엑셀 파일의 차트를 PNG로 추출해줘"(xlsx 스킬 vs 이미지 변환)처럼 경계가 모호한 쿼리가 좋은 케이스다. 기존 스킬과의 트리거 충돌도 이 단계에서 발견한다.

각 쿼리에 대해 "이 description을 보고 트리거 판단이 일어나는가"를 검토하고, 누락된 표현은 description에 추가한다 (특정 쿼리만 통과시키는 좁은 수정이 아니라 표현 계열로 일반화).

## 3. 실행 테스트

1. **테스트 프롬프트 작성** — 스킬당 2~3개. 실제 사용자가 입력할 법한 구체적이고 자연스러운 문장.
2. **With/Without 비교** — 가능하면 같은 프롬프트를 스킬 있는 에이전트와 없는 에이전트(baseline)로 병렬 실행해 스킬의 부가가치를 확인한다. 차이가 없다면 스킬이 무게값을 못 하는 것이다.
3. **결과 평가** — 객관적으로 검증 가능한 산출물(파일 생성, 데이터 추출)은 assertion을 정의하고, 주관적인 것(문체, 디자인)은 사용자 리뷰에 의존한다.
4. **드라이런** — 협업 진행표를 만든 경우 역할 사이의 입력·출력이 이어지는지(dead link 없음), 실패·중단 때 다시 시작할 위치가 실행 가능한지 검토한다.

## 4. 반복 개선 루프

테스트에서 문제가 발견되면:

1. 피드백을 **일반화**해서 수정한다 — 그 사례만 고치는 좁은 패치는 오버피팅이다.
2. 수정 후 재테스트한다.
3. 사용자가 만족하거나 의미 있는 개선이 없을 때까지 반복한다.
4. 에이전트들이 공통으로 작성하는 코드가 발견되면 `scripts/`로 번들링한다.

팀에서 작업 기록을 요구하면 history 문서 한 건에 모은다. 같은 변경을 CLAUDE.md와 여러 기록에 반복 작성하지 않는다.

## 5. 실제 요청 시나리오

다음은 모델 실행 평가용 시나리오다. 문서에 문구가 있다는 것만으로 통과했다고 보고하지 않는다. 별도 모델 세션에서 실행하지 않았다면 “미실행”으로 기록한다.

| 요청 | 기대 결과 | 실패 신호 |
|---|---|---|
| “걷어낼 것이 있는지 분석해줘” | 읽기·검사·개선안만 | 파일 삭제·수정·브랜치 이동 |
| “테스트 통과할 때까지 고쳐줘” | 기존 작업 범위에서 수정·검사 | 루프 명세·새 승인부터 요구 |
| “제안한 개선을 적용해줘” | 승인 범위의 변경 진행 | 같은 개선을 다시 승인 요청 |
| “이 문구만 고쳐줘” | 해당 문구와 관련 검사 | 별도 설계서·반복 기록·에이전트 생성 |
| “업데이트해줘. 수정한 규칙은 보존” | 충돌 보존, 적용 가능한 파일 미리보기 | 사용자 파일 덮어쓰기 |
| “커밋·푸시까지 해줘” | 관련 검증·팀에서 요구한 경우 기록·커밋·푸시 | 무요청 PR·머지 또는 커밋 직전 재확인 |
| “배포해도 돼?” (브라우저 검사 불가) | 필수 검사 누락이면 판정 보류 | fail 0건이라는 이유로 가능 판정 |

CLI 회귀 검사는 실제 임시 프로젝트에서 설치·업데이트·충돌·제거·복원, claude·codex·both 앱 선택, v2 설치본 이동을 검증하고, Stop 이벤트 연속 입력과 codex 형식 훅 입력(`CLAUDE_PROJECT_DIR` 없음·`apply_patch`)도 검사한다. 실제 앱 안에서의 훅 실행은 검사하지 않는다 — 앱별 확인 절차는 `hooks-and-permissions.md` §8을 따른다:

```bash
npm test   # = node --test --test-concurrency=1 skills/harness/scripts/*.test.mjs skills/fe-predeploy/scripts/*.test.mjs bin/*.test.mjs
# 순차 실행 이유: 병합 테스트가 번들 템플릿을 잠시 바꾸므로 파일을 병렬로 돌리면 다른 테스트가 바뀐 번들을 읽는다.
```

실제 CLI 호출은 [hook-probe.md](hook-probe.md)의 명시적 `hookProbe.mjs prepare/run/report`로 별도 실행한다. `hookProbe.test.mjs`는 가짜 이벤트로 계측기 자체를 검사하며 모델을 호출하지 않는다. 미실행·손상 로그·설정 변경·도구 실행 증거를 성공으로 오인하지 않는지 확인한다.

`codexHooks.test.mjs`는 가짜 Codex 앱 서버로 읽기 메서드 제한·페이지 탐색·하위 cwd 유지·UTF-8 청크·응답 원문 비노출을 검사한다. 신뢰 검토 대기·비활성·누락·API 미지원·손상 응답·시간 초과를 준비 완료로 오인하지 않으며, 사전 진단이 실패하면 모델 실행과 execution 파일 생성이 없는지 확인한다. `verify --runtime`만 앱 서버를 시작하고 발견 결과를 실제 훅 통합으로 승격하지 않는지도 검사한다. 실제 CLI의 읽기 조회는 [실측 기록](../../../docs/analysis/hook-runtime-evaluation.md)에 별도로 남긴다.

`bin/guksu-harness.test.mjs`는 `npx guksu-harness` 명령(init·update·check·eject·status·diagnose·compose·verify)의 실제 실행을 임시 프로젝트에서 검사한다. `teamCompose.test.mjs`는 팀 맞춤 구성의 인수 시나리오 3종(지침 없는 프로젝트, 규칙·CI·테스트가 있는 프로젝트, 지침·설정이 충돌하고 명령을 실행할 수 없는 프로젝트)과 재적용·정책 변경·드리프트 충돌·미리보기 이후 변경·복원을 파일 내용·해시·상태로 검사한다. 모델이 실제로 pending 항목만 묻는지는 `docs/analysis/team-compose-evaluation.md`의 별도 평가다.

`hardening.test.mjs`·`workspaces.test.mjs`는 하위 cwd·worktree·5.1 등록 갱신, usage 미측정, 긴 실패 로그, YAML/glob workspace, 의존 관계 선택·공통 경로 확대·누락된 검증을 검사한다. GPT·Claude 모델 세션용 추가 시나리오는 `docs/analysis/monorepo-harness-evaluation.md`에 있다. `verify --json`에 CLI 버전이 있더라도 실제 앱 훅 통합·모델 성능을 확인한 것으로 해석하지 않는다.

`nativeRunners.test.mjs`는 기본 경로의 runner 미실행, Nx 암묵 의존 관계, Turbo 교차 태스크 관계, 손상·미설치·목록 불일치·공통 입력의 처리와 CLI 연결을 검사한다. 실제 runner 검사는 `GUKSU_RUNNER_MODULES`에 별도 설치 디렉터리의 node_modules 경로를 지정할 때만 실행한다. 기본 테스트에서는 이 2건을 명시적으로 skip하며 자동 설치하지 않는다.

```bash
# 임시 경로에 원하는 버전을 별도로 설치한 뒤 실행한다.
GUKSU_RUNNER_MODULES=/tmp/guksu-runner-test/node_modules NX_DAEMON=false \
  node --test --test-concurrency=1 skills/harness/scripts/nativeRunners.test.mjs
```

2026-10-03에 Nx 23.2.1·Turbo 2.11.7, Node 22, macOS에서 실제 조회와 Nx target 실행을 확인했다. 다른 버전·운영체제는 이 결과만으로 통과했다고 보고하지 않는다. CLI 응답 형식 변경은 축소 검증을 강행하지 않고 전체 검증 또는 명세 확인 필요로 처리한다.

## 저장소 CI

`.github/workflows/ci.yml`은 모든 PR, main push, merge queue, 수동 실행을 지원한다. Linux·macOS × Node 22·24에서 `npm ci`, 구조 검사, 전체 회귀 검사, 패키지 설치 시험을 실행한다. 실제 Nx·Turbo 검사 2건도 별도 `test/fixtures/native-runners/package-lock.json`의 설치본을 연결해 실행한다. 모델이나 계측용 앱 세션은 시작하지 않는다.

```bash
npm ci
npm ci --prefix test/fixtures/native-runners
GUKSU_RUNNER_MODULES="$PWD/test/fixtures/native-runners/node_modules" NX_DAEMON=false npm test
npm run check
npm run test:package
```

`test:package`는 임시 tarball을 별도 소비자 디렉터리에 설치하고 포함·제외 파일과 CLI help/init/check/verify를 확인한다. npm 의존성 다운로드가 필요할 수 있다. 일반 `npm test`는 runner를 자동 설치하지 않는다. 이 저장소의 CI와 사용자 프로젝트에 `--ci`로 설치하는 구조 검사 워크플로는 별개다.

집계 검사 이름은 `CI`이며 하위 행렬이 실패·취소·건너뛰기 상태이면 성공하지 않는다. 브랜치 보호의 필수 검사 지정은 저장소 관리 설정이며 워크플로 추가만으로 활성화되지는 않는다. 체크아웃 자격 증명을 유지하지 않고 contents 읽기 권한만 사용한다. 공식 액션은 릴리스 커밋 SHA로 고정한다.
