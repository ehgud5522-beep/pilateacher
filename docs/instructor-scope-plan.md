# 강사가 보는 회원의 범위 — 설계와 구현 순서

강사는 본인 회원만 본다. 화면에서 거르는 것이 아니라 **데이터와 규칙에서** 막는다.

이 문서는 구현 중에 계속 보는 자리다. 결정과 이유, 확인한 사실, 배포 순서가 있다.

---

## 0. 왜 화면이 아니라 데이터인가

화면에서 거르면 **폰에는 여전히 106명이 내려온다.** 강사 기기 한 대가 털리면 센터
전체 명부가 나가고, 그것은 우리가 막을 수 있었던 일이다. 화면 필터는 보여주지
않을 뿐 주지 않은 것이 아니다.

---

## 1. 지금 강사 기기가 전체 회원을 받는 경로 (확인함)

```
listClients()                       src/data/repositories/client-repository.js:130
  → store.list(orgs/{org}/clients)
  → getDocs(collection(...))        조건 없는 컬렉션 통째 읽기
```

지점·검색·종료 필터는 **전부 받은 뒤 기기에서** 건다. 규칙도 열려 있다.

```
firestore.foundation.rules:345
allow list: if hasRole(organizationId, ["owner", "manager", "instructor", "staff"]);
```

함수 주석이 이미 이 날을 예고해 두었다 — "규모가 커지면 여기부터 서버 쿼리로 옮긴다."

### 기기에 명부가 두 벌이다

| | 어디 | 무엇이 본다 |
| --- | --- | --- |
| `db.members` | localStorage + `users/{uid}/backup/latest` | 일정, 월간 리포트 (레거시) |
| Firestore `clients` | 센터 | 회원권, 원장, 회원 앱 |

**3단계의 "기기에서 삭제" 는 `db.members` 쪽이다.** 둘을 섞으면 센터 기록을 지운다.

---

## 2. `instructorIds` — 무엇을 담는가

`clients` 문서의 배열. **Admin SDK 트리거만 쓴다.** 클라이언트 쓰기는 규칙이 막는다.

### 규칙

1. **살아 있는 회원권의 담당강사 전부.** 살아 있다 = `status: active` 이고 잔여 > 0
   이고 만료일이 안 지났다.
2. **살아 있는 것이 하나도 없으면 — 가장 최근 회원권의 담당강사 한 명.**
   **기한 없이 남는다.** 만료 회원도 담당이 있어야 재등록 상담을 한다.
3. **듀엣은 `clientIds` 두 명 모두** 그 회원권의 담당강사를 갖는다.
4. 다른 강사에게 새 회원권이 나가면 (재등록·인수인계) 그 강사가 들어오고, 이전
   강사는 **자기 회원권이 끝나는 순간** 빠진다.

> 4번이 "즉시 빠짐" 이 아닌 이유: A 의 회원권이 아직 살아 있는데 B 가 새로 발급한
> 경우, A 는 아직 그 회원을 가르치고 있다. 인수인계(`transfer`)는 회원권의
> `instructorId` 자체가 바뀌므로 A 가 **그 순간** 빠진다 — 규칙 1 로 자연히 그렇게
> 된다. 별도 처리가 필요 없다.

### 갱신 시점

발급 · 인수인계(`transfer`) · 양도(`handover`) · 종료 · 취소. 즉 `passes` 문서가
써질 때마다. `rebuildMemberViewOnPassWrite` 와 같은 자리다.

### 담당 없는 회원은 어떻게 되나

`instructorIds` 가 빈 배열이면 **아무 강사도 못 본다.** 대표·FC만 본다.

`createdBy` 를 씨앗으로 넣지 않기로 했다 — 회원 등록은 대표·FC만 하므로 강사
이름이 거기 들어갈 일이 없다.

**체험 수업은 0원 "기타" 1회 회원권 발급으로 처리한다.** 발급 순간 담당강사가
정해지므로 그때 `instructorIds` 에 들어간다.

#### 지금 발급 화면으로 되는가 — 확인함, 된다

| 검사 | 자리 | 결과 |
| --- | --- | --- |
| 세션 1회 | `totalSessions` min 1 | 통과 |
| 계약 0원 | `contractPrice` min 0 | 통과 |
| 발급 화면 세션 | `Number(form.totalSessions) >= 1` | 통과 |
| 발급 화면 금액 | 빈 칸만 막음, `0` 은 통과 | 통과 |
| 기타 카테고리 | `PAY_CATEGORY.ETC`, 회당 단가를 손으로 받음 | 있음 |

