# Phase 2 비공개 비포애프터 공유 개발 보고

작성일: 2026-11-13. 브랜치: `feat/private-before-after-sharing`.

## 상태 구분

| 단계 | 결과 |
|---|---|
| 핵심 구현 | 개별/다중 사진, 비교 설정, 피드백, 회원 동의, 명시적 공개, 취소, 알림, 탈퇴 정리 구현 |
| 자동 검증 | 타입 검사·린트·두 앱 빌드·회귀·보안·모의 API 브라우저 테스트 통과 |
| 실기기 검증 | 미실시. ADB 연결 기기 0개. Windows 환경에서 iOS 실기기 검증 불가 |
| 운영 활성화 준비 | **보류**. Phase 1 기존 파일 4개의 canonical 권한 연결 미설정, 실기기 복원/푸시 미검증 |
| 실제 운영 배포 | **하지 않음**. 운영 데이터 수정, 플래그 생성/활성화, Git push 모두 하지 않음 |

AI 분석 결과 공유는 미구현·강제 비활성화다. 일반 사진 공유와 분리되어 있으며, 클라이언트가 AI 결과를 보내도 서버에서 거절한다.

## 1. 개발 전 확인한 실제 구조

- 강사 웹: `https://pilateacher.web.app`, 커밋 `8f03c32`, 번들 `/assets/index-D7B97qVv.js`, 표시 버전 1.1.42.
- 회원 웹: `https://pilateacher-member.web.app`, 번들 `/assets/index-CxDzx6cV.js`, 번들 표시 버전 1.1.2. version.json은 제공되지 않았다.
- 위 값은 이번 작업 중 운영 HTTP 응답을 읽어 확인했다. Play/App Store의 현재 출시 버전은 직접 확인하지 않았다.
- 두 앱 모두 Firebase 프로젝트 `pilateacher`, bucket `pilateacher.firebasestorage.app`, 서울 리전 callable을 사용한다. 별도 프로젝트 간 데이터 전송은 없다.
- 서버의 검증된 전화번호 연결 로직이 `memberLinks/{uid}.links[]` 및 `organizations/{org}/clients/{client}.userId`를 만든다. 공유 시 두 관계와 연결 상태를 다시 검증한다. 이름으로 연결하지 않는다.
- 사진 메타데이터: `users/{teacherUid}/photoBackups/{photoId}`. 원본: `users/{teacherUid}/photos/{photoId}/original.bin`. 미리보기: 같은 경로의 `image.jpg`. 기존 `record.albumEdit` 및 과거 rot/scale/x/y 편집값을 재사용한다.
- 기존 클라우드 백업 동의는 회원에게 공개하는 동의로 간주하지 않는다. 회원 본인이 부여하는 별도 버전 동의가 필요하다.
- 운영 파일 읽기 전용 감사: 사진 파일 4개, 공개 bearer token 0개, cacheable 0개, canonical scope 미설정 4개. 내용을 내려받거나 연결을 일괄 수정하지 않았다.

## 2. 강사앱 공유 화면

- 서버 테스트 계정 플래그를 통과한 강사에게만 ‘사진 공유하기 · 공유 기록’ 표시.
- 개별/다중 선택(최대 12장), 비교 화면의 두 사진·좌우 역할·확대/위치·슬라이더 설정 전달.
- 서버에서 받는 회원 이름/ID, 사진의 소유관계·원본 백업·회원 동의 확인 후 draft 생성.
- 서버 저장본의 편집 상태로 실제 회원 제공 자료를 미리보기. 로컬 미동기화 편집 내용을 공개 완료로 오인하지 않도록 안내.
- 받는 회원과 공개 내용을 확인하는 체크박스 및 별도 ‘공유하기’를 눌러야 active 전환. 사진 저장이나 AI 실행은 공개를 발생시키지 않는다.
- 피드백 최대 1,000자. 준비 중 기록 재열기, 공개 중 기록 확인, 공유 취소 지원.
- 동일 requestId와 동일 내용의 준비/공개 재시도는 같은 공유를 사용한다. 같은 requestId의 내용 변경은 충돌로 거절한다.

