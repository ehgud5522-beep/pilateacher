# 완성된 비교 카드 회원 공유 — PR 검토용

## 기준과 범위

- 기준: PR #186의 `origin/feat/before-after-design` (`2283041`). 확인 시점에도 #186은 OPEN이다.
- 작업: `codex/comparison-card-sharing`, 별도 워크트리. 로컬 main 변경 없음.
- 백업 대기열 작업은 별도 PR #187 (`2967316`)로 제출 완료했으며 이 브랜치에 포함하지 않았다.
- 이 PR은 #186 위에 쌓는 PR이다. #186 병합 후 main으로 대상 브랜치를 바꾸고 #187과의 통합 상태를 다시 확인해야 한다.
- 병합·배포·스토어 업로드·기능 스위치 변경은 하지 않는다. PR 미리보기 자동 배포도 막기 위해 커밋에 `[skip ci]`를 붙인다. 아래 테스트는 로컬 결과다.

## 동작

Compare가 `drawComparisonCard`로 그린 **현재 캔버스**를 `captureShareCard`가 JPEG 품질 0.9로 한 번 인코딩한다. 이 바이트로 미리보기와 전송을 함께 한다. 로고·펜/자·날짜·기간·코멘트를 회원앱에서 다시 그리지 않는다. 코멘트 120자를 그대로 공유 피드백으로 사용하며 별도 입력란은 없다.

공유 가능 계정에만 Compare의 ‘회원에게 공유’가 나타난다. 미리보기와 수신 회원 확인 체크 후 ‘공유하기’를 눌렀을 때 prepare와 activate를 실행한다. 앨범의 기존 공유 기록·취소는 유지한다.

새 공유는 `card`만 허용한다. JPEG 시작 바이트와 실제 SOF 크기, 최대 4MiB, 1200px 폭과 600~3000px 높이, SHA-256, 120자 코멘트, 두 날짜를 검사한다. 각각 다른 `share/card-*` 사유를 반환한다. 원본 사진 ID 2개는 감사용 입력으로만 보관하고, 사진 백업 문서나 original.bin을 읽지 않는다. 회원 연결·현재 담당 권한·동의 revision·기능 플래그 검사는 기존 authority를 유지한다.

Admin SDK가 `beforeAfterShares/{shareId}/card.jpg`에 저장한다. 다운로드 토큰을 발급하지 않고 Cache-Control은 private/no-store다. 공유 문서의 `card`에는 path/generation/sha256/bytes/width/height만 저장한다. 이미지 본문은 Firestore에 저장하지 않는다. 회원 반환 데이터에는 원본 사진 ID·Storage 경로·회원 이름·별도 코멘트가 없다. 코멘트는 완성 이미지 안에서만 보인다.

동일 requestId는 동일 shareId로 묶인다. 트랜잭션으로 비공개 `preparing` 상태를 예약하고 Storage의 ifGenerationMatch=0 조건으로 덮어쓰기를 막은 뒤 `draft`로 확정한다. 실패한 준비 작업은 같은 화면에서 수동 재시도할 수 있으며 결정적 오류를 자동 재시도하지 않는다. 준비 중 중단된 작업은 회원에게 공개되지 않는다.

media는 파일 generation·크기·해시와 권한을 확인하고, 내려받기 후 권한을 다시 확인한 다음 같은 JPEG 바이트를 반환한다. 취소는 먼저 서버 접근을 막고 card.jpg를 삭제한다. 탈퇴 정리도 카드 삭제 후 문서·동의를 지운다. 파일 삭제 실패를 성공으로 표시하지 않는다. Storage 장애가 지속되면 비공개 파일 정리에 재시도가 필요하다.

회원 화면은 이미지 한 장·강사·촬영 날짜만 표시한다. 슬라이더·다시 그리기·내보내기 버튼은 없다. 메모리 Blob URL만 사용하고 숨김/오프라인/컴포넌트 종료/권한 재확인 실패 시 제거한다. 서버 권한은 매 요청마다 확인하며 열린 화면은 기존 15초 확인 주기를 유지한다. 이미 본 화면이나 사용자가 만든 사본을 회수한다고 보장하지 않는다.

신규 클라이언트는 프로토콜 3을 사용한다. 프로토콜 2는 기존 photos/comparison 읽기를 유지하되 card 목록을 받지 않으며 card 직접 접근은 update-required다. 옛 형 신규 prepare는 unsupported-type이다. `SharedBeforeAfter`의 기존 비교 렌더러는 옛 기록 읽기 전용으로 유지했다.

## 변경 파일

