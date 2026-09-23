# 회원용 조회 앱 — 설계

강사용 필라티처와 같은 Firebase 프로젝트를 쓰는 회원용 앱. 1단계는 **조회만**,
웹(PWA)으로 배포. 별도 서버 없음.

표기: **[있음]** 지금 코드에 있는 것 · **[신규]** 새로 만들 것

결정은 2026-09-23 에 전부 확정됐다 (9장).

---

## 1. 목적과 범위

회원이 "나 몇 회 남았지" 를 묻지 않아도 알게 한다. 지금은 카톡으로 묻고 강사가
앱을 열어 답한다.

| 회원이 보는 것 | 회원이 못 보는 것 |
| --- | --- |
| 남은 횟수 · 만료일 | 강사 수업기록 원문 (`lessonNotes`) |
| 내 회원권 목록 (차수·총 회차·서비스 회차) | 회차 단가 (`unitPrice` · `baseUnitPrice`) |
| 내 수업 이력 (날짜 · 담당 강사) | 급여 (`rule` · `netContractPrice` · 원장 전체) |
| 내 여정 (누적 진행) | 감사 로그 (`auditLogs`) |
| 담당 강사 이름 | 다른 회원의 무엇이든 |
| | 강사 풀방금액 · 부원장 여부 · 지점 운영 정보 |

**범위 밖**

- **그룹 수업은 다루지 않는다.** 그룹은 스튜디오메이트가 관리하고 이 앱은 PT 만 본다.
  회원이 두 앱을 쓰게 되는 것은 알고 가는 비용이다.
- 체형 사진 · 인바디 — 1단계 제외.
- 회원의 쓰기 — 예약 · 취소 · 메모 전부 없음. 1단계는 읽기 전용이다.

---

## 2. 가장 먼저 정해야 하는 것 — 규칙은 필드를 가리지 못한다

Firestore 규칙은 **문서 단위**로만 열고 닫는다. 필드를 골라 숨길 수 없다
(`functions/src/member-lookup.js` 머리말에 같은 이유가 적혀 있다).

`passes` 문서 하나에 `remainingCount`(회원이 볼 것)와 `baseUnitPrice`·
`netContractPrice`(급여 근거)가 같이 들어 있다. **회원에게 이 문서를 열면 단가가
함께 나간다.** 원장(`ledger`)은 더 심하다 — `unitPrice` 와 `rule` 이 항목마다 있다.

그래서 회원은 원본을 읽지 않는다. **회원용 투영 문서만 읽는다.**

### 투영을 누가 쓰는가

**1안 — Cloud Functions 트리거 (권장)** **[신규]**

`organizations/{org}/passes/{passId}` · `.../ledger/{entryId}` · `.../clients/{clientId}`
의 `onWrite` 에서 그 회원의 `memberViews/{clientId}` 를 통째로 다시 쓴다.

```
onWrite(passes/{passId})   → clientIds 전부에 대해 재작성
onWrite(ledger/{entryId})  → 그 pass 의 clientIds 전부에 대해 재작성
onWrite(clients/{clientId})→ 그 회원만 재작성
```

부분 수정이 아니라 **매번 통째로 다시 쓴다.** 증분으로 고치면 한 번 어긋난 값이
영영 남는다. 재작성은 그 회원의 `passes` 를 다시 읽어 만드므로 언제 돌려도 같은
답이 나온다.

**2안 — 강사 앱이 배치 안에서 함께 쓴다**

`issuePass` · `deductPass` · `correctDeduction` · `cancelPass` 가 이미 여러 문서를
한 배치로 쓴다. 거기에 투영 쓰기를 한 줄 더한다.

