# Phase 2 최종 보안 검증 및 웹 배포 준비

2026-11-13. 기준 구현 `6466b37`. 이 문서는 배포 전 검증 기록이며 실제 Hosting 배포 여부는 배포 로그와 배포 후 검증으로 별도 확인한다.

## 1. 기존 파일 4개

운영 데이터를 읽기 전용으로 조회했다. 사진 2장의 `image.jpg`·`thumb.jpg` 합계 4개다. 사진별 legacy memberId와 canonical clientId의 **정확한 ID 일치**, 조직 회원 문서, memberLinks, 활성 Firebase Auth 계정, 현재 담당 강사의 활성 membership 및 담당 관계를 대조했다. 이름으로 연결하지 않았다.

| 파일 | 회원/계정 연결 | 현재 강사 관계 | 공개 토큰 | 운영 비인증 요청 | 권한 scope 메타데이터 | 서버 고해상도 원본 |
|---|---|---|---|---|---|---|
| 사진 1 image.jpg | 확인 | 확인 | 없음 | 403 | 없음 | 없음 |
| 사진 1 thumb.jpg | 확인 | 확인 | 없음 | 403 | 없음 | 없음 |
| 사진 2 image.jpg | 확인 | 확인 | 없음 | 403 | 없음 | 없음 |
| 사진 2 thumb.jpg | 확인 | 확인 | 없음 | 403 | 없음 | 없음 |

정확한 회원/사진 ID와 저장 경로, 파일 generation·MD5·CRC32C는 비공개 로컬 산출물 `release/qa/phase2-final/private-photo-audit.json`에만 기록했다. 저장소에 추가하지 않는다. 파일 내용, 회원 연결, 토큰, 운영 데이터는 수정하지 않았다. 확인한 것은 기존 최적화 이미지의 존재이며 **고해상도 원본 백업/복원 완료가 아니다**. 원본 기기에서의 복구·업로드 및 권한 메타데이터 연결 전에는 공유 활성화를 보류한다. 파일은 기존 접근 차단 상태를 유지한다.

## 2. 보안 검증과 한계

- Firebase Firestore·Storage 에뮬레이터 **420개 통과, 실패 0, skip 0**. 별도 Functions 단위 테스트 **352개 통과**.
- 다른 회원의 사진/공유 ID, 비담당 강사, 동일 세션에서 담당 변경/퇴사, 공유 취소, 동의 철회와 재동의, 구버전 schema, 미연결 계정, 미공유 사진, 중복/동시 요청을 서버 서비스 및 규칙에서 검증했다.
- 운영 Storage 규칙을 읽어 에뮬레이터에 적용하고, 실제 4개 경로에 합성 바이트를 넣어 비인증·타 회원·연결 회원·업로더 모두 접근 거절을 확인했다. scope가 없는 기존 파일은 업로더도 차단된다. 운영 파일을 에뮬레이터에 복사하지 않았다.
- 운영 파일의 공개 토큰은 없고 비인증 직접 다운로드는 모두 403이다. 폐기 전 토큰 값은 보관하지 않아 과거 토큰 문자열 자체의 재사용은 미검증이다. 신규 공유는 공개 URL을 만들지 않는다.
- callable은 매 요청 `verifyIdToken(..., true)`와 현재 관계를 재검증한다. 실제 Auth 토큰 발급→배포된 Phase 2 callable 전체 경로는 미검증이며 해당 callable은 이번 웹 배포 대상이 아니다.
- 브라우저 합성 API 테스트에서 숨김/오프라인 시 이미지 해제, 공유 취소 후 차단을 확인했다. 이미 표시·촬영·다운로드된 사본은 회수할 수 없다. 실기기 로그아웃 이후 OS 캐시·메모리 검증은 미실시다.

## 3. Android 실기기

ADB 연결 기기 0개. 사진 선택/업로드, 비교, 공유, 동의, 열람, 푸시, 취소, 종료·재실행, 네트워크 복구, 일정 색상 저장은 **전부 실기기 미검증**. 모바일 폭 Chrome 테스트를 Android 검증으로 간주하지 않는다.

## 4. iOS 실기기

Windows 환경에 연결된 iOS 시험 환경이 없다. 위 Android와 동일한 전체 항목 **미검증**. 스토어 배포도 하지 않는다.

## 5. 일정 색상 저장

- 실제 ScheduleManager, 앱 CSS, 앱에서 사용하는 계정별 JSON 저장/읽기 함수를 사용한 390px Chrome 테스트 통과.
- 버튼 열기→개인 수업 파랑 선택→localStorage 저장값→합성 회원의 실제 일정 카드 파랑 반영→새로고침→Chrome 프로세스 종료·동일 프로필 재실행 후 카드와 선택 상태 유지 확인.
- 계정별 분리·기존 회원/일정 보존 및 저장 실패 전파 테스트 2개 통과.
- 저장 키·JSON 형식과 기존 saveDb의 서버 동기화·실패 처리 흐름은 유지했다. 운영 계정 로그인 후 클라우드 백업/다른 기기 동기화 전체 경로는 이번 테스트에 포함하지 않았다.

