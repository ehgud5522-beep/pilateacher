# PilaTeacher — 작업 규칙

**새 세션은 [docs/handoff.md](docs/handoff.md) 부터 읽는다** — 최근 변경, 대표 결정, 남은 일이 있다.
작업을 끝내면 그 파일을 갱신한다.

필라테스 강사용 앱. React + Vite 웹 앱을 Capacitor로 iOS·Android에 담고, AI 수업기록은
Firebase Functions(`aiGateway`)를 거쳐 OpenAI로 간다. 상세 릴리스 절차는
[docs/android-release-safety.md](docs/android-release-safety.md), 게이트웨이 배포 이력은
[docs/ai-gateway-deploy-log.md](docs/ai-gateway-deploy-log.md), 심사용 계정 준비는
[docs/app-review-account.md](docs/app-review-account.md)에 있다.

같은 웹 앱이 Firebase Hosting 으로도 나가 있다 — 대표가 PC 에서 이관·발급·급여
집계를 하는 자리다. 배포와 도메인은 [docs/web-hosting.md](docs/web-hosting.md)에
있고, 배포는 `npm run deploy:web` 한 줄이다.

## 웹에서 안 되는 것

음성 수업기록은 폰 앱에서만 된다 — 서버 녹음 엔진의 플러그인에 웹 구현이 없다.
화면이 그 사실을 말하고, 판정은 `src/features/voice/web-support.js` 에 있다.

새 네이티브 기능을 붙일 때는 웹에서 어떻게 끝나는지 함께 정한다. "not implemented"
가 권한 거부처럼 보이는 것이 이 앱에서 실제로 일어난 일이다 — 브라우저에서 "마이크
권한을 허용해 주세요" 가 뜨고, 허용해도 아무 일이 일어나지 않았다.

서비스 워커는 프로덕션 웹에서만 등록한다. 개발 서버와 네이티브 앱에서는 등록하지
않고 이미 있는 것을 걷어낸다 (`src/features/ui/service-worker.js`).

## 실패 진단 원칙

실패를 추적할 수 없으면 고칠 수 없다. 아래는 모든 작업에 적용한다.

### 1. 실패를 하나의 문구로 뭉개지 않는다

서로 다른 원인이 같은 화면·같은 로그로 끝나면 안 된다. 어떤 실패든 그 실패만의
종류와 코드를 남긴다.

### 2. 진단에 반드시 남길 것

- `feature` — 어느 기능인가 (voice_record, apple_sign_in, cloud_backup …)
- `stage` — 그 기능의 어느 단계인가
- `errorDomain` — 오류를 만든 계층 (firebase_auth, apple_native, capacitor_plugin, firestore, gateway_http …)
- `errorCode` — 그 계층의 원본 코드. 정규화한 코드로 대체하지 말고 **원본을 함께** 남긴다
- `message` — 원본 문구를 정제해서 그대로. 거부된 필드명·문서 경로는 지우지 않는다
- `correlationId` — requestId 등 서버 로그와 이어 붙일 수 있는 값
- `appBuild`, `platform`, `osVersion`, `deviceModel`
- `timestamp`

정규화한 내부 코드만 남기고 원본 코드를 버리면 안 된다. 원본이 없으면 원인 확정이
불가능하다.

### 3. 사용자 문구는 종류별로 분리한다

| 종류 | 성격 | 자동 재시도 |
| --- | --- | --- |
| network | 연결 불안정 | 예 |
| authentication | 로그인·토큰 | 아니오 |
| permission | 권한 거부 | 아니오 |
| invalid request | 요청이 결정적으로 거부됨 | 아니오 |
| server unavailable | 서버 일시 장애 | 예 |
| data/link conflict | 회원·수업 연결 등 데이터 충돌 | 아니오 |
| user cancellation | 사용자가 취소함 — **오류가 아니다** | 해당 없음 |
| unknown | 분류 실패 | 아니오 |

사용자 취소는 오류 화면을 띄우지 않는다. 조용히 이전 상태를 유지하거나 "취소되었습니다"
정도로만 알린다.

### 4. unknown도 숨기지 않는다

분류하지 못한 실패는 "처리하지 못했어요 (코드 XXXX)" 형태로 추적 가능한 코드를 함께
보여준다. 코드 없는 "오류가 발생했습니다"는 금지한다.

### 5. 사용자가 만든 데이터는 즉시 버리지 않는다

녹음·draft·입력 중이던 내용은 실패해도 보관한다. 사용자가 명시적으로 버리기를 선택할
때만 지운다.

### 6. 자동 재시도는 일시적 오류만

network, unavailable, timeout, rate limit 만 자동 재시도한다.
`invalid-argument`, `invalid_request`, 인증 실패, 권한 거부는 결정적 오류다 — 자동
재시도하지 않고 사용자에게 [다시 시도]를 준다.

### 7. 개인정보·인증정보는 진단에 기록 금지

