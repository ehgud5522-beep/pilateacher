# PilaTeacher App Review 4.1 수정 및 검증 보고서

> 대상 Bundle ID: `com.pilateacher.app`  
> 작업 브랜치: `codex/apple-review-fixes-v1`  
> 주의: 이 문서는 소스·자동 테스트 결과와 사람이 수행해야 할 Release/iPad 검증을 구분한다. 실제로 수행하지 않은 항목은 완료로 표시하지 않는다.

## 1. Apple 로그인 오류 원인

확인된 직접 원인은 `capacitor.config.json`의 `FirebaseAuthentication.providers`에 `apple.com`이 없었던 것이다. 설치된 `@capacitor-firebase/authentication` iOS 소스는 이 배열에 포함된 provider만 handler로 생성하며, Apple handler가 없으면 `signInWithApple()`을 즉시 거부한다.

- 기존 설정: `providers: ["google.com"]`
- 수정 설정: `providers: ["google.com", "apple.com"]`
- 근거 코드:
  - `node_modules/@capacitor-firebase/authentication/ios/Plugin/FirebaseAuthenticationPlugin.swift`
  - `node_modules/@capacitor-firebase/authentication/ios/Plugin/FirebaseAuthentication.swift`
- 기존 UI는 로그인 중에도 버튼이 활성 상태여서 연속 탭으로 단일 native call/nonce 상태를 덮어쓸 수 있었다.
- 기존 오류 처리는 취소·네트워크·설정·credential 오류를 모두 같은 재시도 문구로 표시했다.
- 소스에는 자동 재시도 루프가 없었다. 심사에서 보인 반복은 설정 누락으로 매번 실패하는 상태와 중복 탭 가능성이 결합된 것으로 판단한다.

Apple Developer Portal의 실제 App ID capability, Firebase Console Apple provider 상태, 서명된 provisioning profile entitlement는 로컬 소스만으로 확인할 수 없으므로 별도 수동 검증이 필요하다.

## 2. 수정 내용

- Apple native provider 등록
- native plugin 미탑재 시 WKWebView popup fallback 대신 설정 오류로 안전 실패
- Apple ID token과 raw nonce 필수 검증
- 로그인 single-flight 및 버튼 비활성화
- 사용자 취소 시 오류 토스트 반복 방지
- 네트워크·설정·credential·알 수 없는 오류 분리
- 로그에는 토큰·nonce·이메일을 남기지 않고 code/source/stage/credential 상태만 기록
- Apple 최초 로그인에서만 제공될 수 있는 이름·이메일을 기존 프로필 값과 병합해 보존
- 계정 영구 삭제 UI, 최근 재인증, callable Function 및 계정별 로컬 정리 추가
- 재실행 가능한 App Review seed 도구 추가(기본 dry-run)

## 3. 계정 삭제 위치

리뷰 경로:

1. 하단 `더보기`
2. `계정`
3. `계정 삭제`
4. 삭제 범위 안내 확인
5. `삭제 절차 계속`
6. `계정 삭제` 문구 직접 입력
7. Apple/Google 재인증 또는 이메일 비밀번호 재입력
8. `영구 삭제`

로그아웃과 계정 삭제는 별도 동작이며, 삭제 버튼은 화면 하단에 숨기지 않았다.

## 4. 계정 삭제 범위

서버가 삭제하는 현재 사용자 전용 데이터:

- `users/{request.auth.uid}` 전체(하위 `backup/latest` 포함)
- `organizations/legacy_{uid}`의 UID 전용 레거시 namespace
- 서버가 `userId == uid`로 조회한 해당 사용자의 membership 문서
- 정확한 개인 Storage prefix `users/{uid}/`(현재 앱 소스에는 업로드 경로가 없지만 미래 호환을 위해 범위를 고정)
- Firebase Authentication 사용자(항상 마지막 단계)

클라이언트가 성공 후 정리하는 데이터:

- `pilateacher_db_{uid}`
- `pilateacher_photos_{uid}`
- 해당 계정 세션과 fallback 계정 항목
- 해당 계정 메타데이터가 참조하는 IndexedDB `blobId`, `cleanBlobId`, `audioBlobId`
- `legacy_{uid}:`로 시작하는 해당 계정 dual-write retry 항목
- 메모리 상태 및 object URL

삭제하지 않는 공용 데이터:

- 다른 강사의 계정과 개인 데이터
- 공유 `organizations`, `locations`, `clients`, `lessons` 및 조직 공용 업무 기록
- `createdBy` 또는 `instructorId`가 같다는 이유만으로 공유 문서를 삭제하지 않음
- 법적·회계상 보존이 필요한 조직 공용 기록