| | 1안 · Functions 트리거 | 2안 · 앱 배치 |
| --- | --- | --- |
| **신뢰 경계** | 서버가 쓴다. 규칙에서 투영 쓰기를 **전부 닫을 수 있다** | 앱이 쓴다. 강사 계정에 투영 쓰기 권한을 열어야 한다 |
| **앱 수정 범위** | 없음. 강사 앱을 건드리지 않는다 | 네 함수 + 규칙 + 리포지토리 테스트 |
| **비용** | 쓰기마다 함수 호출 1회 + 읽기 몇 건. 차감이 하루 수십 건이라 미미 | 추가 비용 없음 (같은 배치) |
| **실패 시 상태** | 원본은 남고 투영만 뒤처진다. **재시도·재생성이 가능** | 배치가 통째로 실패한다 — 차감 자체가 안 된다 |
| **어긋남 복구** | 트리거를 다시 돌리면 그 회원만 복구된다 | 원본을 다시 저장하는 수밖에 없다 |
| **이관분** | 이미 있는 회원권도 한 번 돌려 채운다 | 별도 백필 코드가 필요하다 |

**1안을 권한다.** 결정적인 것은 두 줄이다. **투영 쓰기를 규칙에서 완전히 닫을 수
있고**(앱이 쓰면 그 권한을 열어야 한다), **실패해도 차감이 막히지 않는다**(2안은
투영 쓰기가 실패하면 회원의 회차가 줄지 않는다 — 수업은 이미 한 뒤다).

투영이 잠깐 뒤처지는 것은 받아들인다. 회원 화면은 초 단위로 맞을 필요가 없고,
어긋나면 트리거를 다시 돌리면 된다.

### 투영 문서

경로: `organizations/{organizationId}/memberViews/{clientId}` **[신규]**

| 필드 | 출처 | 비고 |
| --- | --- | --- |
| `organizationId` · `clientId` | 그대로 | 규칙이 본다 |
| `userId` | `clients.userId` | 이 문서를 읽을 사람 |
| `name` | `clients.name` | |
| `locationName` | `locations.name` | id 가 아니라 이름 |
| `clientStatus` | `clients.status` | 종료 회원 안내에 쓴다 |
| `remainingTotal` | `passes` 합 | 쓸 수 있는 것만 |
| `nextExpiresAt` | `passes.expiresAt` 최솟값 | |
| `passes[]` | 아래 | 회원권 목록 |
| `history[]` | 아래 | 수업 이력 |
| `journey` | `buildPassJourney` 결과 | 계산을 두 번 쓰지 않는다 |
| `updatedAt` | 서버 시각 | 뒤처짐을 눈으로 본다 |

`passes[]` 한 건: `passId` · `purchaseRound` · `totalSessions` · `serviceSessions` ·
`remainingCount` · `expiresAt` · `status` · `isDuet` · `partnerName`

`history[]` 한 건: `occurredAt` · `type`(`deduct`·`correction`·`transfer`) ·
`instructorName`

**`contractPrice` 는 넣지 않는다** (확정 3번). 아래 금지 목록에 함께 둔다.

### 투영에 절대 넣지 않는 것

| 필드 | 있는 곳 | 이유 |
| --- | --- | --- |
| `baseUnitPrice` | `passes` | 급여 기준값 |
| `netContractPrice` | `passes` | 부원장 5:5 의 분모 |
| `unitPrice` | `ledger` | 그 회차의 급여 |
| `rule` | `ledger` | 어느 급여 판정이 이겼는가 |
| `category` | `passes` · `ledger` | 급여 카테고리. 회원에게 뜻이 없다 |
| `handedOver` · `serviceUsed` | `passes` | 급여 판정 입력 |
| `instructorId` · `createdBy` | 양쪽 | uid. 이름만 내보낸다 |
| `reason` | `ledger` (취소·보정) | 대표가 쓴 자유 문장 200자. 내부 사정이 들어간다 |
| `paymentMethod` | `passes` | 부가세 계산용. 회원에게 뜻이 없다 |
| `contractPrice` | `passes` | 확정 3번. 할인·양도가 섞이면 계약서와 달라 보인다 |
| `fullRoomRate` · `isDeputyDirector` | `memberships` | 강사 급여 |

