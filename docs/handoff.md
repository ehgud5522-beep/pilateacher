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

### 0-3. 회원 앱 5번 트리거 — **미배포**
- `functions/src/member-view-triggers.js` + 에뮬레이터 테스트 14개
  (`npm run test:member-view` — Firestore 에뮬레이터를 띄워 Admin SDK 로 진짜 읽고 쓴다).
- **공통 순수 모듈은 `functions/shared/*.mjs` 가 원본이다.** 복사하지 않는다.
  `constants.mjs` · `pass-journey.mjs` 를 옮겼고, `src/data/schema/constants.js` 는
  재수출 한 줄만 남아 스물두 군데가 그대로 돈다. 앱은 네이티브 ESM 으로,
  Functions(CJS)는 async 핸들러에서 `await import()` 로 읽는다.
- 트리거는 `passes` · `clients` **둘만**. 원장에 쓰는 다섯 함수가 전부 같은 배치에서
  passes 도 쓰므로 ledger 트리거는 같은 일을 두 번 한다.
- 순서 보호: 투영의 `sourceEventAt` 을 트랜잭션에서 견준다. 늦게 온 호출은 건너뛴다.
- 실패해도 차감·발급은 안 막힌다 (사후 처리). `retry: false`, 회원별로 따로 잡아
  한쪽 실패가 다른 쪽을 막지 않는다.
- 비용: 차감 1건당 트리거 1회, 재작성마다 읽기 ~60 · 쓰기 1 (듀엣이면 두 배).
  원장은 회원권마다 `limit(60)`. **새 색인 없음.**

### 0-5. 차감 규칙 (2026-09-23 대표 확정) — **미배포 · 폰 앱은 새 빌드 필요**

회원 A가 1:1 회원권과 듀엣(2:1) 회원권을 **동시에** 가진 상태에서, 만료 순서만 보고
고르면 1:1 수업이 짝의 회차를 가져간다. 대표가 표로 확정했고 여섯 줄을 각각 테스트로
고정했다.

| # | 상황 | 차감 |
| --- | --- | --- |
| 1 | A 혼자 출석 | **1:1 만**, 만료 빠른 것부터 |
| 2 | A+B 둘 다 출석 | **공유 2:1 에서 1회만**, 만료 빠른 것부터 |
| 3 | A+B 중 한 명 노쇼 | 공유 2:1 에서 **1회 차감** (노쇼도 차감) |
| 4 | A+B 둘 다 노쇼·취소 | 차감 없음 |
| 5 | 명단에 A 만 (B 미리 취소) | 1:1 수업으로 보고 **1:1 에서** |
| 6 | A 혼자, 1:1 잔여 0 | 차감 없이 `solo_pass_missing`. **2:1 에서 절대 빼지 않는다** |
| + | 각자 1:1 만 가진 두 사람이 한 타임 | 각자 1:1 에서 **2회** (기존 유지) |

- 가르는 기준은 수업 유형 글자가 아니라 **이 사람들이 함께 적힌 회원권이 있는가**다.
  각자 1:1을 가진 두 사람도 화면에는 듀엣으로 보이고, 그 수업은 2회가 맞다.
- 고치기 전 실제 동작(직접 돌려서 확인): 1:1 수업이 만료 이른 듀엣 회원권에서 빠졌고,
  짝은 `pass.clientId ===` 비교에 걸리지 않아 **"회원권이 없습니다"** 로 끝났으며,
  A 노쇼·B 출석인 듀엣 수업은 **한 건도 차감되지 않았다.**
- 선택은 이제 한 곳뿐이다 — `planPassSelection`(lesson-settlement.js). 확정과
  미리보기가 같은 함수를 부르고, **일곱 가지 전부 같은 passId 를 고르는지** 테스트가
  견준다. 그 테스트가 실제로 어긋남을 하나 잡았다: 미리보기가 "미리 취소"를 무시해
  규칙 5에서 공유 회원권을 가리켰다.
- 새 건너뜀 사유 둘: `solo_pass_missing` · `duet_pass_spent`. 잔여 0(`spent`)과
  고치는 방법이 달라서 나눴다 — 앞은 짝과 함께 오면 풀리고 뒤는 재등록이다.
