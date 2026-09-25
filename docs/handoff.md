# 이어서 작업하기 — 최근 변경과 남은 일

Claude Code · Codex 가 새 세션을 열면 이 파일부터 읽는다. 작업을 끝낼 때마다
맨 위 "최근 변경"을 갱신하고, 끝난 "남은 일"은 지운다.

- 작업 위치: `.codex-worktrees/h5-ios-audio-camera` · 브랜치 `docs/app-review-account`
  (PR #12 는 2026-09-24 에 main 으로 병합됐다 — `59b81a6`)
- 웹: https://pilateacher.web.app — 배포는 `npm run deploy:web` (호스팅만 나간다)
  배포 전에 멈추는 조건이 둘 있다 (`tools/deploy-guard.mjs`): 브랜치가
  `main` · `docs/app-review-account` 가 아니거나, 커밋되지 않은 변경이 있으면
  (package-lock.json 만 예외) 빌드 전에 이유를 적고 멈춘다. 늘리려면 그 파일의
  `DEPLOYABLE_BRANCHES` 하나만 고친다.
- 규칙 배포는 따로다: `npm run test:rules` 통과 후
  `npx firebase deploy --only firestore:rules --project pilateacher --config firebase.foundation.json`

## 최근 변경 (2026-09-23, Cowork 세션)

### 0-18. 센터에 못 간 쓰기를 말하게 한다 (2026-09-25)

**규칙은 숫자로 잠갔고 배포됐다** (`b1b951f`). 값 비교(immutable)로 막으면
옛 철자를 든 기기가 회원 메모를 고칠 때 그 수정이 통째로 거부된다 -- 스토어에
나가 있는 AAB 57 이 바로 그 상태다. 숫자로 막으면 진짜 변경만 걸린다.
`String.replace` 가 RE2 를 받는다는 것을 에뮬레이터로 확인했다.

**그 과정에서 드러난 것: 재시도 큐는 재시도하지 않는다.**

`RetryMetadataStore` 는 페이로드를 담지 않고, 그 목록을 읽는 곳은 계정 삭제
정리 하나뿐이다. 다시 보내는 루프가 없다. 그러면서 코디네이터는 실패를 잡아
`secondary: "queued"` 로 **성공처럼** 돌려주었고, 화면은 "저장했습니다" 라고
말했다 -- 강사는 저장된 것으로 알았고 센터에는 안 갔다.

이름을 `PendingWriteLog` 로 바꿨다. 옛 이름은 별칭으로 남겨 두었다.

| 실패 종류 | 이제 하는 일 |
| --- | --- |
| 영구 (`permission-denied` · `invalid-argument` · `failed-precondition` · `not-found` · `unauthenticated`) | 기록에 쌓지 않고 **그 자리에서** "○○ 회원의 회원 정보가 센터에 저장되지 않았어요 — 대표님께 알려주세요 (코드 …)" |
| 일시 (나머지) | 기록에 남기고 화면 위에 **"센터에 아직 안 간 변경 N건"**. 누르면 회원·항목·코드 |

다시 보내는 코드는 여전히 없다. **사람이 그 회원을 다시 저장하는 것이 유일한
복구 수단**이고, 그때 같은 열쇠가 지워져 숫자가 준다. 그 사실을 화면이 적는다:
"그 회원을 다시 저장하면 올라갑니다."

---

## 남은 일 — 진짜 재시도 (B)

**이번에 만들지 않았다.** 지금은 실패를 **말하기만** 한다.

만들려면 **페이로드를 저장**해야 하고, 그 순간 새 위험이 생긴다: 다른 기기가
그 사이에 더 새로운 값을 썼으면 **옛 값으로 덮어쓴다.** 기기마다 명부가 따로인
이 앱에서 그것은 가정이 아니라 일어날 일이다.

만든다면 함께 있어야 하는 것:

- 저장할 페이로드와, 그것이 만들어진 시각
- 보내기 직전에 서버의 `updatedAt` 을 읽어 **더 새로우면 버린다**
- 버린 것을 조용히 두지 않는다 -- 그것도 사람에게 알려야 하는 사실이다
- 몇 번 만에 포기할 것인지. 영원히 도는 큐는 비용만 쌓인다

지금 구조(실패 기록 + 사람이 다시 누름)로도 복구는 된다. 자동화는 위 넷을
정한 뒤에 한다.

### 0-17. 연락처 수정 · 회원권 양도 — 배포됨 (2026-09-25)

한 번에 셋이 나갔다. **규칙 → Functions → 웹** 순서가 중요했다: 규칙이 먼저
나가야 앱이 `clients.phone` 을 쓰지 못하고, 앱이 먼저 나가면 [양도]·[연락처
수정] 이 보이는데 눌러도 거부된다.

| 나간 것 | 무엇 |
| --- | --- |
| 규칙 | `handover` 원장 종류 · `clients.phone`·`previousPhones` 잠금 |
| Functions | `updateClientPhone` · `listMalformedClientPhones` (둘 다 새로 생성) |
| 웹 | `index-D2kC6zKW.js` — 양도 화면 · 연락처 수정 · 감사의 연락처 변경 목록 |

**회원권 양도** (`0650486` · `18481b1`): 대표만. 부원장 회당 단가가 원본과
정확히 같아지도록 계약 금액을 2원 안에서 보정한다 -- 비례식만 쓰면 98.66% 만
맞고 나머지가 1원 어긋나는데, 회차마다 1원이고 원장은 고칠 수 없다.

**연락처 수정** (`32c4618` · `e86ea98` · `9b0d5b2` · `b491795` · `7d075c1`):
대표·FC매니저는 모든 회원, 강사는 자기 회원만 하루 10건(KST 자정 기준).
`clientId` 는 바뀌지 않는다 -- id 와 번호가 달라도 정상이다.

**기기 명부와의 충돌을 먼저 막았다** (`32c4618`): 어댑터가 수정에서 `phone` 을
아예 보내지 않는다. 안 그러면 옛 번호를 든 강사 폰이 회원 메모를 고칠 때 그
수정이 통째로 거부된다.

**남은 일 — 대표가 할 것**

1. `더보기 → 감사 로그` 에서 **연락처 변경** 목록이 보이는지 확인
2. **깨진 번호 정리**: `listMalformedClientPhones` 를 부를 화면은 아직 없다.
   지금은 Functions 콘솔이나 앱 콘솔에서 직접 부른다 -- 목록을 받아 연락처
   수정으로 하나씩 고친다
3. 그 정리가 끝나야 "같은 사람이 회원 둘" 이 몇 건인지 드러난다.
   **회원 합치기**는 설계만 있다 ([member-merge-design.md](member-merge-design.md))

**폰 앱은 새 빌드가 필요하다.** 지금 AAB(57)에는 이 둘이 없다.

### 0-16. 회원권 양도 (2026-09-25) — 배포됨 (0-17)

남은 회차 일부를 다른 회원에게 넘긴다. 대표 전용이고, 회원 상세의 회원권 줄에
**[양도]** 버튼이 생겼다.

| | |
| --- | --- |
| 판정·금액 | `src/data/schema/pass-transfer.js` (순수 함수) |
| 쓰기 | `pass-repository.js` 의 `transferPass` — 한 배치 네 문서 |
| 화면 | `App.jsx` 의 `PassTransferSheet` (대표만) |
| 규칙 | `handover` 원장 종류 추가 — **배포 필요** |
| 커밋 | `0650486` (데이터) · 화면은 그 다음 커밋 |

**0번 — 부원장 단가를 어떻게 맞추나 (대표 확정: (다))**

부원장 급여는 `round(공급가액 / 총회차 / 2)` 다. 회차를 쪼개면 분자와 분모가
각각 반올림되면서 이 값이 1원씩 어긋난다. 회차마다 1원이고 원장은 append-only
라 고칠 수 없다.

그래서 비례식으로 나눈 뒤 **부원장 단가가 원본과 정확히 같아질 때까지** 금액을
1원씩 움직인다. 폭은 2원까지(`MAX_TRANSFER_NUDGE`).

> 130만 카드 20회에서 5회 → 비례식 325,000원은 단가가 29,546원이 되어 원본의
> 29,545원과 어긋난다. **324,999원**이면 정확히 같아진다.

맞추지 못하면 **쓰지 않는다.** 비슷한 값으로 넘기면 그 차이가 원장에 박힌다.
카드·현금 × 1~40회 × 가격 구간 약 1,600조합을 훑어 2원 안에서 언제나 맞는다는
것을 테스트가 고정한다.

**`handover` 는 새 원장 종류다**

`deduct` 가 아니다 — 수업이 일어나지 않았으므로 급여가 나가지 않고, 그래서
`category` 와 `unitPrice` 에 넣을 참값이 없다. `cancel` 도 아니다 — 일부만
나가고, 돈이 사라지는 것이 아니라 옮겨 간다.

`toPassId` · `toClientId` 를 반드시 남긴다. 없으면 회차가 줄어든 사실만 남고
회원이 물을 때 답할 것이 없다. 이 두 칸은 양도에만 쓸 수 있게 따로 막았다 —
`hasOnly` 는 "있어도 된다" 만 말한다.

**대표만 한다.** 회원 사이에 돈이 오가는 일이라 차감 보정·취소와 같은 선이다.

**확정 사항 그대로**: 수수료 없음 · 서비스 회차 제외 · 듀엣 금지 · 분류 언제나
`pt_1_1_new` · `handedOver` false · 만료일 원본 그대로 · 받는 회원은 이름을
전부 입력해야 찾힌다(명부를 훑게 두지 않는다).

**배포 순서 — 규칙이 먼저다**

```
npm run test:rules
npx firebase deploy --only firestore:rules --project pilateacher --config firebase.foundation.json
npm run deploy:web
```

규칙보다 앱이 먼저 나가면 [양도]가 보이는데 누르면 거부된다. 규칙만 먼저
나가는 것은 안전하다 — 새로 여는 문이고 기존 문은 한 줄도 건드리지 않았다.

**폰 앱은 새 빌드가 필요하다.**

### 0-15. 릴리스 1.1.28 (57) — AAB 나옴 · main 병합 · 회원 앱 배포 (2026-09-24)

| 항목 | 값 |
| --- | --- |
| Android | `versionCode 57` · `versionName 1.1.28` |
| iOS | `MARKETING_VERSION 1.1.28` · `CURRENT_PROJECT_VERSION` **건드리지 않음** |
| APP_VER | `1.1.28 (57) · 2026-09-24` |
| 커밋 | `9d6ba6a` · main 병합 `59b81a6` (PR #12) |

**왜 56 이 아니라 57 인가**: 56 AAB 는 만들어 두고 Play 에 올리지 않았지만 그
뒤로 강사 앱이 바뀌었다 — 회원에게 보낼 말 칸, 확정 카드 복구. 같은
versionCode 로 내용이 다른 AAB 가 둘이 되면 어느 쪽이 올라갔는지 나중에 확인할
방법이 없다. **56 AAB 는 버린다.**

- **AAB**: `android/app/build/outputs/bundle/release/app-release.aab`
  11,784,061 bytes · `versionCode="57" versionName="1.1.28"` ·
  서명 SHA-1 `17:07:22:E5:F1:FD:F0:87:CB:D9:33:26:8B:6D:FF:4B:79:81:7A:09`
  (정책의 `requiredAndroidOAuthSha1` 에 있는 업로드 키와 같다) ·
  `android:debuggable` **없음**.
- `npm run android:aab` 로 만들었다. 정책을 보는 경로(`android:release:build`)는
  이 브랜치를 거부한다 — `allowedBranchPatterns` 가 `^codex/android-` ·
  `^release/android-` 뿐이다. 올릴 AAB 자체는 같은 Gradle 태스크의 산출물이고
  서명·버전·debuggable 을 위에서 확인했다. prebuild 가 typecheck · lint ·
  `test:node` 를 먼저 돌리므로 "옛 화면이 담긴 최신 버전 코드" 는 나올 수 없다.
- **iOS**: PR #12 를 main 에 병합했다(대표 확인 후). `codemagic.yaml` 의 트리거가
  `branch_patterns: main` 하나뿐이라, 이 병합이 곧 TestFlight 빌드의 시작이다.
  빌드 번호는 Codemagic 의 `$BUILD_NUMBER` 가 정한다 — 저장소의
  `CURRENT_PROJECT_VERSION` 은 자리표시자다.
- **회원 앱 배포됨**: `index-BlsgDgwL.js` · `index-fQ4-bEpx.css`
  (`522f163` 이름·의견 보내기 → `eac8e50` 달력·더보기·머리말).

**이 빌드에 새로 들어가는 것** (56 이후):

| 커밋 | 강사에게 보이는 변화 |
| --- | --- |
| `922e6a9` | 시작 전 수업도 **확정 카드가 선다** — 버튼만 잠긴다 |
| `40fd08b` | 일정 시트에 **"회원에게 보낼 말"** 칸 |
| `9d6ba6a` | 진단 화면의 버전이 1.1.28 (57) |

회원 앱 쪽 변화(달력·더보기)는 폰 앱과 무관하다 — 별도 호스팅이다.

### 0-13. 강사가 회원에게 보낼 말 (2026-09-24) — 배포됨 `40fd08b`

**왜 생겼나**: 대표가 수업기록을 쓰고 회원 앱을 열었는데 "첫 수업을 기다리고
있어요" 였다. 화면은 맞았다 — 회원 앱의 수업 탭은 **원장의 차감**으로
만들어지고, 그 수업은 아직 확정되지 않아 회원의 이력에 없었다. 그리고 수업기록
원문은 설계상 회원에게 가지 않는다.

**고른 길 (대표 확정)**: 원문을 내보내지 않는다. 강사가 **회원에게 보낼 말**을
따로 적고 그것만 회원 앱에 간다. 수업기록은 지금 그대로 강사의 것이다.

| | |
| --- | --- |
| 강사가 쓰는 곳 | 일정 시트 · 출석 처리 아래 "회원에게 보낼 말 (선택)" · 200자 |
| 저장되는 곳 | `organizations/{org}/lessonNotes/{lessonId}_{clientId}` 의 `memberNote` |
| 회원이 보는 곳 | 보니따 멤버십 앱 · 수업 탭의 그 수업 줄 아래 |
| 언제 보이나 | **그 수업을 확정해 차감된 뒤.** 화면이 강사에게 먼저 말한다 |

**규칙은 한 줄도 고치지 않았다.** `lessonNotes` 는 이미 규칙에 있었고 쓰는
코드만 없던 컬렉션이다 — 만들기는 센터 사람만, 고치기는 처음 쓴 사람만, 삭제는
아무도 못 한다. 쓰기 경로를 규칙 테스트 여섯 줄로 고정했다 (227개 통과).

**빠지기 쉬운 자리 하나**: 규칙의 `immutable` 은 값이 아니라 **건드린 필드**를
본다(`affectedKeys`). 두 번째 저장에 `createdAt` 을 `serverTimestamp()` 로 다시
실으면 고치기가 통째로 거부되고 강사에게는 "권한이 없습니다" 로만 보인다.
`saveMemberNote` 가 문서를 먼저 읽어 처음인지 고치는지를 가르는 이유다.

자세한 설계는 [member-app-design.md](member-app-design.md) 12장.

**배포 셋 다 나갔다 (2026-09-24). 하나라도 빠지면 조용히 안 되는 자리라 적어 둔다:**

1. Functions — `rebuildMemberViewOnLessonNoteWrite` **새로 생성됨**, 나머지 넷은 갱신
   (`OnPassWrite` · `OnClientWrite` · `rebuildMemberViews` · `verifyMemberViews` — 다섯이
   `member-view.js` 를 함께 쓴다). Eventarc 권한은 이번엔 걸리지 않았다.
   **세 번째 트리거가 필요한 이유:** 이 쓰기는 회원권도 회원 문서도 건드리지
   않아 기존 트리거 둘로는 잡히지 않는다. 없으면 강사가 저장해도 다음 차감까지
   회원 앱에 안 나타난다
2. `npm run deploy:web` — 강사가 쓰는 칸 · 번들 `index-DZw3V8bK.js`
3. `npm run deploy:member` — 회원이 읽는 줄 · 번들 `index-D8gNe6hb.js`

규칙 배포는 필요 없다.

**폰 앱은 새 빌드가 있어야 한다.** 이 칸은 웹에만 나간다.

### 0-12. 강사 앱 웹 배포 (2026-09-24) — 번들 `index-ahCfgXXG.js`

**왜 이제야 나갔나**: 차감 실패 문구를 고쳐 놓고(`36ec618`) 웹을 배포하지
않아, 대표가 같은 `Invalid occurredAt` 을 계속 봤다. 고친 것이 저장소에만
있으면 아무것도 고쳐지지 않은 것과 같다 — **앱 코드를 고쳤으면 어느 표면에
나가야 하는지까지가 그 작업이다.**

한 번에 나간 것 (마지막 웹 배포 `c221bf4` 이후 src/ 를 건드린 여덟 커밋):

| 커밋 | 강사·대표에게 보이는 변화 |
| --- | --- |
| `36ec618` | 차감 실패 사유가 한국어로. 시작 전 수업엔 **확정 버튼이 없다** |
| `ae44dad` | **차감 규칙** — 1:1 수업이 듀엣 회원권을 쓰지 않는다 |
| `618a49e` | **강사에게 연락처 뒤 4자리만.** "전체 보기" 칩 사라짐 |
| `bbb0311` | 대표 메뉴에 "회원 앱" |
| `93452b4` | 대표 메뉴에 "발급 내역" |

**강사에게 미리 알릴 것**: 연락처가 뒤 4자리로 바뀐 것과, 회원 목록에서
"전체 보기" 가 사라진 것. 대타는 **이름을 전부 입력**하면 된다.

**폰 앱**: 1.1.28(57) AAB 가 새로 나왔고(0-15) iOS 는 PR #12 를 병합해
Codemagic 이 돌고 있다. Play 업로드만 남았다 -- 그때까지 폰으로 쓰는 강사는
위 변화를 보지 못한다.



### 0-11. 회원 앱 배포 (2026-09-24) — **링크는 아직 공유하지 않는다**

**https://pilateacher-member.web.app** · 번들 `index-C9T8qkgP.js` (라이브 = 로컬 확인)

> **회원에게 링크를 공유하지 않는다.** 대표가 자기 번호로 처음부터 끝까지 한 번
> 돌려 보고, 아래 정리 단계까지 끝난 뒤에 공유한다. 지금 링크를 받은 회원이
> 로그인하면 `clients.userId` 가 채워지고 투영이 만들어진다 — 되돌리려면 대표가
> 연결을 끊어야 한다.

- 서버 함수 여덟 개 전부 배포됨. 트리거 둘도 살아 있다(`functions:list` 확인).
- **투영에 상품 이름(`displayName`)을 더했다.** 이관분은 상품 문서가 없고
  `productId` 에 상품명이 그대로 들어 있어(migration-repository.js) 두 곳을
  본다. 만들어진 id 는 이름으로 쓰지 않는다 — uuid 를 띄우면 회원이 그것을
  자기 회원권 이름으로 읽는다. 단가·카테고리·계약금액은 금지 목록 그대로이고,
  그 값들이 있는 회원권으로 투영을 만들어 아무것도 새지 않는지 테스트가 본다.
- 글꼴은 구글 폰트(고운바탕) 그대로. `display=swap` 이라 늦거나 막혀도 화면은
  시스템 글꼴로 바로 선다.
- 테스트: 회원 앱 36 · functions 179 · 에뮬레이터 22 · 앱 전체 1900.

**대표 테스트 절차는 `docs/member-app-design.md` 12장에 있다.** 마지막 정리
단계(보정 → 발급 취소 → 연결 끊기)까지 끝내야 원장에 시험 흔적이 0원으로
상쇄된 채 남는다.

### 0-10. 강사에게 보이는 명부를 좁혔다 — (가) 화면만 · **미배포**

**규칙은 바꾸지 않았다.** `clients` 의 list 는 지금도
owner·manager·instructor·staff 에게 열려 있다. 이것은 경계가 아니라 **화면이
먼저 보여 주지 않는 것**이고, 그 사실을 코드와 테스트 이름에 적어 두었다 —
다음 사람이 보안 경계로 읽으면 안 된다.

그래도 하는 이유: 노출의 대부분은 악의가 아니라 그냥 거기 있어서 일어난다.
강사가 일상적으로 120명의 연락처를 스크롤하며 지나갈 이유가 없다.

| | 강사 | 대표 · FC매니저 · 직원 |
| --- | --- | --- |
| 연락처 | **뒤 4자리** (`···5678`) | 지금과 같다 |
| 회원 목록 | 내 회원만. **"전체 보기" 칩 없음** | 내 회원 / 전체 칩 그대로 |
| 목록 검색 | 내 회원은 부분 일치 · 남의 회원은 **이름 전체** | 지금과 같다 |
| 출석 체크 | 내 회원 안에서. 대타는 **이름 전체** | 지금과 같다 |

- 판정은 `src/features/members/roster-visibility.js` 한 곳에 있다 (단위 14).
  모르는 역할·빈 역할은 **좁은 쪽**으로 간다 — 기본이 "전체 공개" 면 새 역할이
  생겼을 때 그 실수가 조용히 지나간다.
- 담당은 **회원권에서** 온다. 회원 문서에는 담당 강사가 없다. 듀엣이면 짝도
  내 회원이다 — 남으로 보면 그 사람만 화면에서 사라진다.
- **대타 경로는 막지 않았다.** 이름을 전부 입력하면 남의 회원도 나온다. 목록으로
  훑지만 못한다 — 한 글자에 스무 명이 나오면 그것은 명부를 여는 것과 같다.
  대타로 들어간 강사가 차감을 못 하면 그 회차는 아무에게도 지급되지 않는다.
- 스모크 4개 추가(회원 상세·목록 × 강사·대표). 강사 화면에 전체 번호가 없고
  대표 화면은 그대로인지 함께 본다.

**(나) 규칙 차단은 대타 경로 설계 후.** 규칙으로 막으려면 회원 문서에 담당
강사를 적어야 하고(`clients.instructorIds`, 발급·담당교체·이관 네 경로가 유지),
그 전에 **대타 강사가 어떻게 열리는지**를 정해야 한다 — 그날 일정에 있으면
열리는 규칙이든, 대표가 임시로 여는 문이든. 그 설계 없이 규칙부터 조이면
대타 수업이 차감되지 않는다. 지금은 (가)까지다.

### 0-9. 서버 배포 완료 (2026-09-24) — 함수 여덟

| 함수 | 종류 |
| --- | --- |
| `linkMemberAccount` · `linkMemberAccountByOwner` · `unlinkMemberAccount` · `listPendingMemberLinks` | callable |
| `verifyMemberViews` · `rebuildMemberViews` | callable (대표 전용) |
| `rebuildMemberViewOnPassWrite` · `rebuildMemberViewOnClientWrite` | Firestore 트리거 |

이름으로 지정해 올렸다 — `aiGateway` 외 기존 다섯은 건드리지 않았다.

**트리거 둘이 세 번 실패했다.** 이 프로젝트의 첫 2세대 Firestore 트리거라
Eventarc 서비스 에이전트가 방금 만들어졌고, 권한 전파에 시간이 걸린다.
`Permission denied while using the Eventarc Service Agent` — Firebase 가 직접
"몇 분 뒤 재시도하라"고 안내한다. **20분 뒤 한 번에 성공했다.**

재시도 스크립트에서 버그를 하나 만들었다: `if npx … | tail` 은 **파이프 끝
명령(tail)의 종료 코드**를 본다. 실패한 배포가 성공으로 읽혀 "됐다"고 보고했다.
파이프를 없애고 `$?` 를 직접 봤다. 같은 실수를 다시 하지 않으려면 배포·빌드의
성패를 파이프 뒤에서 읽지 않는다.

Firestore 위치와 트리거 리전은 둘 다 `asia-northeast3` 로 처음부터 맞았다.

### 0-8. 회원 앱 9번 — 별도 Vite 앱 · **배포됨 (2026-09-24)**

**https://pilateacher-member.web.app** · 번들 `index-40KNFPMs.js` (419KB)
배포 뒤 확인: 라이브가 방금 만든 번들과 같은 파일명 · 없는 경로가 200(SPA fallback)
· 강사 앱 번들은 그대로(`--only hosting:pilateacher-member` 라 건드리지 않았다).

- `member/` · 빌드 `dist-member/` · 사이트 **pilateacher-member.web.app**
  (`npm run build:member` · `npm run deploy:member`).
- `firebase.foundation.json` 의 hosting 을 배열로 바꾸고 `site` 둘을 달았다.
  배포는 `--only hosting:<site>` 로 사이트를 지정한다 — `--only hosting` 만 주면
  회원 앱을 고치려다 강사 앱까지 나간다.
- **번들 419KB (gzip 107KB).** 처음엔 845KB 였는데 Firestore 를 lite 빌드로
  바꿔 반이 됐다 — 한 번 읽고 끝이라 실시간 구독이 필요 없다.
- 읽는 것은 문서 **둘**이다: `memberLinks/{uid}` 로 자기 clientId 를 알고,
  `memberViews/{clientId}` 를 연다. 설계에는 "하나" 로 적혀 있었는데 규칙이
  `list` 를 닫아 뒀으므로 링크 문서가 먼저다.
- `tests/member/reads-nothing-else.test.js` 가 **다른 컬렉션을 읽지 않는다**는
  것을 소스로 지킨다. 질의 API 금지 · `doc()` 이 여는 컬렉션 둘 · 경로 문자열.
- 90일 재인증은 기기에 마지막 확인 시각을 둔다. **보안 경계가 아니다** —
  규칙은 90일을 모른다.
- 설계에 없던 상태 하나를 더했다: **"회원권 정보를 준비하고 있어요"**. 연결 직후
  트리거가 도는 몇 초 동안 투영이 없고, 그때 "조회 실패" 는 정상 상태를 고장으로
  말하는 것이다.
- 테스트 32 (단위 13 + 정적 4 + 화면 스모크 15). `tests/member` 를 `test:node`
  에 넣었다 — 공통 모듈을 함께 쓰므로 강사 앱 빌드가 회원 앱을 깨뜨릴 수 있다.
- 배포 전 콘솔 준비(사이트 생성 · 승인 도메인 · 테스트 회원)는 2026-09-24 완료.
  **남은 것은 실제 번호로 처음부터 끝까지 한 번 해 보는 것**이다 (설계 12장 절차).

### 0-7. 회원 앱 8번 — 점검·재작성 문 둘 + 대표 화면 · **배포됨(2026-09-24)**

**백필의 역할이 바뀌었다.** 트리거가 `clients.userId` 있는 회원만 투영을 만들도록
바뀌면서, 연결이 곧 트리거를 부르고 그 트리거가 전체를 다시 읽는다 — 셋이 함께
배포되면 백필이 만들 문서는 사실상 0건이다. 그래서 **"만들기"가 아니라 "확인하기"**
도구가 됐다.

- PC 스크립트를 쓰지 않는다. 그러려면 노트북에 Admin SDK 키가 있어야 하고 **그 키
  하나가 센터 전체를 여는 열쇠**다. 서버 함수 둘로 옮기고 대표가 화면에서 누른다.
- `verifyMemberViews` — 읽기 전용 전수 대조. `rebuildMemberViews` — **기본이 건조
  실행**, `dryRun: false` 를 명시해야 쓴다. 둘 다 owner 만, `locationId` 나
  `clientId` 가 반드시 있어야 한다(센터 전체를 훑지 않는다).
- 한 호출에 회원 200명 · 45초 상한. 넘으면 커서를 돌려주고 멈춘다.
- 잔여는 `buildMemberView` 를 **쓰지 않고** 따로 센다 — 다시 만든 것과만 견주면
  그 함수가 틀렸을 때 둘이 같은 답을 내고 대조가 아무것도 증명하지 못한다.
- 어긋난 회원을 만나면 거기서 멈춘다. "몇 명이 틀렸나"가 아니라 "무엇이 틀렸나"다.
- **대표 화면**: 더보기 → **회원 앱** (`showPayroll` 과 같은 조건). 연결 대기 목록 ·
  손으로 잇기 · 끊기 · 점검. 이 화면이 없으면 손으로 잇는 문은 **부를 수 없는 문**
  이었다 — 규칙이 `memberLinks` 를 본인에게만 열어 두어 대표가 대기 목록을 볼 길이
  없었다.
- 실패 구분: 권한 없음(permission-denied) / 조회 실패(코드) / 대기 없음 — 셋이 서로
  다른 문구다.
- 테스트: 서버 단위 17 + 화면 스모크 5(케이스) · 5(단언). 에뮬레이터 22 그대로 통과.
- 설계 문서 10장 표를 실제 상태로 고쳤고, 11장을 이 방식으로 다시 썼다(배포 순서 포함).

### 0-6. 릴리스 1.1.28 (56) — AAB 나옴 · iOS 는 main 병합 대기

| 항목 | 값 |
| --- | --- |
| Android | `versionCode 56` · `versionName 1.1.28` |
| iOS | `MARKETING_VERSION 1.1.28` · `CURRENT_PROJECT_VERSION` **건드리지 않음** |
| APP_VER | `1.1.28 (56) · 2026-09-23` (여덟 릴리스 뒤처져 있었다) |
| 정책 파일 | `lastPublishedVersionCode 55` / `1.1.27` (대표가 Play 콘솔에서 확인) |
| package.json | `1.0.0` → `1.1.28` |
| 커밋 | `986d852` |

- **AAB**: `android/app/build/outputs/bundle/release/app-release.aab`
  11,779,874 bytes · `versionCode="56" versionName="1.1.28"` ·
  서명 SHA-1 `17:07:22:E5:F1:FD:F0:87:CB:D9:33:26:8B:6D:FF:4B:79:81:7A:09`
  (정책의 `requiredAndroidOAuthSha1` 에 있는 업로드 키와 같다) ·
  매니페스트에 `android:debuggable` **없음**.
- `npm run android:aab` 로 만들었다. **정책을 보는 경로(`android:release:build`)는 이
  브랜치를 거부한다** — `allowedBranchPatterns` 가 `^codex/android-` · `^release/android-`
  뿐이고 지금은 `docs/app-review-account` 다. 올릴 AAB 자체는 같은 Gradle 태스크의
  산출물이고 서명·버전·debuggable 을 위에서 확인했다.
- **iOS**: `codemagic.yaml` 의 트리거는 `branch_patterns: main` 하나뿐이다. 이 브랜치를
  푸시해도 빌드가 돌지 않는다 — **`docs/app-review-account` → `main` 병합(PR)이 있어야
  TestFlight 빌드가 나간다.**
- iOS 빌드 번호는 Codemagic 의 `$BUILD_NUMBER` 가 정한다(codemagic.yaml:219). 저장소의
  `CURRENT_PROJECT_VERSION` 은 자리표시자이고, 올리면 스토어와 어긋나 보인다.
- 이 빌드에 들어가는 것: 차감 규칙(0-5) · 연결 함수와 트리거(0-4·0-3, 서버 미배포라
  앱에서는 아직 안 쓰인다) · 발급 내역(0-1).

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