**이 목록은 코드로 고정한다.** 투영을 만드는 함수가 허용 목록(allowlist)으로
필드를 고르고, 금지 목록이 결과에 없는지 테스트가 확인한다. 부정 목록만 두면
새 필드가 생길 때마다 조용히 새어 나간다.

---

## 3. 화면 넷

### 홈

| | |
| --- | --- |
| 보여줄 것 | 이름 · 남은 횟수 합 · 가장 이른 만료일 · 다음 수업(있으면) |
| 읽는 곳 | `memberViews/{clientId}` 의 `name` · `remainingTotal` · `nextExpiresAt` **[신규]** |
| 원본 | `clients.name` · `passes` 의 `remainingCount` · `expiresAt` · `status` **[있음]** |

만료 임박(잔여 3회 이하 또는 14일 이내)이면 문구를 바꾼다. 재등록을 권하는 말은
쓰지 않는다 — 판매는 센터가 한다.

### 회원권 목록

| | |
| --- | --- |
| 보여줄 것 | 차수 · 총 회차(`totalSessions` + `serviceSessions`) · 잔여 · 만료일 · 상태 |
| 읽는 곳 | `memberViews.passes[]` **[신규]** ← `passes` **[있음]** |
| 가리는 것 | `baseUnitPrice` · `netContractPrice` · `contractPrice` · `instructorId` |

금액은 전부 가린다 (확정 3번). 회원이 낸 돈이지만 할인·양도가 섞이면 계약서와
달라 보이고, 문의만 는다.

**듀엣 표시** — `passes.clientIds` 가 둘이면 듀엣이다 **[있음]**.
"30회를 두 분이 함께 씁니다 · 수업 한 번에 1회 차감" 은 반드시 적는다. 각자 30회로
오해하면 계약 자체가 틀어진다.
**상대 이름은 언제나 보여준다** (확정 2번). 숨김 옵션을 두지 않는다 — 듀엣은
처음부터 두 사람이 함께 등록하는 계약이라 서로 아는 사이다. 옵션을 두면 발급할
때마다 묻게 되고, 묻는 만큼 잘못 눌리는 자리가 는다.

### 수업 이력

| | |
| --- | --- |
| 보여줄 것 | 날짜 · 담당 강사 이름 · 차감 1회 |
| 읽는 곳 | `memberViews.history[]` **[신규]** ← `ledger` 의 `type` · `occurredAt` · `instructorId` **[있음]** |
| 가리는 것 | `unitPrice` · `rule` · `category` |

`correction` 항목은 **보여준다** — 잘못 차감했다 되돌린 사실은 회원의 것이다.
`transfer`(담당 교체)도 보여준다. `issue` · `cancel` 은 회원권 목록에 이미 있다.

강사 이름은 `memberships.displayName` **[있음]** 에서 온다. 원장은 `instructorId`
만 들고 있으므로 투영을 쓸 때 이름을 함께 박는다 — 강사가 퇴사해도 그때의 이름이
남아야 한다.

### 회원권 여정

| | |
| --- | --- |
| 보여줄 것 | 누적 진행을 한 줄로 · "앱 이전 기록" 구간 |
| 읽는 곳 | `memberViews.journey` **[신규]** ← `buildPassJourney` **[있음]** |

강사 앱의 `src/features/members/pass-journey.js` 가 이미 같은 값을 만든다. 계산을
두 번 쓰지 않는다.

**다만 그 모듈을 Functions 에서 그대로 부를 수 없다** (2026-09-23 확인).
`firebase.ai-gateway.json` 의 `"source": "functions"` 때문에 배포에는
`functions/` 만 올라가고, `require("../../src/...")` 는 클라우드에서 모듈을 찾지
못한다. 게다가 `pass-journey.js` 는 ESM 이고 `functions/` 는 CommonJS 다.

그래서 `buildMemberView` 는 계산을 **주입받는다** (`buildJourney`). 투영 함수는
순수한 채로 테스트되고 — 테스트는 저장소 안에서 도니 진짜 모듈을 `await import`
로 넣어 모양까지 확인한다 — 배포에 어떻게 넣을지는 트리거를 만들 때(10장 5번)
한 번 정한다. 길은 셋이다.

