#!/usr/bin/env bash
# 서명된 릴리스 AAB 를 한 줄로 만든다. Android Studio 를 열지 않는다.
#
# ── 왜 있는가 ──
# 워크트리가 스무 개가 넘고 Android Studio 창이 여러 개 열려 있으면, 어느 창에서
# 빌드했는지가 매번 헷갈린다. 빌드 변형(Build Variant)이 debug 로 남아 있으면
# "Generate Signed App Bundle" 도 debug 번들을 뱉는데, 알림 문구는 성공이라 그
# 사실이 드러나지 않는다 -- release 폴더의 옛 파일을 보고 새 빌드로 착각하게 된다.
#
# 이 스크립트는 지금 폴더가 어디든 이 저장소 루트를 기준으로 돌고, 끝나면 만든
# 파일의 절대 경로와 버전과 서명 지문을 찍는다.
#
# ── 이것이 대신하지 않는 것 ──
# Play 에 올릴 AAB 는 `npm run android:release:build` 로 만든다. 그쪽은 브랜치,
# 승인 UI 기준 커밋, 정책의 lastPublishedVersionCode 까지 본다
# (docs/android-release-safety.md). 이 스크립트는 그 셋을 보지 않는다.
#
# 대신 실질적인 것은 순서로 보장한다: npm run build 가 타입 검사와 테스트를
# 먼저 돌리고(prebuild), cap sync 가 dist 를 안드로이드 자산으로 복사하므로
# "옛 화면이 담긴 최신 버전 코드" 가 나올 수 없다.
set -euo pipefail

: "${JAVA_HOME:=C:\\Program Files\\Android\\Android Studio\\jbr}"
: "${JAVA_BIN_DIR:=/c/Program Files/Android/Android Studio/jbr/bin}"
export JAVA_HOME
export PATH="${JAVA_BIN_DIR}:${PATH}"

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"

if ! command -v java >/dev/null 2>&1; then
  echo "java 를 찾지 못했습니다. JAVA_HOME 과 JAVA_BIN_DIR 을 확인해 주세요." >&2
  echo "  JAVA_HOME=${JAVA_HOME}" >&2
  echo "  JAVA_BIN_DIR=${JAVA_BIN_DIR}" >&2
  exit 1
fi

# 서명 값이 없으면 gradle 이 빌드 도중에야 멈춘다. 여기서 먼저 말해 준다 --
# 몇 분 기다린 끝에 듣는 것과 시작하자마자 듣는 것은 다르다.
if [ ! -f android/keystore.properties ]; then
  echo "android/keystore.properties 가 없습니다. 이 파일은 저장소에 없고" >&2
  echo "릴리스를 만드는 PC 에만 둡니다 (docs/android-release-safety.md 2단계)." >&2
  exit 1
fi

echo "== 어디서 만드는지 먼저 밝힌다 =="
echo "  워크트리: $root"
echo "  브랜치  : $(git rev-parse --abbrev-ref HEAD) ($(git rev-parse --short HEAD))"
echo "  버전    : $(grep -oE 'versionCode +[0-9]+' android/app/build.gradle) / $(grep -oE 'versionName +"[^"]+"' android/app/build.gradle)"
echo

echo "== 1/3 웹 빌드 (타입 검사 · 린트 · 테스트 포함) =="
npm run build

echo "== 2/3 안드로이드로 복사 =="
npx cap sync android

echo "== 3/3 서명된 번들 =="
(cd android && ./gradlew bundleRelease --console=plain)

aab="$root/android/app/build/outputs/bundle/release/app-release.aab"
test -f "$aab" || { echo "번들이 나오지 않았습니다: $aab" >&2; exit 1; }

manifest="$(ls -t android/app/build/intermediates/bundle_manifest/release/*/AndroidManifest.xml 2>/dev/null | head -1)"

echo
echo "== 만들어진 파일 =="
echo "  $(cygpath -w "$aab" 2>/dev/null || echo "$aab")"
ls -la "$aab" | awk '{print "  " $5 " bytes  " $6 " " $7 " " $8}'
if [ -n "$manifest" ]; then
  # debuggable 이 붙어 있으면 debug 변형이다 -- Play 가 받지 않는다.
  echo "  $(grep -o 'versionCode="[0-9]*"' "$manifest" | head -1) $(grep -o 'versionName="[^"]*"' "$manifest" | head -1)"
  if grep -q 'android:debuggable="true"' "$manifest"; then
    echo "  경고: debuggable=true 입니다. release 변형이 아닙니다." >&2
    exit 1
  fi
fi
keytool -printcert -jarfile "$aab" 2>/dev/null | grep -i "SHA1:" | head -1 | sed 's/^/  서명 /'
echo
echo "Play 에 올릴 것이면 npm run android:release:build 로 다시 만드세요 --"
echo "이 스크립트는 브랜치와 정책(lastPublishedVersionCode)을 보지 않습니다."
