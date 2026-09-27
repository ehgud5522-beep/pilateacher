# 회원 앱 (`com.bonitapilates.member`)

회원이 자기 잔여와 수업 이력을 보는 앱. **강사 앱과 같은 저장소, 같은 Firebase
프로젝트, 다른 번들이다.**

웹 화면은 저장소 루트의 [`member/`](../member) 에 있고 `dist-member/` 로
빌드된다. 이 폴더는 그 결과물을 iOS·Android 에 담는 **껍데기만** 갖는다.

## 강사 앱과 섞이지 않게

두 앱이 한 저장소에 있고 Capacitor 는 폴더마다 설정이 따로다. 명령이 섞이면
**회원 앱 빌드가 강사 앱의 `android/` 를 덮어쓴다** — 되돌릴 방법이 마땅치
않고, 그 사실은 빌드가 끝난 뒤에야 드러난다.

그래서 이름으로 가른다.

| | 강사 앱 | 회원 앱 |
| --- | --- | --- |
| 설정 | `capacitor.config.json` (루트) | `member-app/capacitor.config.json` |
| 웹 출력 | `dist/` | `dist-member/` |
| 네이티브 | `android/`, `ios/` (루트) | `member-app/android/`, `member-app/ios/` |
| 동기화 | `npm run android:aab` 안에서 | `npm run member:sync` |
| 빌드 | `npm run android:aab` | `npm run member:aab` |

**루트의 `android/`·`ios/` 는 강사 앱의 것이다. 회원 앱 작업에서 건드리지
않는다.**

## 확정된 것

- 번들 ID `com.bonitapilates.member` (iOS·Android 같게)
- 앱 이름 **보니따필라테스**
- 서명: 강사 앱과 **같은 업로드 키**
- Android 는 비공개 테스트부터, iOS 는 푸시와 오프라인 표시까지 넣고 제출

## 네이티브 폴더

`member-app/android/` 과 `member-app/ios/` 가 있다. `npx cap add` 로 만들었고,
**`member-app` 안에서** 불렀다.

### 여기 `package.json` 이 있는 이유

Capacitor CLI 는 실행한 폴더에 `package.json` 이 없으면 시작하지 않는다. 그런데
그 파일은 자리 채우기가 아니다 -- CLI 는 **그 파일의 의존성만 읽어** 네이티브에
넣을 플러그인을 고른다 (`@capacitor/cli` 의 `plugin.js`).

그래서 이 파일이 회원 앱의 플러그인 경계다. 루트에는 카메라·녹음기·음성인식이
있지만 여기 적지 않았으므로 회원 앱에 들어가지 않는다. 실제로 `cap add` 가
찾은 플러그인은 하나였다.

```
[info] Found 1 Capacitor plugin for android:
       @capacitor-firebase/authentication@8.3.0
```

권한이 딸려 들어가면 스토어가 "회원 조회 앱이 왜 마이크가 필요하냐" 고 묻고,
답할 말이 없다.

**`member-app` 안에서 `npm install` 을 하지 않는다.** 여기 `node_modules` 가
생기면 같은 플러그인이 두 벌이 되고, 루트의 `postinstall` 패치가 한쪽에만
걸린다 -- 강사 앱에서 고친 버그가 회원 앱에 살아 있게 된다. Node 해석이
루트로 올라가게 두고, 대신 버전 범위가 갈라지지 않는지 테스트가 지킨다
(`tests/member/member-app-shell.test.js`).

### Firebase 설정 파일

| 자리 | 파일 |
| --- | --- |
| `member-app/android/app/google-services.json` | Android |
| `member-app/ios/App/App/GoogleService-Info.plist` | iOS |

**받을 때 파일 안을 열어 본다.** 콘솔에서 내려받으면 두 앱 것이 이름이 같아서
다운로드 폴더에서 `google-services.json` 과 `google-services (4).json` 으로
섞인다. 이름으로 집으면 회원 앱에 강사 앱 설정이 들어가고, 그것은 문자 인증이
조용히 실패할 때까지 드러나지 않는다.

- Android: `client[].client_info.android_client_info.package_name` 에
  `com.bonitapilates.member` 가 있어야 한다
- iOS: `BUNDLE_ID` 가 `com.bonitapilates.member` 여야 한다

Android 파일에는 강사 앱 항목도 함께 들어 있다 -- Firebase 가 프로젝트 단위로
내보내기 때문이고, Gradle 플러그인이 `applicationId` 로 골라 쓴다. 정상이다.

**iOS 는 파일을 넣는 것만으로 끝나지 않는다.** `cap add` 로 만든 Xcode
프로젝트는 그 파일을 모른다 -- 폴더에 있어도 번들에 복사되지 않고, 앱은
Firebase 없이 뜬다. 그러면 문자 인증이 "안 된다" 가 아니라 **아무 일도 안
일어난다**. `project.pbxproj` 의 Resources 빌드 단계에 걸어 뒀고, 테스트가
그것을 지킨다.

## 지문 두 종류 — 둘 다 등록한다

Android 문자 인증은 Play Integrity 로 앱을 확인하는데, 그 확인은 **앱에 실제로
서명된 인증서**를 본다. 그리고 그 인증서가 두 개다.

| | 언제 쓰이나 | 어디서 얻나 |
| --- | --- | --- |
| **업로드 키** | PC 에서 만든 APK·AAB 를 직접 설치해 시험할 때 | `keytool` (아래) |
| **앱 서명 키** | **Play 로 받은 앱 전부** — 내부·비공개 테스트 포함 | Play Console |

