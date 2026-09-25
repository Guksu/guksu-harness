---
name: history
description: "사용자가 요청하거나 팀 정책이 요구하는 작업 기록을 작성·갱신한다."
---

# 선택적 작업 기록

일반 개발·커밋만으로 별도 기록을 만들지 않는다. 팀 규칙 또는 `requireHistoryDoc`이 요구하거나 사용자가 요청할 때 한 작업 단위에 한 문서를 유지한다.

- `docs/history/{YYYY-MM-DD}-{slug}.md`에 작성한다. 같은 작업 문서가 있으면 갱신한다.
- 프로젝트 `docs/templates/history.md`를 우선한다. 없으면 이 스킬의 `assets/templates/history.md`를 복사한다. 프로젝트가 고친 양식의 구조를 존중한다.
- 변경 이유, 결과, 실제 검증, 미실행·실패, 후속 사항을 남긴다. 채팅을 읽지 않은 사람도 판단할 수 있어야 한다.
- 과거 기록을 임의로 삭제하지 않는다. 중복된 PR 본문이나 로그를 전문 복사하지 않는다.

양식 제공은 기록 작성을 강제하지 않는다. 다른 선택 문서의 원본도 `assets/templates/`에 있다: handoff·retro·loop-spec·predeploy·design. 해당 작업에서 프로젝트 양식이 없을 때 필요한 파일만 복사하며, 양식 때문에 이 스킬을 추가 호출할 필요는 없다.
