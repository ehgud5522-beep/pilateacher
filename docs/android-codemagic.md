# 강사 앱 Google Play 자동 배포

Codemagic에서 `Pilateacher Android Production`을 선택해 한 번 시작하면 웹 검사·빌드,
Capacitor 복사, 서명 AAB 생성, 검증, 프로덕션 제출까지 서버에서 진행한다.
PC를 켜둘 필요가 없다. Google 심사와 관리형 게시 설정에 따라 공개 시점은 달라진다.

## 등록된 자원

- 앱 환경 변수 그룹 `google_play`: Secret 변수 `GOOGLE_PLAY_SERVICE_ACCOUNT_CREDENTIALS` (JSON 원문).
- Android keystore reference `pilateacher-upload-v2-ci` 및 해당 비밀번호·별칭.
- Play Console 서비스 계정에 이 앱의 읽기·프로덕션 출시 권한.
- 패키지 `com.pilateacher.app`. 회원 앱 배포 설정은 변경하지 않는다.

## 실행

1. Applications → pilateacher → Start new build.
2. 배포할 브랜치 선택. 최초 배포는 대표가 선택한 `release/1-1-38` 최신 소스를 포함한
   `codex/android-codemagic-production` 브랜치에서 실행한다. PR 병합은 별도 승인한다.
3. Workflow `Pilateacher Android Production` → Start new build.
4. Publishing 단계와 Play Console의 심사·게시 상태를 확인한다.

Push 자동 실행은 설정하지 않았다. 실행할 버전을 선택한 후 남은 단계만 자동 진행한다.
동일 앱의 배포 빌드는 동시에 실행하지 않는다. 병행 업로드로 번호가 겹치면 Play가
거부하며, 완료 후 새 빌드를 시작하면 실제 최대 번호를 다시 조회한다.

## 검증 및 기록

Play의 모든 트랙 최대 versionCode를 조회하고 `max(소스 코드, Play 최대+1)`을 사용한다.
조회 실패·형식 오류는 중단한다. 숫자를 모르는 상태에서 과거 정책 값으로 대체하지 않는다.
versionName은 소스에 선언한 값(첫 배포 1.1.38)을 유지한다.

기존 가드의 승인 UI 계보·의존성·Firebase·소스 및 자산 검증을 그대로 실행한다.
Codemagic의 detached checkout은 `CM_COMMIT`과 HEAD가 일치할 때만 허용한다.
서명 SHA1은 기존 강사 앱 업로드 인증서 `17:07:22:E5:F1:FD:F0:87:CB:D9:33:26:8B:6D:FF:4B:79:81:7A:09`와 비교한다.
배포 직전에 AAB 안 웹 자산, release manifest 버전·debuggable, jarsigner 서명과
SHA-256을 검증하고 `.android-release/ci-release.json` 등 기록을 산출물로 보관한다.

로컬 `lastPublishedVersionCode`는 실제 게시 후에만 갱신한다. CI 번호 할당은 이
과거 값에 의존하지 않는다. 검토 중 빌드를 게시 완료로 기록하지 않는다.
비밀번호와 서비스 계정 키는 저장소·로그·산출물에 기록하지 않는다.

공식 문서: https://docs.codemagic.io/yaml-publishing/google-play/
