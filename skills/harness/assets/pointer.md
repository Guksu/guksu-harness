# 프로젝트 작업 규칙

## 하네스: 팀 설정

파일을 고치거나 명령을 실행하기 전에 지킨다. 한 줄짜리 수정도 같다.

- 편집 전에 현재 브랜치를 확인한다. 보호 브랜치(기본 `main`·`master`, 목록은 `.agents/hooks/branchGuard.config.json`)면 작업 브랜치를 먼저 만든다. `sed -i`·리다이렉션 같은 셸 편집도 같다.
- `.env`·`credentials*`·`*.pem`·`secrets/`의 값은 읽거나 출력하지 않는다. 키 이름은 `.env.example`이나 설정 코드에서 확인하고, 재귀 검색에서는 이 파일들을 제외한다.
- 커밋·푸시는 요청받았고 `.agents/hooks/blockGitMutation.config.json`이 허용할 때만 한다. force push와 이력 재작성(reset·rebase·amend)은 하지 않는다.
- 커밋·PR·이슈·댓글에 AI 작성 표기를 넣지 않는다.

브랜치 이름·검증 명령·기록 정책 같은 팀 규칙은 `docs/harness-rules.md`에 있고 위 항목보다 우선한다. 공통 규칙은 `.agents/harness-core-rules.md`에 있으며 관리 도구가 갱신한다. 하네스 설정을 바꾸면 `npx guksu-harness check`로 구조를 검사한다.