| | |
| --- | --- |
| predeploy 로 복사 | `firebase.json` 의 predeploy 훅이 빌드 전에 `functions/` 안으로 넣는다. 원본은 하나로 남는다 |
| 작은 패키지로 뺀다 | `pass-journey` 를 npm 워크스페이스 패키지로. 가장 깔끔하지만 손이 가장 많이 간다 |
| functions 안에 옮긴다 | 앱이 `functions/` 를 import 하게 뒤집는다. 앱 빌드에 Functions 디렉터리가 끼어든다 |

주입하지 않으면 `journey` 는 `null` 이고 화면은 그 줄을 그리지 않는다 — 지어낸
값을 넣는 것보다 없는 편이 낫다.

---

## 4. 계정 ↔ 회원 연결

### 이미 있는 것

| | |
| --- | --- |
| `ROLES.MEMBER = "member"` | `constants.js` **[있음]** |
| `isOwnClientDocument(data)` | 규칙 함수. `data.userId == request.auth.uid` **[있음]** |
| `clients` get 의 회원 분기 | 자기 문서 한 건을 읽는 문이 이미 있다 **[있음]** |

**그런데 `createClient` 는 `userId` 를 쓰지 않는다** **[있음, 미사용]**. 규칙은 그
필드를 기다리는데 아무도 채우지 않는다. **이미 등록된 회원 전부가 `userId` 가 비어
있다.** 연결이란 이 칸을 채우는 일이다.

### 회원 본인은 이 칸을 못 쓴다

`clients` 의 update 는 지금 `hasRole(["owner","manager","instructor","staff"])`
**[있음]** 이다. 회원에게 열면 자기 이름·연락처·상태까지 고칠 수 있고, 무엇보다
**`userId` 를 남의 문서에 써서 그 회원권을 볼 수 있다.** 열지 않는다.

그래서 서버 함수가 쓴다.

### `linkMemberAccount` — Callable Function **[신규]**

전화번호 인증을 마친 회원이 부른다. 인증 토큰은 Firebase Auth 가 검증하므로
**함수는 `request.auth.token.phone_number` 만 믿는다.** 클라이언트가 보낸 번호는
쓰지 않는다 — 보냈다면 그것은 남의 번호일 수 있다.

```
1. uid 와 인증된 전화번호를 꺼낸다. 없으면 unauthenticated
2. normalizePhone 으로 숫자만 남긴다 (clients.phone 과 같은 형식) [있음]
3. collectionGroup("clients").where("phone","==",번호) 로 찾는다
4. 결과 수에 따라 갈린다 (아래 표)
5. 성공이면 한 배치로 두 문서를 쓴다
     clients/{clientId}   userId 를 채운다 (투영 트리거가 이 값을 읽는다)
     memberLinks/{uid}    status "linked" · organizationId · clientId
6. 실패면 memberLinks/{uid} 에 사유만 남긴다
```

**회원에게 `memberships` 문서는 만들지 않는다.** 회원이 읽는 것은 투영과 자기
링크뿐이고, 그 둘은 `userId` 로 판정된다 — 소속 문서가 필요 없다. 만들지 않으면
role `member` 가 센터의 어느 문에도 닿지 않는다 (5장 참고).

`clients.userId` 를 채우는 것은 회원이 그 문서를 읽기 위해서가 아니라 **투영
트리거가 "이 투영을 누가 읽는가" 를 알기 위해서다.**

### `memberLinks/{uid}` **[신규]**

| 필드 | 값 |
| --- | --- |
| `userId` | 문서 id 와 같다 |
| `phone` | 인증된 번호, 숫자만 |
| `organizationId` · `clientId` | `linked` 일 때만 |
| `status` | `linked` · `not_found` · `ambiguous` · `ended` · `multi_location` |
| `candidateCount` | 찾은 회원 수. 대표 화면이 쓴다 |
| `linkedAt` · `linkedBy` | 대표가 손으로 이었으면 그 uid |