활성 조직의 유일한 owner이면 어떤 삭제도 시작하기 전에 `sole_organization_owner`로 중단하며 다른 owner 지정 안내를 표시한다.

## 5. 재인증 방식

- Apple: native Apple 로그인 → ID token/raw nonce로 Firebase JS 사용자 재인증 → authorization code로 Apple access token revoke → callable 호출
- Google: native Google 로그인 → Firebase credential 재인증 → callable 호출
- Email/password: 현재 이메일과 재입력 비밀번호로 재인증 → callable 호출
- 클라이언트 재인증 뒤 ID token을 강제 갱신한다.
- callable도 `request.auth.uid`와 `auth_time`을 검증하며 클라이언트가 보낸 uid/role/organizationId를 거부한다.
- Auth 삭제는 개인 데이터 단계가 모두 성공한 뒤 마지막에 수행한다.

## 6. 데모 계정 준비 방법

도구: `functions/scripts/seed-app-review.js`

필수 환경변수(값은 Git, 문서, 로그에 기록하지 않음):

- `APP_REVIEW_EMAIL`
- `APP_REVIEW_PASSWORD`
- Admin SDK용 Application Default Credential 또는 `GOOGLE_APPLICATION_CREDENTIALS`

기본 dry-run:

```powershell
npm.cmd --prefix functions run seed:app-review -- --project pilateacher
```

명시적 적용(안전한 관리자 환경에서 사용자가 직접 실행):

```powershell
npm.cmd --prefix functions run seed:app-review -- --project pilateacher --apply
```

- `--apply`가 없으면 Auth/Firestore write를 호출하지 않는다.
- `pilateacher-prod`가 포함된 프로젝트 ID는 즉시 차단한다.
- Admin credential project와 `--project`가 다르면 중단한다.
- 같은 이메일은 기존 UID를 재사용하며 고정 ID/전체 backup 교체 방식으로 중복을 만들지 않는다.
- 현재 로컬 환경에는 Admin credential과 review email/password가 없어 실제 계정을 생성하지 않았다.

## 7. 사전 데이터 내용

- 명백한 placeholder 회원 3명: 활성, 홀딩, 이용권 임박
- 이번 주 개인 수업, 그룹 수업, 완료, 미작성 기록, 노쇼, 취소
- 실제 사람이 아닌 App Review placeholder 이름만 사용
- 수업 기록 예시 1개(실제 의료 판단 없음)
- 하나의 `assessmentId`로 묶인 전면·측면·후면 안전 SVG placeholder 세트 1개
- 분석 방식은 `manual`, 가짜 AI 점수·진단·추천 없음
- seed된 review 계정만 최초 복원 시 placeholder를 기존 IndexedDB 사진 저장 경로로 가져온다.

## 8. 리뷰어 테스트 순서

1. App Review Information의 이메일 계정으로 로그인
2. 일정 탭에서 개인·그룹·완료·노쇼·취소 상태 확인
3. 처리할 업무에서 미작성 기록과 그룹 인원 체크 확인
4. 회원 탭에서 활성·홀딩·이용권 임박 회원 확인
5. 회원 상세와 기존 수업 기록 확인
6. 체형분석 탭에서 저장된 3방향 placeholder 세트 확인
7. 새 분석에서 전면·측면·후면 촬영 진입 확인
8. 더보기 → 계정 → 계정 삭제 경로 확인
9. 삭제 안내와 최종 문구 입력 화면 확인

실제 review 계정을 삭제해 버리면 이후 심사가 막히므로, Apple Notes에는 삭제 UI 확인 후 최종 삭제는 하지 말아 달라고 안내하거나 별도 재생성 절차를 준비한다.

## 9. 수동 설정이 필요한 Apple/Firebase 항목

Apple Developer:

- App ID `com.pilateacher.app`에 Sign in with Apple capability 활성
- Team ID와 Codemagic signing team이 `7ADRYNV3B4`인지 확인
- App Store provisioning profile에 `com.apple.developer.applesignin = Default` 포함
- 최종 signed app entitlement를 `codesign -d --entitlements :-`로 확인

Firebase Console:

- Authentication → Sign-in method → Apple 활성
- Firebase Apple provider의 Team ID, Key ID, private key가 현재 Apple Developer 설정과 일치
- 동일 Apple identity 재로그인 시 기존 Firebase UID가 유지되는지 확인
- 이메일 비공개 릴레이/계정 연결 정책 확인

서버 Function 배포 명령(2026-08-10 실행 완료):

```powershell
firebase deploy --only functions:deleteCurrentUserAccount --project pilateacher --config firebase.ai-gateway.json
```

## 10. Release 빌드 검증 결과

2026-08-10에 아래 항목을 실제 실행했다. 실제 계정 생성·계정 삭제·seed apply와 iPad 검증은 실행하지 않았다.