**단, 상품이 먼저 있어야 한다.** 발급 화면은 상품을 고르게 되어 있다
(`if (!product)`). 회원권 상품에 **"체험 1회 · 0원 · 기타"** 를 한 번 만들어 두면
그 뒤로는 고르기만 하면 된다. 상품 화면도 0원·1회를 허용한다 (`manwon < 0` 만 막음).

### 파생값이라 복구 경로가 필요하다

`instructorIds` 는 `passes` 에서 만든 값이다. 트리거가 한 번 실패하면 **강사가
회원을 잃는다.** `memberViews` 와 같은 구조이므로 같은 안전장치를 둔다 —
재빌드 callable 과 검증 callable. 채우기는 일회용이 아니라 **상시 재빌드**다.

---

## 3. 만료 회원

### 분류

**만료 회원 = 살아 있는 회원권이 하나도 없는 회원.**

| 사유 | 판정 | 만료일 |
| --- | --- | --- |
| **소진** | 잔여 0 | 마지막 차감일 (원장에서) |
| **기간 만료** | 잔여 > 0 인데 만료일이 지남 | `expiresAt` |

회원권이 여러 장이면 **가장 최근에 끝난 것**의 사유와 날짜를 쓴다.

> 소진의 만료일은 회원권 문서에 없다. 원장의 마지막 `deduct` 의 `occurredAt`
> 이다. 0단계 함수는 이 값을 인자로 받고, 트리거가 원장을 읽어 넣는다.

### 회원 탭

칩을 **운영중 / 만료** 로 가른다. 기본은 운영중.

### 재등록

**만료 후 30일 안에 같은 회원에게 새 회원권이 나가면 재등록이다** (담당 누구든).

경계는 테스트로 못 박는다 — 29일 재등록, 30일 재등록, 31일 아님.

### 두 개의 질문을 섞지 않는다 (구현하면서 드러난 것)

| | 묻는 것 | 함수 |
| --- | --- | --- |
| **회원 탭 만료 칩** | 지금 만료 회원인가 | `clientExpiry` |
| **내 만료 회원 현황** | 언제 만료했었나 | `expiryEventsFor` → `summarizeExpiries` |

돌아와서 다시 다니는 회원은 **회원 탭에서 운영중이고 현황에서는 재등록**이다.
둘 다 맞다. 한 함수로 뭉개면 둘 중 하나가 반드시 틀린다.

만료 사건은 **끝난 회원권마다 하나**다. 마지막 만료만 보면 돌아왔다가 또 만료한
회원이 "재등록 안 함" 으로 세어진다 — 0단계 테스트가 이것을 잡았다.

### 아직 30일이 안 지난 건은 "안 돌아옴" 이 아니다

만료한 지 사흘 된 회원을 안 돌아온 것으로 세면 **이번 달 재등록률이 늘 낮게
나온다.** 달이 끝나야 참값이 되는 숫자를 달 중간에 보고 판단하게 된다.

그래서 결과를 셋으로 나눈다 — `returned` · `gone` · `pending`. **비율의 분모에서
`pending` 을 뺀다.** 화면도 "아직 기다리는 중 N명" 을 함께 보여준다.

---

## 4. 강사 "내 만료 회원" 현황

이번 달 / 지난달 / 전체. 만료 회원 수, 그중 재등록 수, 재등록률.

목록: 이름 · 만료일 · 사유 · 재등록 여부.

- **센터 회원권 기준.** 기기 데이터는 쓰지 않는다.
- **인수인계로 옮겨간 회원은 이전 강사 숫자에서 뺀다.**
- 대표 화면은 강사별로 같은 표를 본다 (비교용).
- **두 화면이 같은 함수를 쓴다.** 테스트로 고정한다.

---

## 5. 지금 강사에게 열려 있는 곳 — 전수 (확인함)

