# Android 비공개 테스트 릴리스 안전 절차

## 왜 필요한가

버전 코드가 높아도 그 안의 화면 소스가 최신이라는 보장은 없습니다. 과거 13번 빌드는 Android 버전만 올렸지만, 직전 승인 UI의 계보가 아닌 별도 작업 브랜치에서 만들어져 예전 화면이 포함됐습니다.

## 릴리스 순서

아래 네 단계를 순서대로 끝내야 릴리스가 완료됩니다. 4단계를 빼먹으면 다음 릴리스의 중복 versionCode를 아무도 막지 못합니다.

### 1. versionCode 올리기

`android/app/build.gradle`의 `versionCode`를 `release/android-release-policy.json`의 `lastPublishedVersionCode`보다 크게 올립니다. Play가 강제하는 것도 이것뿐입니다.

`versionName`은 정책의 `lastPublishedVersionName`과 **같아도 됩니다**. 한 마케팅 버전으로 테스트 빌드를 여러 번 돌리는 것이 현재 방식이라, 가드는 versionName이 **낮아지는 경우에만** 막습니다.

`tests/android/upgrade-data-preservation.test.js`가 현재 `versionCode`를 고정하고 있으므로 같이 갱신합니다.

### 2. 빌드

```powershell
npm run android:release:build
```

이 명령은 다음 조건 중 하나라도 맞지 않으면 AAB 생성을 중단합니다.

- 작업 폴더에 커밋하지 않은 변경이 있음
- Android 전용 릴리스 브랜치가 아님 (`^codex/android-`, `^release/android-`)
- 직전 승인 UI 기준 커밋을 포함하지 않음
- Play에 게시된 마지막 버전 코드보다 크지 않음
- 정상 UI에 필요한 핵심 패키지가 없음
- 핵심 UI 파일 크기가 승인본 대비 비정상적으로 작음
- `dist`와 Android 앱에 복사된 웹 자산이 다름
- 타입 검사나 자동 테스트가 실패함

서명에는 `android/keystore.properties`와 그 안의 keystore 파일이 필요합니다. 저장소에 없으므로 릴리스를 만드는 PC에만 둡니다. `jarsigner`를 쓰므로 JDK가 PATH에 있어야 합니다 (`C:\Program Files\Android\Android Studio\jbr\bin`).

### 3. 업로드 전 검증

```powershell
npm run android:release:verify -- C:\absolute\path\to\signed-release.aab
```

검증에 성공하면 `.android-release` 폴더에 커밋, 버전, AAB SHA-256이 기록됩니다. Play Console에는 이 기록과 SHA-256이 일치하는 AAB만 업로드합니다.

### 4. 게시 후 정책 갱신 (필수)

배포가 실제로 승인·게시된 뒤에 `release/android-release-policy.json`을 갱신하고 커밋합니다.

- `lastPublishedVersionCode`: 방금 Play에 게시된 버전 코드 — **Play의 최대 versionCode와 항상 같아야 합니다**. 이 값 하나가 중복 versionCode를 막는 유일한 장치입니다
- `lastPublishedVersionName`: 방금 게시된 버전 이름
- `approvedUiBaseCommit`: UI 기준선이 바뀐 릴리스에서만 갱신

3단계가 성공하면 여기에 써넣을 정확한 값을 화면에 출력합니다. 그대로 옮겨 적으면 됩니다.

정책 파일을 먼저 올리거나 검토 중인 버전을 게시 완료로 기록하지 않습니다.

> 이 단계가 오래 빠져 있으면 가드가 무력해집니다. 실제로 Play 최대값이 42가 될 때까지 정책은 15에 머물러 있었고, 그 사이 16~42 어느 값으로 빌드해도 가드를 그냥 통과했습니다.
