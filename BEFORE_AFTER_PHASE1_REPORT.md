# 비포애프터 Phase 1 개발 보고서

작성일: 2026-11-12. 작업 브랜치: `feat/before-after-phase1`.
기준: 로컬 `origin/main`의 `d8ba953`. 원래 작업 폴더의 `codex/firebase-dual-write-v1`는 변경하지 않았다.
작업 위치: `.codex-worktrees/before-after-phase1`.

**상태: 핵심 앨범 기능 구현 및 자동 테스트 완료. 아래 미완료 항목 때문에 Phase 1 전체 출시 완료 조건은 아직 충족하지 않는다. 운영 배포·규칙 배포·실제 회원 데이터 변경은 하지 않았다.**

## 1. 기존 구조에서 확인된 주요 문제

- React/Vite + Capacitor 앱. 주요 화면과 저장 작업은 `src/App.jsx`에 모여 있다.
- 사진은 `pilateacher_photos` IndexedDB의 `blobs`에 저장하고, 계정별 사진 메타데이터는 기존 `phKey(account.id)` localStorage에 저장한다.
- `front / leftSide / side / back / rightSide / custom / poses` 배열과 `sets`를 사용한다. 회원 연결은 사진 맵의 회원 키와 `memberId`, 분석 연결은 `assessmentId`다.
- 기존 목록과 비교는 `normalizeAssessmentSets`가 방향별 대표 사진을 선택하는 촬영 세트 중심이다. 이를 앨범 데이터로 쓰면 같은 날짜·방향의 개별 사진을 모두 다루기 어렵다.
- 백업은 사용자 동의를 받은 계정에만 실행된다. 사진 업로드 대기열, 재시도, Firebase Storage 원본 최적화본/썸네일, Firestore 사진 manifest/graph가 이미 있다.
- Storage는 `users/{uid}/photos/{photoId}`에서 인증된 소유자만 접근한다. `getBlob`을 사용하며 공개 다운로드 링크를 만들지 않는다. 그러나 담당 변경 후 과거 소유자 백업 권한을 회수하는 회원 단위 서버 검증은 없다.
- 기존 작은 JPEG 백업의 무재인코딩 경로는 갤러리 EXIF/GPS를 그대로 보낼 수 있어 새 업로드 경로에서는 재인코딩하도록 보강했다.

## 2. 수정·추가한 파일

| 파일 | 변경 |
| --- | --- |
| `src/App.jsx` | 사용자용 명칭 변경, 앨범 연결, 다중 등록/회원 변경/삭제/선택 AI 연결, 초안 삭제 처리, EXIF 제거 업로드 |
| `src/features/photos/BeforeAfterAlbum.jsx` | 간결한 회원 목록, 날짜별 앨범, 가져오기, 편집, 비교 UI |
| `src/features/photos/album.css` | 기존 테마 변수와 핫핑크를 사용하는 앨범 스타일 |
| `src/features/photos/album-model.js` | 기존 자료 읽기 호환 계층, 날짜·방향 편집, 회원 이동, 삭제 정합성, JPEG EXIF 촬영일 읽기 |
| `src/features/photos/album-drafts.js` | 계정별 IndexedDB 가져오기/편집 초안 |
| `src/features/photos/album-render.js` | 비율 유지 편집 렌더링·비교 배치 |
| `src/features/backup/cloud-backup.js` | 사진 삭제 후 분석 수치만 별도 graph에 보존·복원 |
| `src/features/backup/photo-optimizer.js` | 작은 JPEG도 선택적으로 메타데이터 제거 |
| `src/features/schedule/daily-sentence.js` | 사용자 안내 명칭 변경 |
| `tests/posture/album.test.js`, `tests/posture/album-ui.test.js` | 앨범 데이터·백업·EXIF·삭제·렌더링 검증 |
| `tests/members/member-lifecycle.test.js` | 변경된 명칭 기대값 |
| `tests/posture/body-photo-surfacing.test.js`, `posture-editor-1b.test.js`, `posture-model.test.js`, `posture-result-simplification.test.js`, `posture-ui-reduction.test.js` | 변경된 명칭·한국어 조사 기대값 |
| `tests/ui/first-run-forms.test.js`, `screen-render-smoke.test.js` | 변경된 화면 명칭 기대값 |

## 3. 적용 UI·기능