- [x] npm install (Codemagic 격리 빌드 환경)
- [x] typecheck
- [x] 클라이언트 및 Functions lint
- [x] production build (성공, 기존 dirty `dist`는 사전 백업본으로 복원)
- [x] foundation/dual-write/AI/posture/App Review 클라이언트 테스트 80개
- [x] Functions 테스트 40개
- [x] demo seed 기본 dry-run (`writesPerformed: false`)
- [x] `npx cap sync ios`
- [x] plist/entitlement/project 및 동기화된 provider 정적 검사
- [x] `deleteCurrentUserAccount` Node.js 22 배포 및 ACTIVE 상태 확인
- [x] Codemagic Xcode Release Archive, IPA/dSYM 검증 및 App Store Connect 배포(Build `6a795ba8f5a7d0d1c8281ea9`)
- [ ] iPad Air 11-inch(M3), iPadOS 26.6 신규 설치/Apple 로그인
- [ ] 실제 계정 삭제 end-to-end
- [ ] 실제 demo seed apply 및 로그인

production build에는 Firebase 모듈의 정적/동적 import 중복과 500 kB를 넘는 메인 청크 경고가 있었지만 오류 없이 완료됐다. Codemagic에서 Xcode Archive, 적용된 signing profile, IPA, archive 및 dSYM 검증을 통과했다. 실제 Apple sheet와 iPad 동작은 아직 검증하지 않았다.

## 11. 화면 녹화·캡처 순서

1. iPad 신규 설치 후 앱 실행
2. Apple 로그인 버튼 1회 탭 → Apple sheet → 성공 후 앱 진입
3. 일정/회원/체형분석 사전 데이터
4. `더보기 → 계정 → 계정 삭제`
5. 삭제 범위 안내
6. `계정 삭제` 문구 입력과 provider 재인증 직전 화면
7. 테스트 전용 계정으로 실제 삭제할 경우 로그인 화면 복귀

파일명에는 계정 이메일, 토큰, 실제 회원 이름을 넣지 않는다.

## 12. App Review 회신 초안

### English (use only after device verification)

Hello App Review Team,

We addressed all three items in the new build:

1. Sign in with Apple: the native Apple provider configuration was corrected, repeated sign-in requests are now blocked while a request is in progress, and cancellation/network/configuration/credential errors are handled separately. We verified the Release build on the supported iPad configuration. **Remove the last sentence if the iPad test has not actually been completed.**
2. Account deletion: permanent deletion is available at **More → Account → Delete Account**. The flow explains the deletion scope, requires a second confirmation and recent authentication, deletes the user’s private server/local data, and then deletes the Firebase Authentication account. Shared studio data is preserved.
3. Review access: the demo username and password are provided in App Review Information. The account includes placeholder members, individual/group schedules, attendance/no-show/cancel states, a lesson record, and a safe three-view posture assessment placeholder.

Please use the credentials in App Review Information. A screen recording showing the Apple sign-in and account-deletion path is attached in Review Notes.

Thank you.

### 한국어

안녕하세요, App Review 팀.

새 빌드에서 세 가지 지적 사항을 수정했습니다.

1. Apple 로그인 native provider 설정을 수정하고, 로그인 요청 중 중복 탭을 차단했으며, 취소·네트워크·설정·credential 오류를 구분해 처리했습니다. 지원 iPad의 Release 빌드에서 확인했습니다. **실제 iPad 검증 전에는 마지막 문장을 삭제해야 합니다.**
2. 앱 내 영구 계정 삭제는 **더보기 → 계정 → 계정 삭제**에서 찾을 수 있습니다. 삭제 범위 안내, 2차 확인, 최근 재인증을 거친 뒤 개인 서버/로컬 데이터와 Firebase Authentication 계정을 삭제하며 센터 공용 데이터는 보존합니다.
3. App Review Information에 데모 계정 정보를 입력했습니다. 이 계정에는 placeholder 회원, 개인/그룹 일정, 출석/노쇼/취소, 수업 기록과 안전한 3방향 체형분석 placeholder가 준비되어 있습니다.

로그인 정보는 App Review Information을 확인해 주세요. Apple 로그인과 계정 삭제 경로를 보여 주는 화면 녹화도 Review Notes에 첨부했습니다.

감사합니다.

### App Review Information 체크리스트

- [ ] Username 입력
- [ ] Password 입력(문서/Git에는 기록하지 않음)
- [ ] Notes에 `More → Account → Delete Account` 경로 입력
- [ ] placeholder 데이터 설명 입력
- [ ] 특수 로그인 절차가 있다면 입력
- [ ] Apple 로그인/계정 삭제 화면 녹화 첨부
- [ ] 실제 iPad에서 확인한 내용만 회신에 기재