규칙: 본인 `get` 만. **쓰기는 전부 `false`** — 서버만 쓴다.

### 경우별 결과

| 찾은 수 | 상태 | 서버가 하는 일 | 회원이 보는 것 |
| --- | --- | --- | --- |
| 0건 | `not_found` | 링크 문서에 사유만 | "등록된 번호를 찾지 못했습니다. 센터에 문의해 주세요." 재시도 버튼 없음 |
| 1건, `status` active·hold | `linked` | 세 문서 배치 쓰기 | 홈으로 |
| 1건, `status` ended·deleted | `ended` | **연결은 한다.** 읽기 전용 | "이용이 종료된 회원권입니다." 지난 이력은 보여준다 |
| 2건 이상, **같은 지점** | `ambiguous` | **연결하지 않는다.** 대기 목록에 올린다 | "확인이 필요합니다. 센터에서 연결해 드립니다." |
| 2건 이상, **다른 지점** | `multi_location` | **전부 연결한다** (확정 7번) | 홈 상단에 지점 선택 칩. 잔여는 지점별로 따로 |

`ambiguous` 를 자동으로 잇지 않는 것이 이 설계의 핵심이다. 동명이인과 가족 공용
번호가 실제로 있다. 한 번 잘못 이으면 남의 회원권을 보게 되고, **그 사실은 아무도
모른다.**

### 대표가 손으로 잇는 문 **[신규]**

`ambiguous` 대기 목록에서 대표가 후보 중 하나를 고른다. 같은 함수가 쓰되 호출자가
owner 인지 보고, `linkedBy` 에 그 uid 를 남긴다. 누가 누구를 이었는지가 남아야
나중에 "왜 이 사람이 저 회원권을 봤나" 에 답할 수 있다.

### 연결을 끊는 문 **[신규]**

잘못 이었을 때 되돌릴 길이 있어야 한다. 대표만, `clients.userId` 를 지우고
`memberLinks` 를 `rejected` 로. 투영 문서도 그 자리에서 지운다 — `userId` 만
지우면 이미 깔린 투영을 그 사람이 계속 읽는다.

감사 항목을 함께 남긴다 — 연결과 해제는 남의 개인정보를 여닫는 일이다.

---

## 5. 규칙 변경 계획

**기존 owner · manager · instructor · staff 문은 하나도 건드리지 않는다.**
회원 문은 전부 새 `match` 블록이거나, 기존 블록에 `||` 로 붙는 분기다.

| 대상 | 변경 | 비고 |
| --- | --- | --- |
| `memberLinks/{uid}` **[신규]** | `allow get: if request.auth.uid == uid` · 쓰기 전부 `false` | Functions 만 쓴다 |
| `memberViews/{clientId}` **[신규]** | `allow get: if resource.data.userId == request.auth.uid` · list·쓰기 전부 `false` | 회원이 읽는 **유일한** 곳 |
| `clients` | **변경 없음** **[있음]** | 회원은 읽지 않는다 (아래) |
| `passes` · `ledger` | **변경 없음** | 회원에게 열지 않는다 (단가가 함께 나간다) |
| `lessonNotes` | **변경 없음** | 강사 원문. 2단계에서 별도 필드로 |

투영 문서가 `userId` 를 직접 들고 있어 규칙이 `get()` 을 부르지 않는다. 읽기 한
번에 판정이 끝난다.

`list` 는 닫는다. 회원은 자기 `clientId` 를 `memberLinks` 에서 알고 그 문서
하나만 읽는다 — 목록이 필요 없고, 열면 "내 것만" 을 증명할 필터를 요구하게 된다.

**회원에게 `memberships` 문서는 필요 없다.** `clients` get 이
`isActiveMember` 를 요구하지만 **회원은 `clients` 를 읽지 않는다** — 이름도
지점도 투영에 들어 있다. 소속 문서를 만들지 않으면 role `member` 가 센터 어느
문에도 닿지 않는다. 앱의 `addMembership` 도 그대로 둔다 **[있음]**.

