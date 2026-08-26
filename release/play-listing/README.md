# Play 스토어 등록정보 산출물

- `screenshots-play/`: Play Console 업로드용 캡션 포함 6장, 각 1080×2340 PNG
- `screenshots-clean/`: iOS E-2와 공용으로 사용할 캡션 없는 6장, 각 1080×2340 PNG
- `feature-graphic-1024x500.png`: Play 그래픽 이미지
- `app-name.txt`, `short-description.txt`, `full-description.txt`, `tags.txt`: 등록 문구
- `references.md`: G-1 데이터 안전·콘텐츠 등급 자료 참조
- `qa-report.json`: 규격·샘플 데이터·문자 수 검사 결과

이미지는 Playwright의 고정 데모 UI로 렌더합니다. Firebase, 네트워크, 실제 회원 데이터에 접근하지 않습니다.

실행:

```powershell
$env:NODE_PATH='C:\Users\ehgud\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules'
& 'C:\Users\ehgud\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' release\play-listing\scripts\capture.mjs
```
