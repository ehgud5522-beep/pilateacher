# Google 로그인 인증서 점검

패키지: `com.pilateacher.app`

현재 `android/app/google-services.json`에 등록된 Android OAuth `certificate_hash`:

- `70da6a0c279280ad16f28e689fca36d659a29a5c`
- `170722e5f1fdf087cbd933268b6dff4b79817a09`
- `8ce38225abd73df6493784ae1c09d421c5bff93e`
- `e12c77bbdfa5b4aeed6fd66cab2b2498bfd15772`
- `d87ed2dc8f504ca591f443c1e88230e2fb8e1c2f`
- `117f317237df69c445d6b42ed73fa6470ec23ed4`

## 제출 전 필수 확인

Play Console `설정 → 앱 무결성 → 앱 서명 키 인증서`의 SHA-1을 위 목록과 대조해야 합니다. 대표가 Play 앱 서명 SHA-1을 아직 제공하지 않았으므로 현재는 일치 여부를 판정할 수 없습니다.

목록에 없다면 **Firebase Console에 Play 앱 서명 SHA-1 지문 추가 후 `google-services.json` 재다운로드 필요**입니다.