| 경로 | 지금 강사 권한 | 조여야 하나 |
| --- | --- | --- |
| `organizations/{org}` | read | 아니오 |
| `…/clients/{id}` | **get·list 전체** | **예** |
| `…/passes/{id}` | **read 전체** | **예** |
| `…/passes/{id}/ledger/{id}` | read 전체 | **예** |
| `{path=**}/ledger/{id}` (그룹) | `instructorId == uid` | **이미 됨** |
| `…/lessons/{id}` · `participants` | **read 전체** | **예** |
| `…/lessonNotes/{id}` | **list 전체** | **예** |
| `…/locations/{id}` | get·list | 아니오 (지점 이름) |
| `…/products/{id}` | read | 아니오 (상품 목록) |
| `…/instructorClientTotals/{id}` | **read 전체** | **예 — D** |
| `assessments` | **read 전체** | **예** |
| `assessmentMedia` | **read 전체** | **예** |
| `inbodyMeasurements` | **read 전체** | **예** |
| `exercisePrograms` · `exerciseHistory` | **read 전체** | **예** |
| `memberGoals` · `memberProgress` | **read 전체** | **예** |
| `aiRecommendations` · `aiFeedback` · `outcomes` | **read 전체** | **예** |
| `memberships` | 조건부 | 아니오 |
| Storage `users/{uid}/photos/**` | **본인 uid 만** | **이미 됨** |

원장 그룹 쿼리와 Storage 사진은 이미 본인 것만 열린다. 변화 기록 계열 8개가
`hasRole(instructor)` 한 줄로 센터 전체가 열려 있다 — 여기가 제일 넓다.

---

## 6. 추가로 반영할 것 (A ~ D)

### A. 기기 명부 청소와 백업

#### 먼저: `db.members` 는 센터 회원 전체 사본이 **아니다** (확인함)

**"만진 회원만" 쌓이는 희소한 명부다.**

- 기기에서 만든 레거시 회원 (조직이 생기기 전, 또는 이 강사가 등록한)
- 조직 회원은 **강사가 무언가 쓸 때만** 행이 생긴다 — `App.jsx:21833` 의
  `patch()` 와 `App.jsx:21922` 의 수업기록 저장이 `{ id: clientId, name, phone }`
  행을 그 자리에서 만든다. 주석이 그대로 말한다: "조직에만 있는 회원은 기기에
  행이 없다 … 그 자리에서 행을 만든다"

**회원 탭의 "전체 106명" 은 저장된 숫자가 아니다.** `App.jsx:20743` 의
`mergeRoster({ clients: rosterClients, members: db.members, … })` 가 화면을
만들 때 계산한다. `rosterClients` 는 `listClients()` 의 전체 읽기이고 **React
state 에만 있다.** `useMemo` 라 어디에도 저장되지 않는다 — 앱을 닫으면 사라진다.

**그래서 106명 노출은 메모리에만 있다.** 2단계에서 쿼리를 `array-contains` 로
좁히는 순간 저절로 사라지고, 그 부분은 지울 것이 없다.

기기에 실제로 남는 것은 훨씬 작은 집합 — **강사가 만진 조직 회원**이고, 이들이
`id = clientId` 와 이름·연락처를 들고 있다. 청소 대상은 이것이다.

#### 지우는 대상

**센터 clientId 와 연결됐고 + 내 `instructorIds` 밖인 회원만.**

센터 회원과 연결되지 않은 로컬 회원(`clientId` 없음, 매칭 실패 =
`ROSTER_SOURCE.LOCAL_ONLY`)은 **지우지 않는다.** 그 회원은 강사 기기에만 있고,
지우면 센터 어디에도 남지 않는다.

→ 대표 화면에 **"미연결 회원 N명"** 을 표시한다. 센터가 모르는 회원이 강사
기기에 몇 명 있는지는 대표가 알아야 하는 숫자다.

#### 지우기 전에 반드시 검사한다

그 회원에 붙은 **강사 작성 기록이 Firestore 에 다 있는지** 본다 — 수업기록,
목표, 인바디, AI 메모, 그리고 **사진**.

**사진이 진짜 위험이다.** `roster-bridge.js` 머리말이 말한다: "수업 기록은
레거시 회원 객체 안(`member.notes`)에 있고, 사진과 체형분석은 회원 id 를 키로
하는 별도 저장소(`photos[id]`)에 있다." **클라우드 사진 백업은 선택 기능이다**
(`onEnablePhotoBackup`). 켜지 않은 강사의 회원을 지우면 그 사진은 **어디에도
없다.**

하나라도 센터에 없으면 **그 회원은 지우지 않는다.** 먼저 올리고 다음 실행 때
청소한다.

→ 검사에 걸린 회원은 대신 **`hiddenClientIds` 로 숨긴다.** 이미 있는 비파괴
수단이고(`App.jsx:20757`), 화면에서만 안 보이며 되돌릴 수 있다. 목록은 짧아지고
데이터는 그대로 남는다.