## 3. 회원앱 화면 및 알림

- 테스트 허용 회원에게만 비포애프터 탭 표시. 기본 탭 수/기존 기능은 그대로 유지한다.
- 공유 동의/철회, 선택적 새 기록 알림 동의, 최근 목록·썸네일·촬영일·강사·피드백·새 기록 표시.
- 상세에서 사진과 비교 결과, 나란히/슬라이더 전환. 의료 진단이 아니며 각도·자세 차이가 있다는 안내.
- 공유 데이터가 없으면 요청된 빈 상태 문구 표시. 다운로드·외부 공유·내보내기 버튼 없음.
- 로그인 전에 받은 공유 알림의 불투명 shareId를 메모리에서 보관하고 로그인 후 서버를 통해 열도록 연결. 알림 payload를 권한 증명으로 사용하지 않는다.
- 서버 트리거가 기존 memberPush 기기 토큰으로 일반 문구만 보낸다. 이름/사진/분석 수치/URL은 푸시에 넣지 않는다.
- 푸시 실패는 공유 성공을 취소하지 않는다. transaction으로 발송을 선점하므로 트리거 재시도로 중복 발송하지 않는다. 발송 중 프로세스 중단 시 `sending` 상태로 남아 자동 재발송하지 않을 수 있다. 회원앱 목록은 별개로 제공된다.

## 4. 서버 자료 구조와 권한

새 callable: `beforeAfterSharing`.

- `beforeAfterShares/{shareId}`: teacherId, memberUserId, organizationId, clientId, photoIds, photos(원본 참조 ID·미리보기 generation·날짜·방향·편집 스냅샷), comparisonConfig, feedback, shareType, status, sharedAt/revokedAt, consentReference/consentRevision, fingerprint, schemaVersion=2, downloadEnabled=false.
- 상태: draft → active → revoked. 취소한 기록을 재시도로 다시 공개하지 않는다.
- `memberPhotoConsents/{uid}/scopes/{scopeHash}`: 서버가 본인 관계를 검증한 동의/철회, version, revision, 알림 선택, 시각.
- 공유 문서의 events 하위 컬렉션: 준비/공개/열람/사진 요청/취소의 actor와 시각. 사진 본문이나 피드백을 로그에 기록하지 않는다.
- 회원/강사는 Firestore에서 공유·동의·기능 플래그를 직접 읽거나 쓸 수 없다. 기존 Storage에 회원용 공개 권한도 추가하지 않았다.
- callable마다 Firebase ID token을 폐기 여부까지 검증한다. disabled/삭제 계정의 기존 토큰을 신뢰하지 않는다.
- API에서 현재 회원 연결, 담당 강사 소속/퇴사/권한 회수, 동의 revision, 파일 소유관계, 공유 상태를 재확인한다. schemaVersion을 위조해도 이 검증을 생략할 수 없다.
- 사진 전달은 인증된 callable의 응답으로만 한다. 공개 다운로드 URL, signed URL, 장기 토큰을 만들지 않는다.
- 원본 파일은 회원에게 전달하지 않는다. 현재 허용된 JPEG 미리보기(최대 4MB)를 읽고 EXIF/위치/IPTC/주석 등 메타데이터를 제거한다. 원본 바이트와 기존 분석은 변경하지 않는다.
- 사진 generation을 고정하여 공유 후 같은 경로에 다른 파일을 덮어써도 내용이 조용히 바뀌지 않는다. 해당 generation이 없어지면 실패로 차단하고 다시 공유해야 한다.
- 사진을 다른 회원에게 이동하거나 삭제 표시하면 기존 공유에서도 즉시 재조회/전달을 거절한다.

## 5. 취소·담당 변경·동의 철회·탈퇴

