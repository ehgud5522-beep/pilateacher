# 사진 백업 대기열·오류 전달 수정

기준: origin/main `cc2f4a4`. 브랜치: `codex/photo-backup-queue-diagnostics`.
기존 main·release 브랜치를 변경하지 않는 별도 워크트리 작업이다. 실제 403의 원인을 추측해 권한을 넓히는 변경이 아니다.

## 처리 방식

- 사진 하나가 실패해도 다음 사진을 처리한다. 성공한 작업만 완료 처리하며 실패한 사진·작업·원본은 보존한다.
- 기존 localStorage 키와 작업 형식을 유지한다. 구버전의 revision 없는 항목도 읽고, 처리 도중 새 revision이 만들어진 경우 이전 작업 완료로 새 항목을 지우지 않는다.
- 실패 시 정제된 사진별 진단과 재시도 횟수를 같은 대기열에 저장한다. 앱 재실행이나 같은 항목 upsert로 권한 오류의 자동 재시도가 다시 열리지 않는다.
- 권한·인증·요청·연결·무결성 오류 및 미분류 오류는 수동 ‘다시 시도’만 허용한다. 명시적으로 분류한 네트워크·시간초과·일시 서버 오류만 지연 후 자동 재시도한다. 최초 시도 포함 최대 3회이며 이후 수동 재시도 상태로 남긴다.
- 타이머는 계정 변경/종료 시 정리하고, 기기 원본은 지우지 않는다.

## 진단과 표시

`photo_backup` 실패마다 단계, 계층, 원본 SDK 코드, 서버 사유 코드, 사진 ID 앞 8자리, 조직/회원 ID 존재 여부, appBuild, platform을 남긴다. 사진별 상태와 deviceLog는 같은 진단 객체를 사용한다. 화면에 성공/실패 수, 권한·네트워크/일시 장애·기타 분류와 코드를 표시한다. 다른 데이터 백업이 진행 중이어도 사진 실패 내역은 유지해 보인다.

단계: prepare_access, original_metadata, original_upload, original_verify, image_upload, manifest_write, delete.

서버 사유는 details.reasonCode를 우선 읽고 기존 서버의 message 코드도 호환한다. 임의 오류 원문 전체는 기록하지 않는다. 정해진 photo/* 사유 코드만 추출하므로 이름·전화번호·토큰·경로·사진 내용은 진단에 포함하지 않는다. 원본 SDK 코드 대신 backup/queue-failed를 기록하던 처리를 제거했다.

선택 서버 변경은 preparePhotoAccess의 catch뿐이다. 기존 permission-denied 판정은 유지하고 logger.warn과 HttpsError.details에 단계·정해진 사유 코드만 넣는다. 실제 허용/거절 로직은 바꾸지 않았다. 이 변경도 배포하지 않았다.

## 삭제 작업

서버 상태를 조회한 뒤 기존 문서만 updateDoc으로 삭제 표시한다. 빈 memberId·참조·파일 경로를 가진 삭제 문서를 새로 만들거나 기존 편집/참조 데이터를 비우지 않는다. 서버에서 ‘문서 없음’이 확인되면 쓰기를 생략한다.

현재 규칙은 없는 문서 조회도 permission-denied로 응답할 수 있다. 이 경우 부재가 확인된 것으로 취급하지 않는다. 삭제 항목과 코드가 남고 다른 업로드는 계속한다. 권한 오류를 무시해 서버 정리가 끝났다고 표시하는 방식은 사용하지 않았다. 권한 규칙을 변경하지 않는 범위에서의 의도적인 한계다.

## 수정 파일

- src/features/backup/cloud-backup.js: 대기열 계속 처리, 실패 보존, 수동/제한 자동 재시도.
- src/features/backup/photo-errors.js: 단계별 원본 오류 보존·진단 정제·분류·화면 문구.
- src/features/backup/photo-delete.js: 부재 확인 후 쓰기 생략, 조회 오류 보존.
- src/features/backup/original-backup.js, src/lib/firebase.js: 각 SDK 단계 표시, 안전한 삭제 문서 갱신.
- src/App.jsx: 대기열 결과·진단·상태 연결, 재시도 타이머 및 수동 재시도.
- src/features/photos/BeforeAfterAlbum.jsx: 성공/실패 수 및 사진별 코드 표시.
- functions/src/index.js, functions/src/photo-access-diagnostics.js: 사유 코드만 기록·반환.
- tests/backup/cloud-backup.test.js, tests/backup/photo-queue-failures.test.js, tests/posture/album-ui.test.js, functions/tests/photo-access-diagnostics.test.js: 회귀 검사.
- docs/handoff.md 및 이 문서: 인수인계.

## 검증 및 제한

| 명령 | 결과 |
|---|---|
| npm run test:node (npm run build의 prebuild에서 실행) | 3,633 통과, 147 제외, 실패 0 |
| npm run build | 타입·런타임 린트·일반 테스트·+30일/+365일 회귀·Vite 빌드 성공. 세 테스트 실행 각각 동일한 통과/제외 수 |
| npm --prefix functions test | 353 통과, 실패/제외 0 |
| npm run test:rules | 422 통과, 운영 감사 자료 필요 1개 제외, 실패 0 |
| npm run typecheck | 성공 |

앱 제외 147개는 비활성 360° 바디뷰 145개, 로컬 회원 앱 Firebase 네이티브 설정 1개, 릴리스 서명 설정 1개다. 제외를 통과로 보지 않는다. 최초 병렬 실행의 마지막 Vite 기반 테스트가 종료되지 않아 해당 실행을 중단하고 단독으로 전체 빌드를 재실행했으며 최종 실행은 성공했다. 큰 번들 경고는 기존대로 남아 있다.

핵심 단위 테스트는 첫 실패 후 다음 2장 성공, 실패 보존, 재실행/upsert 후 자동 재시도 차단, 네트워크 재시도 제한, 구 대기열 호환, revision 보존, 단계·사유 코드 및 개인정보 제외, 삭제 조회 실패 시 다음 업로드 진행을 확인했다. 실제 앨범 렌더링에서도 성공/실패 수·사진 식별값·단계·코드 표시를 검사했다.

실기기, 운영 403의 실제 개별 사유, 운영 CORS/다운로드 동작은 이번 변경으로 검증하지 않았다. 이 PR의 목적은 다음 승인된 앱 빌드에서 원인을 구분할 수 있게 하는 것이다. firestore.foundation.rules·storage.rules·photo-access 권한 판단·회원 연결·CORS·홀딩·결제·일정 로직은 변경하지 않았다.

병합·함수 배포·웹 배포·release/1-1-50 반영·스토어 업로드는 하지 않는다.