#### 되돌릴 사본을 먼저 만든다

`allowDestructiveOverwrite` 를 쓰기 전에 **청소 직전 백업을 한 벌 남긴다.**

```
organizations/{organizationId}/scopeSnapshots/{uid}_{yyyy-mm-dd}
  대표만 읽기 · 클라이언트 쓰기 금지 (Admin SDK callable 만)
  expireAt 필드 + Firestore TTL 로 90일 뒤 삭제
```

**`users/{uid}` 밑에 두지 않는다.** 거기 두면 강사가 남의 회원 기록을 계속
가지게 된다 — 이 작업 전체가 없애려는 것이 그것이다. 그래서 조직 쪽이고 대표
전용이다.

**사본이 만들어진 뒤에만 덮어쓴다.** 사본 쓰기가 실패하면 청소하지 않는다.

#### 그 다음에야 백업 보호를 한 번 연다

백업은 `users/{uid}/backup/latest` **한 문서**를 `transaction.set` 으로
덮어쓴다. 버전이 따로 남지 않으므로 청소 후 다음 백업이 덮으면 끝난다.
규칙은 `match /backup/{backupId}` 로 열려 있지만 **코드가 쓰는 것은 `latest`
하나뿐이다.**

**그런데 덮어쓰기 보호가 막는다.**

```
src/features/backup/cloud-backup.js:59
if (localCounts.members > 0 && cloudCounts.members >= 10
    && localCounts.members < cloudCounts.members * 0.5) reasons.push("members_mass_decrease");
```

회원이 절반 미만으로 줄면 걸린다. `members_empty` 도 있다 — 담당 회원이 없는
강사는 0명이 되어 역시 막힌다. 그대로 두면 **청소가 백업을 조용히 고장 낸다.**

→ 청소 직후 **그 한 번만** `allowDestructiveOverwrite: true` 로 올린다. 이유를
남기고, 그 뒤 백업은 다시 보호 아래로 돌아온다.

#### 강사에게 한 번 말한다

> 담당이 아닌 회원 N명을 이 기기에서 정리했어요 (센터 기록은 그대로)

조용히 사라지면 강사는 앱이 고장 났다고 읽는다. 한 번만 보여주고 다시 띄우지
않는다.

#### 테스트

- 미연결 회원(`LOCAL_ONLY`)은 보존된다
- 센터에 없는 기록(사진 포함)이 있는 회원은 보존된다
- **사본이 만들어진 뒤에만** 덮어쓰기가 일어난다 — 사본 실패 시 청소하지 않는다
- 사본은 대표만 읽는다 (규칙 테스트)

### B. Firestore 오프라인 캐시 — **비울 것이 없다**

`src/lib/firebase.js:77` 이 `getFirestore(app)` 만 부른다. `initializeFirestore`
도 `enableIndexedDbPersistence` 도 `persistentLocalCache` 도 **저장소 전체에
없다.** Firebase JS SDK 의 기본은 메모리 캐시다 — 앱을 닫으면 사라진다.

→ **캐시 비우기는 만들지 않는다.** 없는 것을 비우는 코드는 다음 사람에게
"여기 뭔가 남는구나" 라고 잘못 말한다. 대신 이 사실을 여기 적어 둔다.

### C. 인수인계 후 이전 강사의 급여 상세

**원장에 회원 이름이 없다.** 규칙의 `hasOnly` 가 이름 필드를 아예 막는다
(`firestore.foundation.rules:741`). 이름은 `clients` 를 읽어 붙인다.

조인 후 이전 강사는 그 회원을 못 읽으므로 이름이 빈다.

→ 이름을 못 읽은 줄은 **"인수인계된 회원"** 으로 표시한다. 금액은 그대로 맞다.
**이름을 원장에 복사하지 않는다** — append-only 라 틀린 이름은 영영 못 고친다.

### D. `instructorClientTotals`

문서 id 가 `{instructorId}_{clientId}` 이고 `instructorId` 필드가 있다.

→ `resource.data.instructorId == request.auth.uid` 로 좁힌다. 듀엣 단가 판정이
읽는 것은 **본인 instructorId** 의 문서뿐이라 깨지지 않는다.

---

## 7. 구현 순서

### 0단계 — 기준 함수 (커밋 1)

- `src/data/schema/instructor-scope.js` (새)
- `tests/members/instructor-scope.test.js` (새)
- 이 문서 + `docs/handoff.md` 링크

### 1단계 — 트리거 + 채우기 (커밋 2)

