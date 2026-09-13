# 콘솔 배포 기록

센터 운영 콘솔(`/console`)의 배포 절차와 이력을 남긴다. 앱과 같은 빌드 산출물
(`dist/`)을 Firebase Hosting(프로젝트 `pilateacher`)에 올리고, SPA fallback 으로
`/console` 을 `index.html` 로 보낸다. 라우터는 없고 `src/main.jsx` 가 pathname 을
보고 콘솔 번들을 동적으로 불러온다.

배포는 저장소 루트에서 다음 명령으로 한다.

```bash
npm run build && npx firebase deploy --only hosting --project pilateacher --config firebase.foundation.json
```

`--config` 를 빼면 안 된다. 이 저장소에는 `firebase.json` 도 `.firebaserc` 도 없어
설정 파일을 찾지 못한다. `--project` 도 같은 이유로 생략할 수 없다.

배포 전에 무엇이 올라가는지 먼저 확인한다.

```bash
npx firebase deploy --only hosting --project pilateacher --config firebase.foundation.json --dry-run
```

## 앱 바이너리와의 관계

`capacitor.config.json` 의 `webDir` 이 `dist` 이므로, 콘솔 청크도 iOS·Android
바이너리에 함께 실린다. 네이티브에서는 pathname 이 항상 `/` 이고 앱 화면 어디에도
진입점이 없어 실행되지 않는다. 실행되지 않는 파일 하나를 감수하는 대신 릴리스
절차를 건드리지 않기로 한 결정이다. 자세한 배경은
[android-release-safety.md](android-release-safety.md) 를 함께 본다.

## 접근 통제

콘솔 화면은 `role === "owner"` 가 아니면 열리지 않는다. 다만 이것은 화면 수준의
차단이고, 실제 데이터 경계는 `firestore.foundation.rules` 의
`organizations/{organizationId}/products` 블록이 정한다 — 상품 생성과 상태 변경은
규칙에서도 owner 로 제한된다. Hosting 에는 접근 제한이 없으므로 URL 자체는 누구나
열 수 있고, 로그인하지 못하면 아무 데이터도 보이지 않는다.

## 이력

| 배포일 (KST) | 소스 커밋 | 내용 |
| --- | --- | --- |
| — | — | 아직 배포하지 않았다. 설정만 준비한 상태다. |