규칙 함수 `isOwnClientDocument` 는 계속 쓰이지 않는다 **[있음, 미사용]**. 지우지는
않는다 — 2단계에서 회원이 자기 문서를 읽을 일이 생기면 그때 쓴다.

### 규칙 테스트로 고정할 것 **[신규]**

| # | 항목 |
| --- | --- |
| 1 | 회원이 자기 `memberViews` 문서를 읽는다 |
| 2 | 회원이 남의 `memberViews` 문서를 읽지 못한다 |
| 3 | 회원이 `memberViews` 를 목록으로 훑지 못한다 (list 닫힘) |
| 4 | 회원이 자기 `memberLinks` 를 읽고, 남의 것은 못 읽는다 |
| 5 | 회원이 `passes` 를 읽지 못한다 — 단가가 들어 있다 |
| 6 | 회원이 `ledger` 를 읽지 못한다 — 단가와 사유가 들어 있다 |
| 7 | 회원이 `lessonNotes` 를 읽지 못한다 — 강사 원문 |
| 8 | 회원이 `clients` 를 읽지 못한다 (연락처가 들어 있다) |
| 9 | 회원이 `memberViews` · `memberLinks` 에 쓰지 못한다 (create · update · delete) |
| 10 | 회원이 `clients` · `passes` · `ledger` 에 쓰지 못한다 |
| 11 | 회원이 `auditLogs` · `memberships` · `instructorClientTotals` 를 읽지 못한다 |
| 12 | 로그인하지 않은 사람은 위 전부 실패 |
| 13 | **강사·대표의 기존 문이 그대로 열린다 (회귀)** |

13번을 빠뜨리면 회원 문을 내다가 강사 문을 막아도 아무도 모른다.

---

## 6. 이관 안 된 지점

반송점만 이관됐다. 다른 지점 회원이 로그인하면 **번호는 맞는데 데이터가 없다**.

| 상태 | 화면 |
| --- | --- |
| `memberLinks.status == "not_found"` | "아직 준비 중입니다. 다니시는 지점이 곧 연결됩니다." |
| 연결됐지만 `passes` 가 0건 | "등록된 회원권이 없습니다. 센터에 문의해 주세요." |

**빈 화면을 보여주지 않는다.** 잔여 0회로 보이면 회원은 자기 회차가 사라진 줄 안다.
"없음" 과 "아직 안 들어옴" 은 다른 문구여야 한다.

---

## 7. 단계

| 단계 | 내용 | "끝났다" 의 기준 |
| --- | --- | --- |
| **1. 조회** | 반송점만 (확정 8번) · 전화번호 로그인 · 화면 넷 · 투영 · 규칙 | 반송점 회원 5명이 자기 잔여를 앱에서 확인. 규칙 테스트 13개 통과. 백필 전수 비교 0건 불일치. 강사에게 온 "몇 회 남았나" 문의가 2주간 줄어듦 |
| **2. 회원용 문구** | 수업 뒤 회원에게 보낼 한두 줄. **강사 원문과 별도 필드** | 강사가 확정 화면에서 문구를 고르거나 고쳐 보낼 수 있고, 원문이 단 한 줄도 새지 않음을 테스트가 고정 |
| **3. 포인트 · 알림 · 스토어** | 출석 포인트 · 만료 알림 · 네이티브 앱 검토 | 알림 수신 동의를 받은 회원에게 만료 7일 전 알림이 실제로 감. 스토어는 이때 다시 판단 |

2단계 문구 톤은 **격려 3 : 지식 1**. "오늘 스쿼트 자세가 좋아졌어요" 셋에
"코어는 이렇게 씁니다" 하나.

---

## 8. 위험