- 공유 회원권 한 건은 두 사람의 줄에 모두 적힌다. 되돌리기는 `passId/entryId` 로
  중복을 걸러 **한 번만** 보정한다 (두 번 보정하면 잔여가 하나 늘어난 채 남는다).
- 차감할 때 `attendanceByClientId` 를 넘긴다. 전에는 안 넘겨서 노쇼도 참가자 문서에
  `attended` 로 박혔다.
- 코드: `lesson-settlement.js` · `lesson-rate-preview.js` · App.jsx(확정 루프 ·
  `SchedRateLine`). 테스트 35(확정) + 11(미리보기).
- **배포하지 않았다. 웹은 `npm run deploy:web`, 폰 앱은 스토어 새 빌드가 있어야
  반영된다** — 지금 기기에 깔린 1.1.26 은 예전 규칙으로 계속 차감한다.

### 0-4. 회원 앱 6번 연결 함수 — **미배포**
- `functions/src/member-link.js`(판정, 순수) + `member-link-store.js`(Firestore).
  Callable 넷: `linkMemberAccount`(회원 본인) · `linkMemberAccountByOwner` ·
  `unlinkMemberAccount` · `listPendingMemberLinks`(대표의 대기 목록).
  테스트 20(단위) + 7(에뮬레이터, `npm run test:member-view` 로 함께 돈다 — 22 pass).
- **버그 하나를 에뮬레이터가 잡았다.** Firebase Auth 의 `phone_number` 는 E.164
  (`+821012345678`)이고 명부는 `01012345678` 이다. 숫자만 남기면 두 값이 영영
  만나지 않아 **정상 등록된 회원 전원이 "찾지 못했습니다"** 로 끝난다. 변환을
  `functions/shared/phone.mjs` 의 `phoneFromVerifiedToken` 으로 이름 붙여 두었고,
  `normalizePhone` 도 그 파일이 원본이 되어 앱이 재수출한다 (철자가 갈리면 같은
  사람이 서로 다른 회원이 된다).
- **설계 문서에서 셋이 바뀌었다** (문서에 반영):
  `collectionGroup` 대신 센터별 질의 — 그룹 질의는 색인을 손으로 선언해야 하는데
  `fieldOverrides` 가 자동 색인을 통째로 대체하고, **에뮬레이터는 색인 없이도
  받아 줘서 프로덕션에서만 실패한다.**
  `memberLinks` 는 `organizationId`·`clientId` 단수 칸 대신 `links[]` — 확정 7번이
  여러 지점을 전부 잇기로 했으므로 단수 칸은 어차피 참이 아니다.
  상태 `taken` 이 늘었다 — 후보가 이미 다른 계정의 것이면 **덮어쓰지 않는다**
  (가족 공용 번호). 자동 연결의 핵심은 `ambiguous`(같은 지점 동명이인)를 **잇지
  않고** 대표에게 넘기는 것이다.
- 대기 목록 문이 하나 늘었다. 규칙상 `memberLinks` 는 본인만 읽으므로 대표가
  후보를 볼 길이 없었다 — 부를 수 없는 문이 될 뻔했다. `ambiguous` 만, 그리고
  **자기 센터에 후보가 있는 줄만** 돌려준다.
- 투영 트리거도 함께 고쳤다: `userId` 없는 회원의 투영은 **만들지 않고, 있으면
  지운다.** 그러지 않으면 해제가 `userId` 를 비운 그 쓰기에 트리거가 반응해
  투영을 다시 만들고, 해제가 되돌려진다.
- 감사 두 종류 추가 (`member_link_created` · `member_link_removed`). 규칙의
  `auditActions()` 에는 넣지 않았다 — 서버만 쓰고 Admin SDK 는 규칙을 지나지 않는다.

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
      **5번 트리거(0-3)와 6번 연결 함수(0-4)도 끝났다. 다음은 8번 백필, 그다음 회원 앱.**
      패키징은 정해졌다: 공통 순수 모듈은 `functions/shared/*.mjs` 가 원본이고
      앱이 재수출로 가져다 쓴다 (복사 안 한다).
      **트리거·연결 함수는 아직 배포하지 않았다** — 백필과 함께 나간다.
      순서는 `docs/member-app-design.md` 10장: 투영 함수(끝) → 규칙(배포됨) →
      트리거(끝) → 연결 함수(끝) → 백필 → 회원 앱.
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
