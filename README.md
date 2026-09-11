# guksu-harness

**AI에게 매번 반복하던 작업 규칙을 프로젝트에 저장합니다.** 중요한 브랜치를 보호하고, 변경을 검사하고, 다음 작업에 필요한 기록을 남기는 Claude Code 플러그인입니다.

v2.3.0 · 스킬 9종 · 보호·검증 훅 4종 · MIT

## 시작하기

Claude Code와 Node.js 22 이상이 필요합니다. 브랜치 기능에는 git 저장소가 필요합니다.

Claude Code에서 설치합니다:

```text
/plugin marketplace add Guksu/guksu-harness
/plugin install guksu-harness@guksu-harness
```

프로젝트를 열고 요청합니다:

```text
/guksu-harness:harness 이 프로젝트에 작업 규칙 설정해줘
```

기존 설정을 먼저 확인하고 필요한 파일을 만듭니다. 기본은 작업 절차·보호 장치·기록 양식입니다. 여러 역할의 협업이 필요할 때만 에이전트와 진행표를 추가합니다. 이미 승인한 내용은 다시 묻지 않습니다.

완료 보고에는 다음이 나옵니다:

- 어떤 규칙과 보호 장치를 추가했는지
- 기존 설정에서 보존한 것은 무엇인지
- 검사가 통과했는지, 확인하지 못한 것은 무엇인지

## 이렇게 요청하세요

| 하고 싶은 일 | 요청 예시 |
|---|---|
| 상태만 확인 | “하네스 점검해줘. 바꾸지는 말고.” |
| 규칙 개선 | “불필요한 확인 절차를 줄여줘.” |
| 업데이트 | “하네스 업데이트해줘. 내가 수정한 규칙은 보존해줘.” |
| UI 개선 | “이 화면을 다듬어줘.” |
| 배포 전 검사 | “핵심 사용자 흐름을 배포 전에 점검해줘.” |
| 작업 인계 | “다음 세션이 이어서 할 수 있게 정리해줘.” |
| 커밋·푸시 | “검증하고 커밋·푸시까지 해줘.” |
| 제거 | “하네스를 제거하고 작업 기록은 남겨줘.” |

**점검·분석은 파일을 바꾸지 않습니다.** 수정·업데이트를 요청하면 변경 목록을 설명하고 진행합니다. 사용자 수정 파일과 충돌하면 보존하고 해결할 항목을 알려 줍니다.

“테스트 통과할 때까지 고쳐줘” 같은 일반 개발은 바로 수정·검사를 진행합니다. 별도 반복 설정은 장시간 처리·정기 실행·감시가 필요할 때만 사용합니다.

## 보호 장치는 어디까지 적용되나요?

| 장치 | 기본 동작 | 한계 |
|---|---|---|
| git 명령 보호 | 커밋·푸시 등 변경 명령 차단. 프로젝트가 허용한 경우 요청 범위에서 실행 | 명령 패턴 검사이며 사용자 승인을 판독하지 않음 |
| 브랜치 보호 | main·master에서 편집 도구의 파일 수정 차단 | Bash 파일 쓰기는 대상이 아님 |
| 민감정보 보호 | 알려진 키·환경설정 경로의 접근 제한 | 프로젝트별 경로와 사용하는 도구에 맞춰 설정 필요 |
| 종료 검사 (선택) | 실패하면 재검사, 반복 한도에 도달하면 보고 후 종료 | 설정 없으면 비활성. Stop 이벤트에서만 검사 |

훅은 Claude Code 이벤트에 등록했을 때 동작합니다. 다른 앱에서 스킬을 읽었다고 같은 보호가 자동 적용되지는 않습니다. [설정과 보장 범위](skills/harness/references/hooks-and-permissions.md)를 확인하세요.

배포 점검은 **가능 / 불가 / 판정 보류**로 보고합니다. 필수 브라우저 검사를 실행하지 못했다면 정적 검사가 통과해도 판정 보류입니다.

## 상태 확인과 업데이트 도구

플러그인 저장소에서 실행하는 예시입니다. 다른 위치에서는 스크립트의 절대 경로를 사용합니다.

```bash
# 상태만 확인 — 파일 변경 없음
node skills/harness/scripts/harnessManager.mjs status /path/to/project

# 변경 미리보기 — 프로젝트 변경 없음
node skills/harness/scripts/harnessManager.mjs plan /path/to/project --out /tmp/harness-plan.json

# 검토한 계획 적용 — 변경 전 백업 생성
node skills/harness/scripts/harnessManager.mjs apply /path/to/project --plan /tmp/harness-plan.json
```

기존 파일과 미리보기 이후의 변경을 확인합니다. 충돌 파일은 덮어쓰지 않으며, 선택 적용과 백업 복원도 제공합니다. 관리 범위는 공통 훅·규칙·템플릿·훅 등록입니다. 프로젝트 전용 스킬은 `harness`가 별도로 구성합니다.

[선택 적용·제거·복원 안내](skills/harness/references/installation.md)

## 기존 사용자가 알아둘 변경

- 브랜치 전략은 프로젝트 관례를 따릅니다. `dev`나 `feat/`를 강제하지 않습니다.
- 일반적인 수정·테스트 재시도에 별도 루프 승인을 요구하지 않습니다.
- 작업 기록은 의미 있는 변경·최종 커밋 단위로 모읍니다.
- Claude 작성자 표기 제한은 `blockAttribution: true`일 때만 적용합니다. 이전 제한을 유지하려면 훅 업데이트 전에 설정하세요.
- 커밋·푸시 허용 설정은 자동으로 바꾸지 않습니다.
- 기존 수동 설치에 추적 기록이 없으면 버전·소유권을 추측하지 않습니다. 번들과 다른 파일은 보존합니다.

## 문제가 생겼다면

| 증상 | 확인할 것 |
|---|---|
| 파일 수정이 막힘 | 현재 브랜치와 보호 브랜치 설정 |
| 커밋·푸시가 막힘 | 사용자 요청 범위, allowCommitPush, 작업 기록 요구 |
| 훅이 실행되지 않음 | Node.js, 공유 설정의 훅 등록, 현재 앱 지원 |
| 업데이트 충돌 | 파일을 직접 수정했는지 확인하고 필요한 파일만 선택 적용 |
| 반복 검사가 중단됨 | 남은 실패·최대 반복·같은 실패 누적·설정 오류 |
| 배포 판정 보류 | 실행하지 못한 필수 검사와 필요한 환경 |

## 상세 안내와 개발

스킬은 작업 절차 문서이며, 이름을 지정해 따로 호출할 수도 있습니다.

| 작업 | 스킬 |
|---|---|
| 구성·점검·업데이트 | [harness](skills/harness/SKILL.md) |
| 브랜치 준비·업로드 | [branch](skills/branch/SKILL.md), [pr](skills/pr/SKILL.md) |
| 기록·인계·회고 | [history](skills/history/SKILL.md), [handoff](skills/handoff/SKILL.md), [retro](skills/retro/SKILL.md) |
| 장시간·정기 반복 | [loop](skills/loop/SKILL.md) |
| 화면 개선·배포 검사 | [fe-craft](skills/fe-craft/SKILL.md), [fe-predeploy](skills/fe-predeploy/SKILL.md) |

```bash
node skills/harness/scripts/validateHarness.mjs .
node --test skills/harness/scripts/*.test.mjs skills/fe-predeploy/scripts/*.test.mjs
```

[검증 방법](skills/harness/references/testing-guide.md) · [변경 이력](CHANGELOG.md) · [라이선스](LICENSE)
