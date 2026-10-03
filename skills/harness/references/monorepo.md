# 모노레포의 진단과 검증

이 하네스는 기존 모노레포의 작업 규칙과 검증 위치를 연결한다. 패키지 관리자를 바꾸거나 Nx·Turbo의 스케줄러·캐시를 대체하지 않는다.

## 발견하는 정보

- npm·Yarn·Bun: `package.json`의 `workspaces` 배열 또는 `workspaces.packages` 배열.
- pnpm: `pnpm-workspace.yaml`의 `packages`. YAML 파서와 glob 매처로 인라인 목록·따옴표·주석·제외 패턴(`!packages/legacy`)을 처리한다.
- 패키지 이름·경로·scripts와 dependencies/devDependencies/peerDependencies/optionalDependencies의 내부 패키지 관계.
- `AGENTS.md`·`CLAUDE.md`의 경로·적용 범위·앱. 하위 지침 본문을 루트 정책으로 합치지 않는다. 하위 파일은 수정하지 않는다.
- Nx·Turbo 존재. Nx의 `project.json` 전용 프로젝트와 추론된 태스크·암묵적 의존 관계는 아직 지원하지 않는다.

하위 경로에서 시작하면 가장 가까운 workspace 선언 또는 하네스 설치 루트까지 올라간다. 별도 Git 저장소 경계를 넘지 않으며 실제 Git worktree도 지원한다. 탐색은 node_modules·빌드 캐시·심볼릭 링크 디렉터리·중첩 Git 저장소를 제외한다. 디렉터리 탐색 한도는 20,000개다. 잘못된 설정, 중복 이름, 선언된 내부 의존 순환, 탐색 실패는 compose를 차단한다. 단일 프로젝트는 기존 흐름을 유지한다.

## 검증 명세

`verification.checks`는 기존 문자열 배열도 받으며 다음 객체 형식을 지원한다:

```json
[
  { "name": "common", "command": "npm run lint" },
  { "name": "web:test", "command": "npm test", "cwd": "apps/web", "workspace": "@acme/web", "timeoutMs": 120000 },
  { "name": "web:size", "command": "npm run size", "cwd": "apps/web", "workspace": "@acme/web", "required": false }
]
```

`cwd`는 하네스 루트 기준 상대 경로이며 생략하면 루트다. 절대 경로·`..`·루트 밖 심볼릭 링크를 거부한다. `workspace`는 이름이며 cwd가 현재 선언과 맞아야 한다. `timeoutMs`는 1~300000, 기본 300000이다. `required`는 기본 true이고 false인 검사의 실패는 보고하되 종료를 막지 않는다. 검증 명령 자체는 셸 명령이므로 팀이 신뢰하고 실행을 승인한 명령을 쓴다.

자동 후보는 build → typecheck → type-check → lint → test → check 순서이며 내부 의존 패키지가 먼저다. 팀이 명시한 배열은 순서를 유지한다. 의존 패키지의 빌드·코드 생성이 필요한 프로젝트는 실행 순서를 검토한다. 루트에 이미 적절한 task runner가 있으면 `verification.checks`를 그 명령들로 명시해 중복 실행을 줄인다. 루트 공통 명령은 모든 선택 범위에서 실행하며, 모든 패키지를 포함한 검증으로 구성했는지는 팀이 확인한다.

`compose`가 명세·규칙 문서·Stop 훅 설정에 cwd/timeout/required를 같은 값으로 기록한다. `verify --run`과 Stop 훅은 같은 실행 함수를 사용한다. Stop 훅은 명세의 전체 검사를 실행하며 `--affected` 선택을 자동 적용하지 않는다.

## 실행 범위

```bash
npx guksu-harness verify --plan --json
npx guksu-harness verify --plan --affected --base origin/main
npx guksu-harness verify --run --affected --base origin/main --json
npx guksu-harness verify --run --workspace @acme/web
```

`--plan`은 검증 명령이나 훅 시험을 실행하지 않는다. `--run`과 함께 쓸 수 없다. `--affected`와 `--workspace`도 함께 쓸 수 없다.

| 조건 | 범위 |
|---|---|
| 기본 | 전체 명세 |
| `--affected --base <ref>` | merge-base부터 현재 작업 트리까지의 커밋·staged·unstaged·새 파일, 이동 전후·삭제 경로를 조사 |
| 패키지 소스 변경 | 직접 변경 패키지 + 역방향 의존 패키지 + 이들의 선행 패키지 검사 |
| 루트·미분류 경로, 삭제된 패키지, 패키지 manifest·AGENTS/CLAUDE 변경 | 전체 |
| Git 기준 누락·비교 실패, Nx·Turbo | 전체, 이유 표시 |
| 비교 결과 변경 없음 | 패키지 검사 없음. 루트 공통 검사는 유지 |
| `--workspace <이름>` | 지정 패키지와 루트 공통 검사. 선행·사용 패키지를 자동 추가하지 않음 |

변경 범위 계산은 package.json에 선언된 의존 관계를 기준으로 한다. 선언 없는 상대 경로 import·TS paths·다른 언어의 의존 관계는 추론하지 않는다. 그런 저장소는 전체 검증 또는 기존 task runner의 루트 명령을 쓴다. 변경 계획은 실행 때 다시 계산하며 검증 결과 캐시를 재사용하지 않는다.

## 결과와 근거

JSON의 `verification`에는 범위·선택 이유·선행 패키지·비교 기준·명령 ID·cwd·종료 코드·소요 시간·실패 출력이 들어간다. 필수 검사 실패는 `failed`, 실행하지 않았거나 계획에 빠진 검사가 있으면 `unverified`, 필수 검사가 통과하면 `passed`다. 변경이 없고 실행할 공통 검사도 없으면 `not-applicable`이다. 설정 검사 실패는 상위 `ok`에도 반영한다.

`runtime`에는 검사 직전 Node·OS·Git HEAD·dirty 여부, 선택한 명령 목록의 해시, 발견한 CLI 버전을 남긴다. CLI 버전은 현재 GUI 앱 버전이나 훅 통합 성공을 뜻하지 않는다. 모델은 null, 토큰은 `unmeasured`/null이며 0으로 대체하지 않는다. dirty 여부는 변경 내용의 정확한 해시가 아니므로 재현 평가에는 별도 사본 또는 패치 기록이 필요하다. 실제 GPT·Claude의 성능 비교는 별도 모델 세션에서 수행한다.