| 위험 | 대비 |
| --- | --- |
| **SMS 인증 비용** | Firebase Phone Auth 는 건당 과금. 회원 200명 × 재인증이면 무시 못 함. **인증 유효기간 90일** (확정 5번) |
| **SMS 도달 실패** | 알뜰폰·해외번호에서 안 오는 경우가 있다. 실패 코드를 그대로 보여주고, 3회 실패하면 "센터에 문의" 로 내린다. 무한 재시도 버튼을 두지 않는다 |
| **남의 번호로 조회 시도** | 인증을 통과해야 하므로 번호 소유자만 가능. 다만 가족 공용 번호는 `ambiguous` 로 막힌다 — 자동 연결하지 않는 이유다 |
| **개인정보 최소화** | 투영에 담는 것은 화면이 쓰는 값뿐. 연락처·주소·생년월일은 투영에 넣지 않는다 |
| **잔여가 종이장부와 다름** | 앱이 맞다고 하지 않는다. "화면과 다르면 센터에 문의해 주세요. 확인 후 정정해 드립니다." 원장은 append-only 라 대표가 보정 항목을 남기면 이력에 보인다 |
| **투영이 원본과 어긋남** | 원본을 바꾸는 길이 넷뿐이고 전부 한 배치다. 배치에 투영을 넣으면 갈라질 수 없다. 넣지 않고 트리거로 하면 갈라진다 — **배치 안에 넣는다** |

---

## 9. 확정 결정 — 2026-09-23

대표 확정. 바꾸려면 이 표를 먼저 고친다.

| # | 항목 | 확정 |
| --- | --- | --- |
| 1 | 투영을 누가 쓰는가 | **Cloud Functions 트리거** (1안) |
| 2 | 듀엣 상대 이름 | **언제나 표시.** 숨김 옵션 없음 |
| 3 | 계약 금액 | **표시하지 않음** |
| 4 | 담당 강사 이름 | **표시** |
| 5 | 재인증 주기 | **90일** |
| 6 | `ambiguous` 대기 목록 | **1단계 대표만.** 2단계에 FC매니저 확장 (아래) |
| 7 | 여러 지점 등록 회원 | **전부 연결** · 지점 선택 칩 |
| 8 | 1단계 대상 | **반송점만** |

### 6번의 2단계 — 담당 지점 회원만

FC매니저에게 대기 목록을 열 때는 **그 FC매니저가 맡은 지점의 회원만** 보인다.
한 사람이 여러 지점을 맡을 수 있으므로 **`memberships.locationIds` (목록)** 로
설계한다.

지금 소속 문서에는 `locationId` 하나뿐이다 **[있음]** — 규칙도 문자열 하나만
받는다. 목록은 새로 낸다 **[신규]**.

**선행 조건: 대표가 강사 관리 화면에서 이 목록을 정할 수 있어야 한다** **[신규]**.
그 화면이 없으면 목록이 비어 있고, 비어 있는 목록으로 거르면 FC매니저에게 아무것도
안 보인다. 순서는 이렇다.

1. `memberships.locationIds` 를 규칙이 받게 한다 (배열, 문자열 원소)
2. 강사 관리 → 수정에 담당 지점 다중 선택을 넣는다
3. 대기 목록을 `locationIds` 로 거른다
4. 그때 대기 목록 진입점을 FC매니저에게 연다

1·2 가 끝나기 전에는 4 를 하지 않는다. 이 순서가 어긋나면 FC매니저가 빈 화면을
보거나, 더 나쁘게는 전 지점 회원을 본다.

handoff 의 "매니저 지점 고정" 항목과 같은 일이다. 한 번에 한다.

---

## 10. 1단계 구현 계획

코드는 아직 쓰지 않았다. 순서와 파일만 적는다.