- `src/features/photos/BeforeAfterAlbum.jsx`: Compare 캔버스 공유, 공유 기록 진입.
- `src/features/photos/share-card-payload.js`: 단일 JPEG 인코딩과 해시.
- `src/features/photos/TeacherPhotoSharing.jsx`: 정확한 카드 미리보기·체크·명시적 공유.
- `src/features/photos/SharedBeforeAfter.jsx`: 카드 표시와 기존 형식 렌더러 분리.
- `src/features/photos/sharing-errors.js`: 코드별 문구와 민감정보 없는 진단.
- `src/lib/firebase.js`, `member/src/firebase.js`: 프로토콜 3, 진단 문맥.
- `member/src/before-after.jsx`: 카드 목록·상세, 테스트 API 전달 유지.
- `functions/src/before-after-sharing.js`: 카드 prepare/media/취소, 구버전 호환.
- `functions/src/share-card.js`: JPEG 검증과 카드 파일 정리.
- `functions/src/share-diagnostics.js`: 정제된 서버 오류 진단.
- `functions/src/before-after-notifications.js`: 탈퇴 카드 정리.
- `functions/src/index.js`: 오류 details·로그, 탈퇴 정리에 bucket 전달.
- `functions/tests/share-card.test.js`: 검증 사유·진단·삭제 단위 검사.
- `tests/posture/card-sharing.test.js`: 단일 인코딩·UI·가짜 DOM 공유/열람/취소.
- `tests/rules/before-after-sharing.rules.test.js`: 카드 권한·취소·동의·실제 Storage 에뮬레이터·구버전 검사.
- `tests/integration/sharing-auth.test.cjs`: 실제 에뮬레이터 토큰을 사용하는 callable 검사.
- `tools/qa/private-sharing.mjs`: 가짜 데이터 Chrome 검사.
- `.github/workflows/deploy-member.yml`: 새 공용 진단 파일을 기존 paths 두 곳에 추가. 배포 이벤트·조건은 변경하지 않음.
- `docs/handoff.md`, 이 문서: 인수인계와 검증 결과.

`src/App.jsx`, `firestore.foundation.rules`, `storage.rules`, `functions/src/photo-access.js`, 회원 연결·홀딩·결제·일정·급여 코드는 변경하지 않았다. 운영 runtimeConfig 문서를 만들거나 읽고 수정하는 작업도 하지 않았다. 테스트의 플래그와 회원 데이터는 에뮬레이터에만 생성했다.

## 검증

| 검사 | 결과 |
|---|---|
| npm run test:node | 3,638 통과 / 147 제외 / 실패 0 |
| npm run build | 타입 검사·런타임 린트·일반/+30일/+365일 테스트 및 강사 웹 빌드 성공; 각 테스트 실행 같은 통과 수 |
| npm run build:member | 타입 검사·회원 린트·앱 테스트 및 회원 웹 빌드 성공 |
| npm --prefix functions test | 362 통과 / 실패 0 |
| npm run test:rules | 425 통과 / 1 제외 / 실패 0 |
| node tools/test-sharing-auth.mjs | 실제 Auth·Firestore·Storage 에뮬레이터 토큰/callable 통합 1개 통과 |
| node tools/qa/private-sharing.mjs | Chrome 320·390·768px 모두 통과 |

앱 제외 147개는 비활성 360° 바디뷰 145개, 회원 네이티브 Firebase 설정 1개, 릴리스 서명 설정 1개다. 규칙 제외 1개는 비공개 운영 감사 입력이 필요한 검사다. 제외를 통과로 세지 않았다.

Chrome에서 **실제 drawComparisonCard 캔버스**로 가짜 카드를 만들었다. 명시적 체크 전 공유 없음, 미리보기와 회원 이미지 SHA-256 일치, 슬라이더 없음, 가로 넘침 없음, 오프라인 후 이미지 제거, 취소 후 목록 제거와 브라우저 오류 0을 확인했다. API는 가짜이며 운영 통신이나 실제 알림 검사가 아니다. 서버 인증·동의·취소는 별도 에뮬레이터로 검사했다.

처음 앱 검사에서 새 공용 파일의 워크플로 paths 누락과 회원 Firebase의 정적 Capacitor import가 검출됐다. paths를 추가하고 동적 import로 수정한 뒤 전체 빌드를 통과했다. 첫 규칙 실행은 샌드박스 로컬 포트 제한으로 시작하지 못했으며, 승인된 로컬 에뮬레이터 실행으로 최종 통과했다. 기존 큰 번들 경고는 남아 있다.

## 승인 후 배포 순서 — 이번에는 실행하지 않음

1. #186과 이 PR의 main 통합, 필요 시 #187과 함께 재검증. 기존 회원 웹은 main push/병합 때 자동 배포되므로 **병합 승인과 배포 승인을 혼동하지 말 것**. 배포 전까지 공유 OFF 유지.
2. 서버 함수 먼저: `beforeAfterSharing`, `notifyBeforeAfterShare`, `eraseDeletedMemberShares`, `deleteMemberAccount`.
   ```powershell
   npx firebase deploy --project pilateacher --config firebase.ai-gateway.json --only "functions:beforeAfterSharing,functions:notifyBeforeAfterShare,functions:eraseDeletedMemberShares,functions:deleteMemberAccount"
   ```
   알림 함수도 카드 권한 검사를 포함한 새 공용 모듈을 패키징해야 한다. Firestore/Storage 규칙 배포는 필요 없다.
3. 승인된 main에서 강사 웹: `npm run deploy:web`.
4. 승인된 main에서 회원 웹: `npm run deploy:member` 또는 기존 수동 `deploy-member.yml` 워크플로 중 한 가지.
5. Android/iOS는 새 클라이언트 빌드와 직접 검증 필요. 스토어 제출·공유 스위치 활성화는 별도 승인 사항.

실기기·운영 데이터·운영 알림·운영 성능은 미검증이다. 원본 백업 403 자체는 이 PR이 해결하지 않는다. 카드 공유의 백업 의존성만 제거한다. 중단된 준비 문서는 비공개로 유지되며 별도 자동 청소 정책은 추가하지 않았다. 구버전 클라이언트로 새 카드를 볼 수 없으므로 실제 활성화 전에 양쪽 앱 업데이트를 확인해야 한다.
