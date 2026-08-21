# Android 비공개 테스트 릴리스 안전 절차

## 왜 필요한가

버전 코드가 높아도 그 안의 화면 소스가 최신이라는 보장은 없습니다. 과거 13번 빌드는 Android 버전만 올렸지만, 직전 승인 UI의 계보가 아닌 별도 작업 브랜치에서 만들어져 예전 화면이 포함됐습니다.

## 반드시 사용하는 명령

```powershell
npm run android:release:build
```

이 명령은 다음 조건 중 하나라도 맞지 않으면 AAB 생성을 중단합니다.

- 작업 폴더에 커밋하지 않은 변경이 있음
- Android 전용 릴리스 브랜치가 아님
- 직전 승인 UI 기준 커밋을 포함하지 않음
- Play에 게시된 마지막 버전 코드보다 크지 않음
- 정상 UI에 필요한 핵심 패키지가 없음
- 핵심 UI 파일 크기가 승인본 대비 비정상적으로 작음
- `dist`와 Android 앱에 복사된 웹 자산이 다름
- 타입 검사나 자동 테스트가 실패함

서명된 AAB는 업로드 전에 반드시 아래 명령으로 다시 확인합니다.

```powershell
npm run android:release:verify -- C:\absolute\path\to\signed-release.aab
```

검증에 성공하면 `.android-release` 폴더에 커밋, 버전, AAB SHA-256이 기록됩니다. Play Console에는 이 기록과 SHA-256이 일치하는 AAB만 업로드합니다.

## 새 버전 배포 후 정책 갱신

배포가 실제로 승인·게시된 뒤에만 `release/android-release-policy.json`의 다음 값을 갱신합니다.

- `approvedUiBaseCommit`: 승인된 UI가 들어 있는 기준 커밋
- `lastPublishedVersionCode`: Play에 게시된 버전 코드
- `lastPublishedVersionName`: Play에 게시된 버전 이름

정책 파일을 먼저 올리거나 검토 중인 버전을 게시 완료로 기록하지 않습니다.