- 취소 후 목록/상세/사진 API 접근 불가. 전송 중 취소도 사진 바이트를 응답하기 전에 재검사한다.
- 회원 화면은 15초마다 재검증하고 권한 오류 시 자료를 제거한다. 오프라인/백그라운드에서는 사진을 지우고 복귀 시 재검사한다. 사진은 localStorage/IndexedDB/회원 오프라인 캐시에 저장하지 않는다.
- 담당 강사 변경/퇴사 시 그 강사가 보낸 과거 공유도 차단하는 보수적 정책이다. 공유 메타데이터는 이력으로 남지만 다시 열지 못한다. 담당 변경 후 과거 기록을 계속 제공하는 정책은 별도 결정/구현 대상이다.
- 동의 철회는 revision을 증가시킨다. 다시 동의해도 예전 공유가 자동으로 살아나지 않는다.
- 회원 탈퇴의 연결 제거 후 공유 내용과 동의 자료를 정리하고, 별도 memberLinks 삭제 트리거도 같은 정리를 지원한다. 원래 강사의 원본/분석 기록은 삭제하지 않는다.
- 이미 전달·촬영·복사된 사본을 원격 회수할 수 있다고 표시하지 않는다. 재검증 전 이미 화면에 보였던 자료나 실행 중 요청을 취소 시점 이전으로 되돌릴 수는 없다.

## 6. 구버전 및 플래그

기능 플래그는 서버 Admin 관리 대상이다. **이번 작업에서는 운영 문서를 생성하지 않았다.** 문서가 없으면 비활성화다.

```json
{
  "mode": "off",
  "phase1Verified": false,
  "teacherIds": [],
  "memberIds": []
}
```

`runtimeConfig/beforeAfterSharing`에서 `mode=test`, `phase1Verified=true`, 양쪽 UID 허용 목록을 모두 충족해야만 공유/열람을 허용한다. 전체 회원에게 여는 all 모드는 구현하지 않았다. 로컬 에뮬레이터만 합성 계정으로 해당 플래그를 설정했다.

기존 앱은 새 공유 컬렉션/파일을 직접 읽을 수 없다. 새 요청에는 protocol schemaVersion=2가 필요하며 구버전 요청은 update-required로 거절한다. 앱 안에는 업데이트 안내 문구를 두고 기존 Remote Config 업데이트 안내 구조를 유지했다. 스토어 배포 전 최소 빌드 번호를 임의로 올리거나 기존 앱 전체를 차단하지 않았다.

## 7. 검증 결과와 한계

- `npm run build`: 타입 검사/런타임 린트/전체 Node/현재·+30일·+365일 검사/강사 Vite 빌드 통과. 각 전체 검사 3,762개 중 3,615 통과, 147 건너뜀, 실패 0.
- 회원 린트 및 회원 Vite 빌드 통과. 공용 이미지 렌더 코드의 회원앱 배포 경로 누락도 회귀 테스트로 찾아 수정했다.
- functions 전체 단위 테스트: 352 통과.
- Firebase Firestore/Storage 에뮬레이터: 419 통과(기존 405 + 새 공유 시나리오 14). 실제 Firestore transaction과 보안 규칙 사용. 서비스 테스트의 이미지 bucket은 합성 바이트 fixture를 사용했고, 직접 Storage 비인증/타회원 접근 거절은 실제 Storage 에뮬레이터에서 확인했다.
- 새 시나리오: draft 비공개, 명시적 활성화, 동명이인/타회원/비담당/비인증 차단, 원본/분석 보존, 공유 취소, 담당 변경/퇴사, 동의 철회/재동의, 회원 재연결/사진 이동/삭제, 동시 중복 요청, 구버전/플래그/미백업/AI 차단, 푸시 실패 분리, 전송 중 취소, 탈퇴 정리, 동의 위조 차단.
- 공유 브라우저 통합: 320/390/768px에서 미리보기→동의 확인→공개→회원 비교→오프라인 사진 제거→취소 후 빈 목록 통과. 실제 React 화면과 모의 API 사용. 운영 로그인/실제 기기 FCM을 사용한 end-to-end 검증으로 주장하지 않는다.
- 화면·알림 집중 회귀: 458 통과. 일정 색상 버튼을 열고 ‘개인 파랑’을 선택해 기존 설정 저장 callback에 blue가 전달되는 별도 브라우저 검증 통과.
- 최종 `git diff --check` 통과. 기존 큰 번들 경고는 남아 있다.
- Android ADB 연결 기기 없음. iOS 실기기/푸시 권한/앱 강제종료/재설치/네트워크 전환/실제 사용자 로그인 end-to-end는 미검증.

