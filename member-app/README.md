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