## 6. 운영 변경 범위와 롤백

사용자의 웹 배포 요청에 따라 Hosting 두 사이트만 배포 대상이다. 사진 공유 활성화 승인은 없으므로 플래그를 생성하거나 변경하지 않는다. 현재 `runtimeConfig/beforeAfterSharing` 문서는 없다.

| 구분 | 저장소 변경 | 이번 운영 적용 |
|---|---|---|
| 강사 웹 | 일정 색상, 비공개 공유 UI | Hosting만 |
| 회원 웹 | 기본 꺼진 공유 메뉴·동의·비교 UI | Hosting만 |
| 서버 | beforeAfterSharing, notifyBeforeAfterShare, eraseDeletedMemberShares 신규; deleteMemberAccount 정리 연동 | **배포 안 함** |
| Firestore | beforeAfterShares, memberPhotoConsents, runtimeConfig/beforeAfterSharing 직접 접근 deny | **배포 안 함** |
| Storage | Phase 1 운영 규칙과 동일 | 변경 없음 |

웹 빌드는 공식 배포 스크립트의 타입 검사·린트·회귀 테스트 통과 후에만 수행된다. 구버전 native 앱을 배포/업데이트하지 않는다. 신규 공유 서버는 schemaVersion 2 미만 요청을 거절하며, 운영 활성화 전 지원 버전과 실제 인증 E2E를 검증해야 한다.

배포 직전 Hosting 버전: 강사 `sites/pilateacher/versions/28a3be2bd2af1ab9`, 회원 `sites/pilateacher-member/versions/f9aab6e2e207cc26`. 문제 시 해당 사이트 Hosting release를 이전 version으로 되돌린다. 웹만 변경하므로 데이터 롤백/마이그레이션은 필요 없다. 전체 release 응답은 로컬 `hosting-releases.json`에 보관한다.

## 7. 모니터링과 예상 사용량

- 배포 후 두 사이트 HTML·번들 해시를 로컬 산출물과 대조하고, 공유 플래그 부재·기존 파일 generation/체크섬 및 규칙 불변을 재확인한다.
- 운영에서는 일정 저장 오류, 클라우드 동기화 실패, 웹 로딩 오류와 계정별 데이터 유지 여부를 우선 확인한다. 사진/회원 식별값을 공개 로그에 남기지 않는다.
- Phase 2 비활성 상태에서는 공유 사진 전송·공유 이벤트 쓰기가 없다. 활성화 시 목록/상세는 관계·동의·권한·각 사진 문서를 재조회하고, 15초 주기 검증 및 썸네일 개수에 비례해 읽기가 증가한다. 목록 pagination 및 백그라운드 polling 최적화는 후속 과제다.
- 사진 전송은 JPEG 최대 4MB/장 제한, base64 전송량은 원본 JPEG 바이트의 약 4/3이다. 원본 중복 저장은 없다. 활성 공유/취소/미디어 접근은 감사 이벤트 쓰기와 선택적 FCM 사용이 추가된다. 실제 계정 수·사진 수·열람 시간에 따른 부하 계측 전 비용 확정치는 제시하지 않는다.

## 8. 배포 가능 여부와 남은 커밋

**공유를 비활성화한 웹만 배포 가능. Phase 2 운영 활성화 준비는 미완료.** 권한 메타데이터 연결, 고해상도 원본 복원, Auth callable E2E 및 Android/iOS·푸시 검증이 남았다. AI 분석 공유는 별도로 비활성화되어 있다.

`6466b37`은 이번 웹 배포 대상이며 서버 부분은 미배포로 남는다. `319aa80`, `c07207b`, `8f03c32`는 기존 웹에 반영되었던 로컬 커밋이다. 별도 브랜치의 `05dffbe` 중 수업기록 임시저장 기능은 아직 합쳐지지 않았다(색상 부분은 6466b37에 선별 반영). `45c5bb7` 그룹 급여는 c07207b에 동등 반영되어 중복 적용하지 않는다. 원격 push는 자동 배포를 유발할 수 있어 이번 작업에 포함하지 않는다.

추가 수정 파일: `src/App.jsx`, `src/features/schedule/account-db-storage.js`, `tests/schedule/account-db-storage.test.js`, `tests/rules/audited-legacy-photos.rules.test.js`, `tools/qa/schedule-color-shortcut.mjs`, `functions/scripts/final-photo-audit.cjs`, 이 보고서. 기존 Phase 2 전체 구현 목록은 `PHASE2_PRIVATE_SHARING_REPORT.md` 참조.