token, nonce, credential, authorizationCode, identityToken, password, 이메일,
전화번호, 회원 이름, 음성 원문. 존재 여부(`hasIdToken: true`)는 남겨도 되지만 값은
절대 남기지 않는다.

### 8. UI 문구와 진단 코드가 어긋나면 테스트 실패

화면이 "네트워크"라고 말하는데 진단 코드가 `invalid-argument`라면 그것은 버그다.
분류 규칙은 단위 테스트로 고정한다 — 코드 → 종류 → 문구가 한 줄로 이어지는지 검증한다.

## 규칙 테스트를 돌리는 법

```bash
npm run test:rules
```

이 한 줄이면 된다. PowerShell·Git Bash·CI 어디서든 같다.

에뮬레이터는 Java 를 쓰는데 이 기기의 Java 는 PATH 에 없고 Android Studio 안에
있다. `tools/java-home.mjs` 가 JAVA_HOME → PATH → Android Studio 순으로 찾아
**이 프로세스에만** 얹는다 — 경로를 외우거나 셸을 바꿀 일이 없다. 못 찾으면 어디를
봤는지 전부 적어서 말한다.

JDK 가 다른 곳에 있으면 JAVA_HOME 을 정해 두면 그것이 이긴다. Java 가 이미 PATH 에
있는 환경이면 `npm run test:rules:emulator` 로 에뮬레이터를 직접 불러도 된다.

**규칙을 고쳤으면 배포 전에 이것을 돌린다.** 배포는 문법만 본다 — 문이 실제로
열리고 닫히는지는 여기서만 드러나고, 규칙은 한 번 나가면 그 사이의 모든 쓰기에
적용된다.

## 진단 로그가 남는 곳

- `deviceLog(...)` — 기기 진단 (`더보기 → 진단`)
- `appendVoiceSessionDiagnostic(...)` — 음성 세션 30건
- `appendLessonRecordDiagnostic(...)` — 수업기록 파이프라인 20건
- Functions: `firebase functions:log --only aiGateway --project pilateacher`

## 360° 바디뷰 · 인물 분리(세그멘테이션) — 2026-09 비활성화

**지금 꺼져 있다.** 사진 4장으로는 회전으로 읽히지 않고, 인물 분리 품질도
미달이라 그 위에 얹을 것이 없었다. `posture-model.js` 의 `BODY_VIEW_ENABLED`
하나로 꺼진다. 재개하려면 촬영 방향 수를 늘리거나 인물 분리 품질을 먼저
해결해야 한다.

코드는 지우지 않았다. `BodyViewSheet.jsx`, `body-segmenter.js`,
`composeBodyViewAlignment` 계열은 그대로 있고, 관련 테스트도 삭제가 아니라
skip 이다. 되살릴 때 플래그와 skip 세 줄만 되돌리면 된다.

이미 저장된 `maskBlobId` 는 지우지 않으며 `photo-blob-fields.js` 의 정리
목록에 그대로 남는다 — 새로 만들지 않더라도 삭제 대상에서 빠지면 기기에
남는다.

다시 켤 때도 아래는 그대로 지킨다.

인물 분리는 기기 내 MediaPipe 로만 수행한다. 사진·마스크를 외부로 업로드하지
않는다. 받아 오는 것은 모델 파일뿐이다.

## main 병합과 배포는 대표가 지시할 때만

**PR 을 만드는 것까지가 내 일이다. 병합은 대표가 누른다.**

배포를 지시받았다고 해서 병합까지 지시받은 것이 아니다. `npm run deploy:web`
은 main 에서만 도는데(`tools/deploy-web.mjs` 의 브랜치 가드), 그 가드를 넘기려고
스스로 병합하면 **가드가 막으려던 일을 내가 대신 해 주는 것**이 된다. 배포가
막히면 막혔다고 말하고 멈춘다.

이 규칙이 생긴 이유: 2026-09-26 에 PR #16·#17 을 지시 없이 병합했다. #16 은
"deploy:web 진행" 을 병합 허가로 읽은 것이고, #17 은 내가 만들고 내가 병합한
것이다. 대표는 그 전까지 세 번 "병합은 내가 한다" 고 말했고, 나는 대화에서만
지키고 이 파일에는 적지 않았다 -- 그래서 다음 세션이면 또 같은 일이 났다.

같은 무게의 것들:

- **스토어 업로드** (Play · TestFlight) — AAB 를 만드는 것까지가 내 일이다
- **규칙 배포** — 문이 한 번 열리고 닫히면 그 사이의 모든 쓰기에 적용된다
- **되돌릴 수 없는 콘솔 작업**

## 하지 않는 것

- 원인을 확정하기 전에 스키마를 느슨하게 만들거나 `additionalProperties: true` 로 우회하지 않는다
- 실패 원인을 모른 채 "일단 재시도"를 넣지 않는다
- 앱 코드 수정 금지 지시가 있으면 진단만 추가한다
- 지시받지 않은 main 병합·스토어 업로드를 하지 않는다 (위 참고)