## 8. 추가 요청: 일정 색상 누락

이전 `05dffbe`에 있던 일정 색상 바로가기 수정이 운영 `8f03c32`에 포함되지 않은 것을 현재 Git 소스로 확인했다. 일정 탭 상단의 ‘일정 색상’ 버튼과 바텀시트를 복구하고, 더보기의 기존 색상 화면도 동일한 컴포넌트를 사용하도록 정리했다. 기존 onSettings 저장 경로를 재사용한다. 이번 수정은 개발 브랜치에만 있으며 운영 웹은 아직 바꾸지 않았다. 이전 커밋의 별도 수업일지 초안 기능을 이번 수정에 섞어 가져오지 않았다.

## 9. 수정·추가 파일

- 서버: `functions/src/before-after-sharing.js`, `functions/src/before-after-notifications.js`, `functions/src/index.js`, `firestore.foundation.rules`.
- 강사 및 공용 화면: `src/App.jsx`, `src/lib/firebase.js`, `src/features/photos/BeforeAfterAlbum.jsx`, `TeacherPhotoSharing.jsx`, `SharedBeforeAfter.jsx`, `private-sharing.css`, `photo-edit-model.js`, `album-model.js`, `album-render.js`.
- 회원앱: `member/src/before-after.jsx`, `App.jsx`, `firebase.js`, `push.js`, `styles.css`.
- 검사/배포 준비: `tests/rules/before-after-sharing.rules.test.js`, `tests/member/push.test.js`, `tests/ui/screen-render-smoke.test.js`, `package.json`(규칙 테스트 병렬 충돌 방지), `.github/workflows/deploy-member.yml`(공용 코드 경로), `tools/qa/private-sharing.mjs`, `tools/qa/schedule-color-shortcut.mjs`.
- 보고서: `PHASE2_PRIVATE_SHARING_REPORT.md`. 합성 스크린샷/브라우저 결과는 `release/qa/private-sharing/`, 일정 색상 결과는 `release/qa/schedule-color-shortcut/`에 로컬 보관.

## 10. 배포 전 남은 항목

1. 운영의 legacy scope 미설정 파일과 원본 백업/다른 기기 복원을 개별 검증해야 한다. 일괄 마이그레이션은 하지 않는다.
2. 실기기 Android/iOS에서 로그인 전후 알림 이동, 실제 푸시 수신, 재설치, 앱 복귀, 사진 표시/메모리, 취소 후 재열람 차단을 검증해야 한다.
3. 실제 운영 동의 문구·자료 보관 기간·퇴사/담당 변경 후 과거 공유 보존 정책을 확정해야 한다. 현재 정책은 권한을 보수적으로 차단하는 상태다.
4. AI 분석 선택 공유, 다운로드 허용 정책은 비활성화다. 대규모 공유 목록 페이지 처리/조회 최적화는 추후 필요하다.
5. 배포 승인 후에도 우선 기능 off 상태로 서버 함수/규칙→두 앱을 배포하고, Phase 1 검증을 마친 테스트 계정만 허용해야 한다. 자동 배포 workflow가 있으므로 승인 전 main 병합/push도 수행하지 않는다.
6. 새 함수뿐 아니라 탈퇴 정리를 연결한 `deleteMemberAccount`도 향후 배포 대상이다. 현재 기능 배포는 전혀 하지 않았다.