- `functions/src/instructor-scope.js`, `functions/src/instructor-scope-triggers.js` (새)
- `functions/src/index.js` — `syncInstructorIdsOnPassWrite` 트리거,
  `rebuildInstructorIds` · `verifyInstructorIds` callable (대표 전용)
- 규칙: `clients` 에 `instructorIds` 허용 + **클라이언트 쓰기 금지**
- 테스트: 트리거 단위 + 규칙 "클라이언트가 못 쓴다"

### 2단계 — 앱 (커밋 3~6, 빌드 60에 포함)

- `client-repository.js` — `listClients(org, { instructorId })` →
  `where("instructorIds", "array-contains", uid)`
- `App.jsx` — 회원 탭 · 검색 · 일정 추가 · 변화 기록 · 발급 · 급여 상세가 전부
  같은 인자를 넘긴다
- 회원 탭 칩 **운영중 / 만료**, 만료 사유 표시
- "내 만료 회원" 현황 + 대표의 강사별 표 (같은 함수)
- 기기 청소: `src/features/members/device-roster-prune.js` (새) + **A 전체** --
  대상 한정 · 기록 존재 검사 · scopeSnapshots 사본 · 백업 보호 한 번 열기 · 강사 안내
- 대표 화면에 "미연결 회원 N명"
- 월간 리포트를 원장 기준으로 통일 (항목 3)
- 더보기 → 센터 정보 대표 전용 (항목 2)
- **앱 버전 기록**: `memberships` 에 `appVersion` · `appBuild` · `lastSeenAt`,
  대표 화면에 강사별 목록

### 3단계 — 규칙 (커밋 7, **대표 지시가 있을 때만 배포**)

- 5장 표의 "예" 전부 + C · D
- 테스트: 강사 A ↛ B 회원 (목록·검색·일정·변화기록·사진), 인수인계 후 차단,
  듀엣 둘 다, 대표·FC 전체

---

## 8. 배포 순서와 위험

```
① 트리거 + 채우기 배포 → 채우기 실행 → 검증 (모든 활성 회원에 instructorIds 있음)
② 앱 60 출시 → 강사 전원 업데이트 확인
③ 규칙 배포                          ← 대표가 지시할 때만
```

### 57 · 59 가 ③ 이후 어떻게 깨지나 — **전체 실패다**

`listClients` 는 조건 없는 `getDocs` 다. `array-contains` 를 요구하는 규칙
아래서는 **쿼리 자체가 거부된다.** 몇 명만 빠지는 것이 아니라 목록이 통째로 안
온다.

깨지는 화면: 회원 탭 · 회원 검색 · 일정 추가 회원 선택 · 회원권 발급 · 급여
상세의 이름 · 변화 기록 · 엑셀 이관. 사실상 **강사 앱 전체**다.

대표 · FC매니저는 안 깨진다 (전체 분기가 남는다).

### 그래서 앱 버전 기록이 먼저다

지금은 강사가 업데이트했는지 알 방법이 **없다.** 없으면 ③ 을 감으로 누르게 된다.

로그인할 때 `memberships/{org}_{uid}` 에 `appVersion` · `appBuild` · `lastSeenAt`
만 쓴다. 규칙은 **본인 문서의 그 세 필드만** 허용한다. 대표 화면이 강사별로
줄을 세운다 — 전원 60 이상이 보이면 그때 ③ 이다.

---

## 9. 테스트로 못 박을 것

- 소진 · 기간 만료 구분
- 만료 후에도 마지막 담당 강사에게 보임 (기한 없음)
- 30일 경계 — 29일 재등록, 30일 재등록, 31일 아님
- 인수인계 시 이전 강사의 목록과 숫자에서 빠짐
- 듀엣은 두 명 모두 보임
- 강사 A 가 B 회원을 목록 · 검색 · 일정 추가 · 변화 기록 · 사진 어디서도 못 읽음
- 대표 · FC 는 전체
- 강사 화면과 대표 화면의 만료 · 재등록 숫자가 **같은 함수**를 쓴다
- 미연결 회원(LOCAL_ONLY)은 청소에서 보존된다
- 센터에 없는 기록(사진 포함)이 있는 회원은 청소에서 보존된다
- scopeSnapshots 사본이 만들어진 뒤에만 덮어쓰기가 일어난다
- scopeSnapshots 는 대표만 읽는다
- 일정 탭과 월간 리포트의 금액이 **같은 값**을 쓴다
