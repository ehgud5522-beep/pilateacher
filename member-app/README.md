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

## 아직 없는 것

`android/`·`ios/` 네이티브 폴더는 `npx cap add` 로 만든다. 그 전에 Firebase
콘솔에 앱 두 개를 등록하고 `google-services.json` 과
`GoogleService-Info.plist` 를 받아 와야 한다 — 없으면 네이티브 인증이 붙지
않는다.

넣을 자리는 각각 `member-app/android/app/` 과
`member-app/ios/App/App/` 이다.