**앱 서명 키 쪽이 진짜 필요한 것이다.** Play 앱 서명을 쓰면 스토어가 업로드된
번들을 구글이 관리하는 키로 다시 서명한다. 업로드 키 지문만 등록하면 PC 에서
직접 설치한 것만 문자 인증이 되고, **테스터가 Play 로 받은 앱은 안 된다** --
그런데 화면은 reCAPTCHA 를 띄우므로 고장처럼 보이지 않는다.

업로드 키 지문:

```powershell
# storeFile · keyAlias · 비밀번호는 keystore.properties 에 있다
keytool -list -v -keystore <storeFile> -alias <keyAlias>
```

앱 서명 키 지문은 **첫 AAB 를 올린 뒤에** 생긴다:

Play Console → 앱 선택 → **테스트 및 출시** → **설정** → **앱 서명** →
**앱 서명 키 인증서** 의 SHA-256

둘 다 Firebase 콘솔 → **프로젝트 설정** → **내 앱** → `com.bonitapilates.member`
→ **디지털 지문 추가** 에 넣는다.

**`google-services.json` 을 다시 받을 필요는 없다.** 지문 확인은 Play Integrity
가 서버에서 한다. 다시 받아야 하는 것은 구글 로그인을 쓸 때 (`oauth_client` 의
`certificate_hash`) 인데 회원 앱은 번호 인증만 쓴다.

## APNs — iOS 문자 인증이 조용히 reCAPTCHA 로 가지 않게

iOS 전화 인증은 **무음 푸시**로 기기를 확인한다. 그 길이 막히면 실패하지 않고
reCAPTCHA 로 되돌아간다 -- 고장이 아니라 "느리고 이유 없는 문턱" 으로 보여서,
빠진 줄 모른 채 쓰게 된다.

필요한 것이 셋이고, 하나는 코드에 이미 있다.

1. **푸시 권한 (코드)** — `member-app/ios/App/App/App.entitlements` 의
   `aps-environment`, 그리고 `project.pbxproj` 두 빌드 설정의
   `CODE_SIGN_ENTITLEMENTS`. 들어가 있다
2. **App ID 에 Push Notifications 체크** — Apple Developer →
   Certificates, Identifiers & Profiles → **Identifiers** →
   `com.bonitapilates.member` → Push Notifications
3. **APNs 인증 키를 Firebase 에** — 아래

APNs 인증 키는 **앱이 아니라 팀 단위**다. 강사 앱에 이미 올렸으면 **같은 `.p8`
을 회원 앱 항목에도 올리면 된다** -- 새로 만들지 않는다 (팀당 최대 2개다).

새로 만드는 경우:

1. Apple Developer → **Account** → **Certificates, Identifiers & Profiles**
2. 왼쪽 **Keys** → **＋**
3. 이름을 적고 **Apple Push Notifications service (APNs)** 체크 →
   **Continue** → **Register**
4. **Download** — `.p8` 은 **이 화면에서 한 번만** 받는다. 다시 못 받는다
5. **Key ID** 는 같은 화면에 있고 파일 이름에도 있다
   (`AuthKey_ABCD123456.p8` → `ABCD123456`)
6. **Team ID** 는 Apple Developer → **Account** → **Membership details**

Firebase 에 올리기:

7. Firebase 콘솔 → **프로젝트 설정** → **클라우드 메시징**
8. **Apple 앱 구성** 에서 `com.bonitapilates.member` 항목 (강사 앱과 별도다)
9. **APNs 인증 키 → 업로드** → `.p8` 선택 → Key ID · Team ID 입력

### `aps-environment` 가 development 인 것

Xcode 가 푸시 권한을 켤 때 적는 값이고, 저장소에 들어가는 값도 이것이다.
App Store 배포용으로 아카이브할 때 도구가 `production` 으로 바꾼다.

**첫 Codemagic 빌드에서 한 번 확인한다.** 배포된 앱의 실제 권한은 이렇게 본다:

```bash
codesign -d --entitlements :- /path/to/App.app
```

### 서명

강사 앱과 **같은 업로드 키**를 쓴다. 다만 설정 파일은 이 폴더의 것을 읽는다.

```
member-app/android/keystore.properties
```

`android/keystore.properties` 와 같은 모양이고 (`storeFile` `storePassword`
`keyAlias` `keyPassword`), **저장소에 들어가지 않는다.** 대표 PC 에만 있다.
`storeFile` 은 절대 경로로 적으면 두 앱이 같은 키 파일을 가리킬 수 있다.

없으면 `release` 작업이 시작하는 자리에서 멈춘다. 서명 안 된 번들은 Play 가
거절하는데, 그 사실은 업로드까지 가서야 드러나기 때문이다.

## 1단계에 들어간 것

| | |
| --- | --- |
| 네이티브 문자 인증 | `member/src/phone-auth.js` · 웹뷰 reCAPTCHA 를 안 태운다 |
| 계정 삭제 | `functions/src/member-account.js` · App Store 5.1.1(v) |
| 오프라인 표시 | `member/src/offline-cache.js` · 14일까지, 나이를 함께 |

### 아직 안 한 것

- **Play Console 에 앱 만들기** → 첫 AAB 업로드 → 앱 서명 키 지문 등록
- **App Store Connect 에 회원 앱 등록** → Codemagic 회원 앱 워크플로
  (`codemagic.yaml` 에 아직 없다 -- 강사 앱 워크플로 하나뿐이다)
- SHA 지문 · APNs 키 등록 (위)
- 앱 아이콘 · 스플래시
- 푸시 알림 (2단계)
