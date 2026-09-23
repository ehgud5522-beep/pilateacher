# 이어서 작업하기 — 최근 변경과 남은 일

Claude Code · Codex 가 새 세션을 열면 이 파일부터 읽는다. 작업을 끝낼 때마다
맨 위 "최근 변경"을 갱신하고, 끝난 "남은 일"은 지운다.

- 작업 위치: `.codex-worktrees/h5-ios-audio-camera` · 브랜치 `docs/app-review-account` (PR #12)
- 웹: https://pilateacher.web.app — 배포는 `npm run deploy:web` (호스팅만 나간다)
  배포 전에 멈추는 조건이 둘 있다 (`tools/deploy-guard.mjs`): 브랜치가
  `main` · `docs/app-review-account` 가 아니거나, 커밋되지 않은 변경이 있으면
  (package-lock.json 만 예외) 빌드 전에 이유를 적고 멈춘다. 늘리려면 그 파일의
  `DEPLOYABLE_BRANCHES` 하나만 고친다.
- 규칙 배포는 따로다: `npm run test:rules` 통과 후
  `npx firebase deploy --only firestore:rules --project pilateacher --config firebase.foundation.json`

## 최근 변경 (2026-09-23, Cowork 세션)

### 0. 배포 안전장치 추가(961ef6d), 쓰레기 파일 삭제 — `tools/deploy-guard.mjs`
- 루트에 있던 `ersehgud…` 파일을 지웠다 (2026-09-04 `git branch` 출력이 잘못된
  리다이렉트로 저장된 것, 1573 bytes). 추적되지 않은 파일이라 배포 가드에 걸려
  있었다. `.gitignore` 에는 넣지 않았다 — 다시 생기면 그때도 걸려야 한다.
- 허용 브랜치가 아니거나 커밋되지 않은 변경이 있으면 **빌드 전에** 멈추고 이유를 적는다.
  배포된 화면이 어느 커밋인지 알 수 없게 되는 것을 막는 장치다 — 웹은 스토어 심사 같은
  관문이 없어서 누르는 즉시 전부에게 간다.
- 판정은 순수 함수로 떼어 두었다 (`tests/meta/deploy-guard.test.js` 16개).
- 만들면서 버그를 하나 잡았다: `capture()` 가 stdout 을 trim 해서 porcelain 첫 줄만
  한 칸 밀렸고, 그래서 `package-lock.json` 이 제외되지 않았다. 원인(부르는 쪽)과
  파서 양쪽을 고쳤고 둘 다 테스트로 고정했다.

### 0-1. 발급 내역 화면 — 대표 전용 · **미배포**
- 더보기 → 발급 내역. 조건은 `showPayroll` 과 같다 (`showIssues = showPayroll`).
  기본 이번 달, 지점 → 발급자로 묶고 CSV 한 줄 = 한 건.
- **규칙·인덱스 변경 없음.** 대표는 이미 원장 그룹 읽기가 되고, 인덱스
  `ledger organizationId > type > occurredAt` 를 급여 집계와 함께 쓴다.
- 합계에서 빼는 셋: 취소(`passes.status` 기준, 줄은 긋고 남긴다) · 이관 · 다른 달.
  지난달 발급을 이번 달에서 깎지 않고 "이전 달 발급 취소 N건" 으로만 알린다.
- 이관 판정은 `passes.contractedAt` 또는 `passId` 의 `csv_` 접두사 — 둘 다 이관만
  만든다. `unitPrice: 0` 은 쓰지 않았다 (0원 기타 상품이 정상 발급될 수 있다).
- 발급자는 `createdBy` 다. `instructorId` 로 묶으면 FC 실적이 강사에게 붙는다.
- 단가·`rule`·`baseUnitPrice` 는 화면에 없다. 발급 내역이지 급여가 아니다.
- 코드: `src/data/repositories/issue-report-repository.js` · App.jsx 의 `IssueReport`.
  테스트 19(단위) + 6(스모크).

### 0-2. 회원 앱 1단계 — 투영 함수 · 규칙 · 규칙 테스트
**규칙은 2026-09-23 먼저 배포했다. 트리거·백필은 나중.**
- `functions/src/member-view.js` (허용 목록으로 고르는 순수 함수) + 테스트 28개.
- 규칙에 블록 **둘만 추가** (43줄 추가, 0줄 삭제 — 기존 문은 손대지 않았다):
  `organizations/{org}/memberViews/{clientId}` — 본인 get 만. list·쓰기 전부 금지.
  `memberLinks/{uid}` — 본인 get 만. 쓰기 전부 금지.
  대표도 쓰기 불가다 — 쓰는 것은 서버(Admin SDK)뿐이고 규칙을 지나지 않는다.
- 규칙 테스트 15개 추가 (에뮬레이터 **220 pass**).
- **member 역할은 규칙상 센터 데이터를 못 읽는다** (2026-09-23에 규칙으로 막음).
  전에는 `passes`·`ledger`·`products` 의 read 가 `isActiveMember` 만 보고 역할을
  보지 않아서, role `member` 라도 소속 문서 하나면 센터의 회원권·원장을 전부
  읽었다 — `baseUnitPrice`·`netContractPrice`·`unitPrice`·`rule` 까지.
  투영 설계가 "회원에게 memberships 를 만들지 않는다" 는 **약속**에 기대고 있었고,
  약속은 다음 사람이 모른다. 그래서 규칙으로 옮겼다.
- 새 헬퍼 `isCentreStaff(organizationId)` = `hasRole([owner, manager, instructor, staff])`.
  아홉 곳을 이것으로 좁혔다: `organizations` · `products` · `passes` · `ledger` ·
  `lessons` · `lessons/participants` · `instructorClientTotals` · `locations` · `events`.
  네 역할을 그대로 나열하므로 **기존 사용자의 읽기는 하나도 바뀌지 않는다.**
  회원이 읽는 곳은 셋뿐: `memberViews` · `memberLinks` · 자기 `clients` 문서.
- 이 좁힘은 **2026-09-23 배포 완료**. 지금 쓰는 역할(owner·manager·instructor·staff)의
  읽기는 하나도 바뀌지 않았다 — 네 역할을 그대로 나열했다.
- `pass-journey` 는 Functions 에서 require 할 수 없다(배포에 functions/ 만 올라감).
  투영 함수가 주입으로 받게 해 뒀고, 배포 방식은 5번에서 정한다.

### 1. 지점별 회원 · 강사 목록 — 커밋 b655680, effc90a · 웹 배포됨
- 회원 관리 · 강사 관리 목록 위에 `전체 · 반송점 · 율하점 …` 칩(인원 수 포함).
  지점이 비었거나 목록에 없는 지점을 가리키는 사람은 "지점 없음" 칩으로 모인다.
- 강사 관리에 **지점 추가** (이름 중복 방지, 공백 무시). 이름 변경 · 삭제는 일부러 없다
  — 모든 기록이 locationId 로 지점을 가리킨다.
- 코드: `location-repository.js` 의 `createLocation · filterByLocation · countByLocation`,
  App.jsx 의 `LocationFilter · useLocationFilter`.

### 2. FC매니저 권한 — **2026-09-23 규칙·웹 배포 완료**
- 대표 결정: FC매니저(role `manager`)가 **회원권 상품 추가·종료 · 회원권 발급 · 회원 등록**을 한다.
  급여 집계 · 감사 로그 · 강사 관리 · 엑셀 이관 · 발급 취소/보정은 여전히 대표만.
- 규칙: `canIssuePass · canRegisterClient · canManageProducts` 에 manager 추가.
  앱: `FC_ROLES` 상수 하나로 메뉴를 연다. 두 쪽을 함께 바꿔야 한다.
- 강사 관리 → 추가 화면에 **권한: 강사 / FC매니저** 선택. FC매니저는 role manager 로
  들어가서 담당 강사 목록 · 급여에 섞이지 않는다 (`listInstructors` 가 instructor 만 읽음).
- 2026-09-23 규칙·웹 배포 완료. 에뮬레이터 규칙 테스트 205개 통과, 번들
  `index-CZhj55mB.js` 확인.

### 3. 급여 집계 기본 달 — 이 커밋
- 대표 결정: 처음 열면 **이번 달**. 정산 때 ‹ 로 지난달. `payroll-repository.js` 의 `currentMonth`.

## 남은 일

- [ ] FC매니저 실제 계정으로 발급 1건 확인
- [ ] 회원 앱 1단계 구현 — 10장 **1·2·3·4번 끝남** (2026-09-23).
      **규칙은 2026-09-23 배포했다** (좁힘 + memberViews·memberLinks 두 블록).
      두 블록은 쓰기가 전부 닫혀 있고 그 경로에 문서가 아직 없어서, 먼저 나가도
      아무에게도 아무 일도 하지 않는다.
      **트리거(5번)·백필(8번)은 나중이다** — 그 둘이 끝나야 회원 화면이 채워진다.
      다음은 5번 트리거.
      막힌 것 하나: Functions 는 functions/ 만 배포돼서 pass-journey(ESM, src/)를
      require 할 수 없다. 투영 함수는 주입으로 피해 뒀고, 트리거(5번) 만들 때
      셋 중 하나를 정해야 한다 — predeploy 복사 · 워크스페이스 패키지 · functions 로 이동.
      순서는 `docs/member-app-design.md` 10장: 투영 함수 + 테스트(끝) → 규칙 +
      규칙 테스트 13개 → 트리거 → 연결 함수 → 백필 → 회원 앱.
- [ ] 회원 앱 2단계 선행: `memberships.locationIds`(목록) + 강사 관리에서 담당 지점 다중 선택.
      위의 "매니저 지점 고정" 과 같은 일이다 — 한 번에 한다.
- [ ] 이미 강사로 들어간 사람을 FC매니저로 바꾸는 문은 없다 (규칙이 role 변경을 안 받음).
      필요하면 memberships update 에 role 문을 새로 내야 한다.
- [ ] 매니저 지점 고정: 지금 매니저는 모든 지점 회원을 본다 (2026-09-14 에 미룬 결정).
      율하점 매니저가 생기면 memberships.locationIds + 조회 · 규칙 · 화면을 한 번에.
- [ ] 출석 차감 순서 확인: 같은 회원이 수강권 2개일 때 만료 빠른 것부터 빠지는지
      (`pass-repository.test.js` "the pass that expires soonest is spent first" 가 이미 고정) —
      실제 데이터(반송점 김수현, 100회권 날짜 2026-11-28 오입력 의심)로 한 번 확인.
- [ ] APP_VER 는 안 올렸다 (스토어 빌드 번호와 묶여 있음).
- [ ] pilateacher.com 도메인 연결은 선택 — `docs/web-hosting.md`. MX · SPF 레코드는 건드리지 말 것 (메일).
