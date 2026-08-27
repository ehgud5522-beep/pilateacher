# PilaTeacher — 작업 규칙

필라테스 강사용 앱. React + Vite 웹 앱을 Capacitor로 iOS·Android에 담고, AI 수업기록은
Firebase Functions(`aiGateway`)를 거쳐 OpenAI로 간다. 상세 릴리스 절차는
[docs/android-release-safety.md](docs/android-release-safety.md), 게이트웨이 배포 이력은
[docs/ai-gateway-deploy-log.md](docs/ai-gateway-deploy-log.md)에 있다.

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

## 진단 로그가 남는 곳

- `deviceLog(...)` — 기기 진단 (`더보기 → 진단`)
- `appendVoiceSessionDiagnostic(...)` — 음성 세션 30건
- `appendLessonRecordDiagnostic(...)` — 수업기록 파이프라인 20건
- Functions: `firebase functions:log --only aiGateway --project pilateacher`

## 하지 않는 것

- 원인을 확정하기 전에 스키마를 느슨하게 만들거나 `additionalProperties: true` 로 우회하지 않는다
- 실패 원인을 모른 채 "일단 재시도"를 넣지 않는다
- 앱 코드 수정 금지 지시가 있으면 진단만 추가한다
