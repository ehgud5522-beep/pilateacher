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
| (확인 필요) | 2026-09-20 13:0x | `9f8677f` | — | 소유권 판정에 조직 회원 추가 — memberships + organizations/{org}/clients |

Cloud Run 서비스 URL 은 두 revision 모두 `https://aigateway-exny2pgf7a-du.a.run.app`,
공개 엔드포인트는 `https://asia-northeast3-pilateacher.cloudfunctions.net/aiGateway/v1/ai/execute` 이다.
Secret 은 `OPENAI_API_KEY` version 3 을 계속 사용한다.

## 회원 앱 함수 — 2026-09-24 배포

`aiGateway` 와 같은 프로젝트·리전이지만 배포는 **이름으로 지정**한다. 함께
올리면 게이트웨이까지 새 revision 이 되고, 그 변경은 이 문서 위쪽 표에 없다.

```bash
npx firebase deploy --project pilateacher --config firebase.ai-gateway.json   --only "functions:linkMemberAccount,functions:linkMemberAccountByOwner,functions:unlinkMemberAccount,functions:listPendingMemberLinks,functions:verifyMemberViews,functions:rebuildMemberViews,functions:rebuildMemberViewOnPassWrite,functions:rebuildMemberViewOnClientWrite"
```

| 함수 | 종류 | 소스 커밋 |
| --- | --- | --- |
| `linkMemberAccount` | callable · 회원 본인 | `1d44d78` |
| `linkMemberAccountByOwner` · `unlinkMemberAccount` · `listPendingMemberLinks` | callable · 대표 | `1d44d78` |
| `verifyMemberViews` · `rebuildMemberViews` | callable · 대표 | `bbb0311` |
| `rebuildMemberViewOnPassWrite` · `rebuildMemberViewOnClientWrite` | Firestore 트리거 | `bbb0311` |

### 첫 2세대 트리거는 한 번에 안 된다

트리거 둘이 세 번 실패했다. 업로드·빌드는 끝나고 트리거 생성에서만 막힌다.

```
Validation failed for trigger …: Invalid resource state for "":
Permission denied while using the Eventarc Service Agent.
Since this is your first time using 2nd gen functions, we need a little bit
longer to finish setting everything up. Retry the deployment in a few minutes.
```

Eventarc 서비스 에이전트가 그 배포 중에 **방금 만들어졌고** 권한 전파에 시간이
걸린다. 6분 안에 세 번 시도해 전부 실패했고, **20분 뒤 한 번에 성공**했다.
리전은 문제가 아니었다 — Firestore `(default)` 와 트리거가 둘 다
`asia-northeast3` 다.

그래도 안 되면 권한을 본다 (프로젝트 번호 `452402660812`, 콘솔 → IAM 에서
**"Google 제공 역할 부여 포함"** 을 켜야 보인다).

| 주체 | 역할 |
| --- | --- |
| `service-452402660812@gcp-sa-eventarc.iam.gserviceaccount.com` | Eventarc 서비스 에이전트 |
| `service-452402660812@gcp-sa-pubsub.iam.gserviceaccount.com` | 서비스 계정 토큰 생성자 |
| `452402660812-compute@developer.gserviceaccount.com` | Eventarc 이벤트 수신자 · Cloud Run 호출자 |

### 배포 확인

인증 없이 라우팅만 본다. 실제 연결은 만들지 않는다.

```bash
curl -s -X POST "https://asia-northeast3-pilateacher.cloudfunctions.net/linkMemberAccount"   -H "Content-Type: application/json" -d '{"data":{}}'
```

`{"error":{"details":{"code":"unauthenticated","stage":"authorize"},…}}` 이면
살아 있는 것이다. 코드와 단계가 함께 오는지까지 본다 — 그 둘이 진단의 값어치다.

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

### 2026-09-20 배포 메모

`firebase deploy` 는 `Successful update operation` 으로 끝났고 Function URL 은
그대로 `https://aigateway-exny2pgf7a-du.a.run.app` 이다. **revision 이름은 아직
적지 못했다** -- 이 기기에 `gcloud` 가 없고 `functions:log` 가 로그를 가져오지
못했다. 다음에 접근 가능한 곳에서 아래로 확인해 위 표의 "(확인 필요)" 를 채운다.

```bash
npx firebase functions:log --only aiGateway --project pilateacher -n 6
```

롤백 지점은 `aigateway-00014-noz` (소스 `403862a`) 다. 이번 배포가 문제가 되면
그쪽으로 트래픽을 되돌린다 -- 다만 되돌리는 순간 센터가 등록한 회원의 음성
수업기록은 다시 막힌다.
