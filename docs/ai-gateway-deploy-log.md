# aiGateway 배포 기록

`aiGateway`(Cloud Functions gen2, `asia-northeast3`, 프로젝트 `pilateacher`)의 배포 이력과 롤백 지점을 남긴다.
배포는 저장소 루트에서 다음 명령으로 한다.

```bash
npx firebase deploy --only functions:aiGateway --project pilateacher --config firebase.ai-gateway.json
```

배포 직후 활성 revision 은 `npx firebase functions:log --only aiGateway --project pilateacher -n 6` 의 감사 로그에서 확인한다.

## 이력

| revision | updateTime (KST) | 소스 커밋 | functions-hash | 내용 |
| --- | --- | --- | --- | --- |
| `aigateway-00013-nal` | 2026-08-26 10:27:55 | `11b9afa` | `2490ec03…` | 전사 경계 보강 D5 |
| `aigateway-00014-noz` | 2026-08-27 19:04:24 | `403862a` | `0a52337a…` | 인가 거부 사유 분리 + `authorization_denied` 상시 로깅 (H-13) |

Cloud Run 서비스 URL 은 두 revision 모두 `https://aigateway-exny2pgf7a-du.a.run.app`,
공개 엔드포인트는 `https://asia-northeast3-pilateacher.cloudfunctions.net/aiGateway/v1/ai/execute` 이다.
Secret 은 `OPENAI_API_KEY` version 3 을 계속 사용한다.

## 롤백

트래픽만 이전 revision 으로 되돌린다.

```bash
gcloud run services update-traffic aigateway --region asia-northeast3 --project pilateacher --to-revisions aigateway-00013-nal=100
```

소스까지 되돌려야 하면 해당 커밋의 `functions/` 를 꺼내 다시 배포한다.

```bash
git checkout 11b9afa -- functions/ && npx firebase deploy --only functions:aiGateway --project pilateacher --config firebase.ai-gateway.json
```

## 배포 확인

인증 없이 라우팅만 확인한다. 실제 요청은 만들지 않는다.

```bash
curl -s -w "\nHTTP %{http_code}\n" -X POST "https://asia-northeast3-pilateacher.cloudfunctions.net/aiGateway/v1/ai/execute" -H "Content-Type: application/json" -d '{}'
```

`{"error":{"code":"unauthenticated",…}}` 와 `HTTP 401` 이면 새 revision 이 라우팅까지 정상이다.
`lesson_record_from_audio` 200 은 로그인된 기기에서만 만들 수 있으므로, 기기에서 1회 녹음한 뒤
`functions:log` 의 `gateway_completed … httpStatus: 200` 으로 확인한다.

## H-13 이후 로그에서 볼 것

`aigateway-00014-noz` 부터 인가 거부는 사유별로 갈라진다. 이전 revision 은 모든 사유를
`consent_required` 하나로 내보내서, 앱이 회원·수업 연결 문제를 "동의 필요"로 표시했다.

- `authorization_denied … reason: member_not_owned | lesson_not_owned | backup_missing` — 서버 백업이 낡았다는 뜻이다. HTTP 403 `invalid_request` 로 나가고 앱은 회원·수업 연결 화면을 띄운다.
- `authorization_denied … reason: consent_missing | consent_not_granted` — 실제 동의 문제. HTTP 403 `consent_required`.
- `gateway_failed … code: invalid_request` + HTTP 400 — 요청 스키마 거부. 필드명은 `internalMessage` 에만 있고 응답에는 실리지 않으므로, 필요하면 `AI_GATEWAY_DIAGNOSTICS=1` 로 서버 로그를 켠다.
