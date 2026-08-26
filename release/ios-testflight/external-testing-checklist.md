# TestFlight 외부 테스트 준비 체크리스트

- [ ] `main`의 Codemagic `ios-testflight` 워크플로 성공
- [ ] 빌드 처리 완료 후 App Store Connect에서 수출 규정 확인
- [ ] Beta App Review Information에 연락처와 실제 테스트 계정 입력
- [ ] `what-to-test-ko.txt` 내용을 What to Test에 입력
- [ ] `beta-review-notes.md`의 심사용 메모 입력
- [ ] 개인정보처리방침 URL과 지원 URL 확인
- [ ] 외부 테스터 그룹 생성 또는 기존 그룹 선택
- [ ] 빌드를 외부 그룹에 추가하고 Beta App Review 제출
- [ ] 승인 후 초대 링크/이메일로 설치 검증

Codemagic 설정은 현재 TestFlight `Internal` 그룹에 자동 게시합니다. 외부 그룹 배포와 Beta App Review 제출은 App Store Connect에서 대표가 진행합니다.