- 하단 탭 및 사용자 안내의 “변화 기록”을 “비포애프터”로 변경. 내부 collection/키 이름은 유지.
- 회원 이름 검색, 전체 회원/사진 있음/비교 가능 필터, 최근 사진·날짜·개수 목록.
- OS 파일 선택 인터페이스를 통한 다중 갤러리 가져오기. 한 장 저장 가능. 회원 상세에서는 회원 자동 지정, 목록에서는 검색 선택.
- JPEG EXIF DateTimeOriginal 날짜 인식. 없는 경우 오늘 날짜를 제안하고 “촬영일 확인 필요”를 표시. 각 사진 날짜와 5가지 방향을 수정 가능.
- 같은 날짜·방향에 여러 사진 저장. 파일 SHA-256 기반 안정적 ID로 등록 재시도 중복 방지.
- 선택 파일은 계정별 별도 IndexedDB 초안으로 보관. 일부 사진만 저장된 후 실패해도 초안을 유지하여 재시도할 수 있다.
- 원본 파일은 기존 IndexedDB에 유지. 편집은 `albumEdit` 값만 저장한다. 가장자리 자르기, 회전·수평, 확대, 위치, 밝기, 원본 복원 및 재편집 제공.
- 날짜·방향별 앨범과 최신/오래된 순 정렬. 어떤 날짜든 두 장 선택 후 비교 가능.
- 날짜순 BEFORE/AFTER 제안, 위치 교체, 비교 중 사진 재선택, 나란히/슬라이더 겹침, 개별 확대·위치·기준선, 기존 이미지 저장 함수 연결.
- 사진 방향이 다르면 정확한 체형 비교가 어려울 수 있음을 안내.
- AI 화면은 기본적으로 열지 않는다. 선택한 사진으로 별도 분석 초안을 만들고 기존 분석 화면에서 재개한다. 원본 앨범 저장 성공 여부와 AI 성공 여부를 분리했다.
- 분석용 복사본과 원본은 앨범에서 중복 집계하지 않는다. 사진 삭제 시 연결된 복사 이미지와 비교 참조를 정리하고 분석 수치는 보존한다.
- 저장 중/기기 임시 저장/서버 저장 완료/동기화 실패와 백업 재시도·기존 동의 설정 진입 제공. 서버 상태 표시는 기존 계정 전체 백업 상태 기준이다.

## 4. 기존 데이터 호환·롤백

- 기존 배열, 사진 ID, blob ID, assessment ID, 분석 결과, 비교 세트를 일괄 변환하거나 삭제하지 않는다.
- 앨범은 기존 개별 사진을 읽는 호환 뷰다. 예전 `side`는 좌측면으로 표시한다. 기존 위치·회전·확대 값도 읽는다.
- 기존 촬영 세트에 연결된 사진의 날짜·방향 변경은 `albumDate / albumView` 오버라이드로 저장해 분석 원래 속성을 보존한다.
- 새 사진은 `albumVersion: 1`, `memberVisible: false`를 추가한다. `albumEdit`는 이미지 바이트를 바꾸지 않는다.
- 사진을 삭제한 분석은 `photoDeleted: true` 상태로 수치를 남긴다. 해당 이미지 manifest는 제거하며 분석 수치는 graph의 `analysesWithoutPhotos`에 보관한다.
- 사용자 명시 삭제는 기존 백업 삭제 대기열·30일 서버 보관 정책을 따른다. 일반 저장/동기화 실패에서는 임시 원본을 지우지 않는다.
- 배포 전에는 현재 브랜치를 적용하지 않으면 이전 코드로 돌아갈 수 있다. 새 데이터를 만든 후 구버전으로 되돌리면 `albumEdit`와 분석만 남긴 graph를 이해하지 못하므로 **구버전에서 사진 변경·백업을 실행하지 말고 먼저 새 버전으로 내보내기 백업**이 필요하다. 운영 데이터 마이그레이션은 실행하지 않았다.

## 5. 테스트와 결과

