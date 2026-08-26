# 파일럿 일일 지표 실행

파일럿 지표는 `pilotMetrics/{uid}/attempts/{requestId}`의 개인정보 없는 집계 필드만 읽습니다. 오디오·전사 원문·회원 이름·전화번호는 저장하거나 출력하지 않습니다.

## 매일 아침 실행

Google Application Default Credentials가 `pilateacher` 프로젝트 읽기 권한으로 설정된 환경에서 프로젝트 루트 기준으로 실행합니다.

```powershell
npm.cmd --prefix functions run pilot:metrics -- --project pilateacher --date 2026-08-26
```

`--date`를 생략하면 서울 시간 기준 전날 표를 출력합니다. 로컬 fixture 검증은 `--fixture 경로.json`을 추가합니다.

## 지표 정의

- 기록 수: AI 정리가 정상 완료된 `result=ok` 시도 수
- flags 비율: 전체 시도 중 `no_speech`, `low_confidence`, `tail_dropped`가 붙은 비율
- AI 확인율: 정상 정리 기록 중 강사가 `[확인]`한 비율
- 완료→결과 latency 중앙값: 녹음 완료부터 정리 결과 수신까지 걸린 밀리초의 중앙값

출력은 강사 UID별 Markdown 표입니다. UID를 이메일이나 강사 이름으로 자동 치환하지 않아 개인정보 노출을 줄입니다.