| 순서 | 무엇 | 파일 | 왜 이 순서 |
| --- | --- | --- | --- |
| 1 | 투영 만드는 순수 함수 | `functions/src/member-view.js` **끝남 (2026-09-23)** | 허용 목록으로 필드를 고른다. 트리거 없이 테스트할 수 있다 |
| 2 | 그 함수의 테스트 | `functions/tests/member-view.test.js` **끝남 · 28개** | 금지 필드가 결과에 없는지. 여기가 개인정보의 유일한 관문이다 |
| 3 | 규칙 | `firestore.foundation.rules` | `memberViews` · `memberLinks` 두 블록 추가. 기존 문은 손대지 않는다 |
| 4 | 규칙 테스트 13개 | `tests/rules/firestore.rules.test.js` | 5장 목록. 배포 전에 `npm run test:rules` |
| 5 | 트리거 | `functions/src/member-view-triggers.js` **[신규]** | `passes` · `ledger` · `clients` 의 onWrite. **여기서 pass-journey 배포 방식을 정한다** (3장) |
| 6 | 연결 함수 | `functions/src/member-link.js` **[신규]** | `linkMemberAccount` · 대표가 잇는 문 · 끊는 문 |
| 7 | 그 함수의 테스트 | `functions/tests/member-link.test.js` **[신규]** | 경우 다섯 (0건·활성·종료·같은 지점 중복·여러 지점) |
| 8 | 백필 | `tools/backfill-member-views.mjs` **[신규]** | 11장 |
| 9 | 회원 앱 | 별도 Vite 앱 **[신규]** | 화면 넷. 마지막에 온다 |

1·2 를 먼저 두는 이유: **투영 함수가 개인정보의 유일한 관문이다.** 그것이 맞으면
나머지가 틀려도 새어 나가지 않고, 그것이 틀리면 나머지가 다 맞아도 새어 나간다.

9 를 마지막에 두는 이유: 앞의 여덟이 끝나면 회원 앱은 문서 하나를 읽어 그리는 일이
된다. 앞이 덜 선 채로 화면부터 만들면 가짜 데이터로 만들게 된다.

**강사 앱은 한 줄도 고치지 않는다.** 트리거 방식을 고른 이유가 그것이다.

---

## 11. 백필 — 이미 있는 데이터

트리거는 앞으로의 쓰기만 잡는다. 반송점의 이관분과 지금까지 발급·차감된 것에는
투영이 없다. 한 번 돌려 채운다.

**실행 주체: 대표, PC 에서.** Functions 로 두지 않는다 — 한 번 쓰는 도구이고,
잘못 돌았을 때 멈출 사람이 화면 앞에 있어야 한다.

```bash
node tools/backfill-member-views.mjs --dry-run
```

```bash
node tools/backfill-member-views.mjs
```

**건조 실행이 먼저다.** 아무것도 쓰지 않고 몇 건을 만들지, 어느 회원이 빠지는지만
출력한다. 이관과 같은 규칙이다 — 되돌릴 수 없는 것은 먼저 보여준다.

| 단계 | 내용 |
| --- | --- |
| 1 | `clients` 를 읽는다 (반송점만, 확정 8번) |
| 2 | 회원마다 `passes` · `ledger` 를 읽어 1번 함수로 투영을 만든다 |
| 3 | `--dry-run` 이면 여기서 멈추고 표만 찍는다 |
| 4 | 아니면 `memberViews/{clientId}` 에 쓴다. 이미 있으면 덮어쓴다 — 투영은 언제 만들어도 같은 답이다 |
| 5 | 끝나고 전수 비교를 돌린다 |

### 검증 — 전수 비교

```
회원마다:  memberViews.remainingTotal  ==  passes 에서 다시 센 잔여
```

**표본이 아니라 전수다.** 회원 200명이고 한 번 하는 일이라 비용이 문제되지 않는다.
한 건이라도 다르면 그 `clientId` 를 찍고 멈춘다.

잔여는 "쓸 수 있는 회원권" 만 센다 (`activeRemainingTotal` **[있음]** 과 같은 계산)
— 만료·취소된 것을 더하면 화면이 실제보다 많다고 말한다.

`passes[]` 건수와 `history[]` 건수도 함께 센다. 잔여만 맞고 이력이 비어 있는 경우가
있을 수 있다.

### 백필이 끝났다는 기준

- 건조 실행의 예상 건수와 실제 쓴 건수가 같다
- 전수 비교 불일치 **0건**
- 반송점 회원 중 `clients.userId` 가 채워진 사람은 자기 투영을 읽을 수 있다
