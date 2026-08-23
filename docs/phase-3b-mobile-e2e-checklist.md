# PilaTeacher 3B 실기기 E2E 체크리스트

테스트 빌드: `____________`  기기/OS: `____________`  실행일: `____________`

## A. AI Closed Loop

- [ ] 로그인
- [ ] 회원 생성 또는 선택
- [ ] 첫 일정 생성
- [ ] 출석 및 이용권 차감 확인
- [ ] 수업 후 10~20초 음성 기록
- [ ] STT 원문 확인
- [ ] 필라테스 용어 매핑 확인
- [ ] AI 구조화 결과 확인
- [ ] 강사가 항목을 수정하고 저장
- [ ] 같은 회원의 다음 일정 생성
- [ ] 일정 카드 briefing 확인
- [ ] Bottom Sheet briefing 확인
- [ ] 회원 상세 Memory 확인

PASS 기준: 첫 수업에서 확정한 내용이 같은 회원의 다음 수업에서 정확한 날짜와 출처를 포함해 나타난다.

## B. 회원 격리

- [ ] 회원 A와 회원 B에 서로 다른 확정 기록 저장
- [ ] A의 일정 카드, Bottom Sheet, 회원 상세에 B의 기록이 나타나지 않음
- [ ] B의 일정 카드, Bottom Sheet, 회원 상세에 A의 기록이 나타나지 않음

다른 회원의 기록이 하나라도 섞이면 FAIL.

## C. Memory 규칙

- [ ] Memory 숨기기 후 상태가 `rejected`로 유지됨
- [ ] 숨긴 동일 후보가 다시 나타나지 않음
- [ ] 반복 기록에서 pattern 후보가 생성됨
- [ ] 오래된 후보가 stale 처리됨
- [ ] 상반된 기록이 conflict로 표시되고 자동 확정되지 않음

## D. 2차 회귀

- [ ] 노코멘트
- [ ] 나중에
- [ ] 직접입력
- [ ] STT 실패 후 재녹음/직접입력 fallback
- [ ] LLM 실패 후 raw 저장/다시 정리/직접 수정
- [ ] 오프라인 queue와 출석·차감 독립 유지
- [ ] 출석 되돌리기 시 기존 기록 보존 및 차감/ledger 복원
- [ ] 중복 출석에서 중복 차감 없음

## E. 1B 회귀

- [ ] 손메모 single tap으로 즉시 활성화
- [ ] compact toolbar 가로 스크롤
- [ ] 단일 사진 앱 기록 저장
- [ ] 단일 사진 이미지 저장
- [ ] Android native 공유 sheet
- [ ] 기존 B/A 비교 및 timeline
- [ ] 기존 AI 체형분석 결과

## F. 공통

- [ ] 라이트/다크모드
- [ ] 기존 실데이터 로드
- [ ] Android back gesture
- [ ] Bottom Sheet 내부 스크롤
- [ ] handle drag dismiss
- [ ] scrollTop=0에서 아래 drag dismiss
- [ ] X 즉시 닫기

## 결과 기록

| 영역 | PASS/FAIL | 증거 또는 메모 |
| --- | --- | --- |
| AI Closed Loop |  |  |
| 회원 격리 |  |  |
| Memory |  |  |
| 2차 회귀 |  |  |
| 1B 회귀 |  |  |
| 공통 |  |  |