- `npm run build`: 타입 검사, 런타임 린트, 전체 Node 테스트, 시간대별 테스트 및 Vite 빌드 통과. 전체 마지막 집계 3,753건 중 3,606 통과 / 147 건너뜀 / 실패 0. 이 실행 후 아래 삭제 정합성 보강을 추가했다.
- 최종 보강 후 `npm run typecheck`, `npm run lint:runtime`: 통과.
- 최종 앨범·백업 집중 검증: `node --test tests/posture/album*.test.js tests/backup/*.test.js` — **87 통과 / 실패 0 / 건너뜀 0**.
- 전체 posture+backup 집중 검증: 520건 중 435 통과 / 85 건너뜀 / 실패 0. 마지막 원본/분석복사본 정리 보강은 위 최종 87건에서 재검증했다.
- `npm run test:rules`: Firestore + Storage 에뮬레이터 **404 통과 / 실패 0**. 샌드박스 포트 제한으로 첫 실행 실패 후 허용된 환경에서 재실행했다. 운영 서버를 대상으로 하지 않았다.
- Vite 프로덕션 빌드 통과. 기존 큰 번들 크기 경고는 남아 있다.
- 렌더링 테스트는 실제 새 앨범 컴포넌트에서 동일 날짜 5장 표시와 AI 미실행을 확인한다. 실기기 터치/화면 캡처 QA, 실제 로그인·회원 사진으로 확인한 결과는 아니다.
- 로그: `album-build.log`, `album-rules.log`, `album-targeted.log`, `album-final-tests.log`, `album-vite.log`.

## 6. 미완료·제한 — 출시 전 필수 확인

1. **담당 회원별 서버 권한:** 현재 명부 범위는 UI/저장 작업에서 확인하지만 Storage 규칙은 기존 계정 소유권 기준이다. 담당 변경·퇴사 후 과거 계정 접근을 회수하려면 센터 client ID·조직 membership과 결합한 서버 정책이 필요하다. 기존 백업 접근을 임의로 차단하는 규칙 변경은 하지 않았다.
2. **원본의 서버 복원:** 기기에는 선택한 원본을 보존하지만 기존 서버 백업은 최대 1800px 최적화본이다. 원본 해상도·바이트 단위의 서버 복원은 미구현이다. 기기 분실 시 원본까지 복원 완료라고 표시하지 않는다.
3. **기존 분석 사진 회원 변경:** 연결된 세트/분석을 끊지 않도록 제한했다. 새 독립 앨범 사진의 회원 변경만 지원한다. 기존 연결 전체의 안전한 이동 설계가 필요하다.
4. **실기기 선택기:** HTML 시스템 파일 선택기를 사용하며 광범위 갤러리 권한을 새로 요청하지 않는다. Android Photo Picker 전용 네이티브 연결 및 iOS 다중 선택·HEIC·백그라운드 복귀 검증은 하지 못했다.
5. **촬영일 자동 인식 범위:** JPEG EXIF만 지원. HEIC 등 다른 메타데이터와 시간대 추정은 수동 확인 대상이다. 방향 자동 제안은 미구현.
6. **편집 UX:** 자르기는 가장자리 비율 방식이다. 자유 사각형 핸들 자르기, 제스처 드래그/핀치, 모바일 접근성·화면별 시각 검증은 추가 개선 대상이다.
7. **신뢰성 검증:** 실제 기기 강제 종료·저장 공간 부족·네트워크 단절 중 복구 및 실제 사진 저장/공유 시트 테스트가 필요하다. 자동 테스트만으로 이 시나리오의 실기기 통과를 주장하지 않는다.
8. 당일 수업 회원/최근 조회 회원 우선 노출, 사진별 서버 업로드 진행률, 백업 원본 자동 복원 강화는 미구현이다.

## 7. Phase 2 활용 구조

- 기존 회원 ID + 안정적 `photoId`, 촬영일·방향, 원본 참조, `albumVersion`, 비파괴 `albumEdit`를 재사용할 수 있다.
- 사진 자체에는 고정 BEFORE/AFTER 속성을 새로 저장하지 않는다. 비교 역할은 화면의 두 사진 선택 순서로 결정한다.
- `sourcePhotoId`는 선택 사진에서 파생한 AI 분석과의 연결용이다.
- 새 사진의 `memberVisible: false`는 기본 비공개 의도를 표현한다. **이 플래그 자체는 권한 장치가 아니다.** 회원앱 read 권한·전송 API·알림을 추가하지 않았다.
- Phase 2 전에 센터 canonical client ID 매핑, 동의 버전, 목적별 공유 승인, 만료/철회, 원본 접근 감사 및 서버 강제 권한 모델을 확정해야 한다.

## 8. 추가 개선 우선순위

1. 담당 변경·퇴사까지 포함한 사진 권한 모델과 원본 백업 정책 확정.
2. iOS/Android 실기기에서 요청서의 12개 시나리오 실행 및 시각 QA.
3. 가져오기 선택 사진 미리보기, 네이티브 picker, HEIC/EXIF 처리 확장.
4. 비교/편집 제스처, 자유 자르기, 당일 회원 우선 노출.
5. 사진별 동기화 revision·원본 복원, 대량 갤러리 가상화 및 App.jsx 기능 분리.
