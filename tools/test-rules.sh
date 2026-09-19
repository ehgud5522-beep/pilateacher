#!/usr/bin/env bash
# Firestore 규칙 테스트. 에뮬레이터가 Java 를 쓰는데 이 기기의 Java 는 PATH 에
# 없고 Android Studio 안에 있다 -- 프로세스 한정으로 얹고 돌린다.
#
# 환경이 다르면 JAVA_HOME 을 먼저 정해 두고 부르면 된다:
#   JAVA_HOME=/path/to/jdk tools/test-rules.sh
set -euo pipefail

: "${JAVA_HOME:=C:\\Program Files\\Android\\Android Studio\\jbr}"
: "${JAVA_BIN_DIR:=/c/Program Files/Android/Android Studio/jbr/bin}"
export JAVA_HOME
export PATH="${JAVA_BIN_DIR}:${PATH}"

if ! command -v java >/dev/null 2>&1; then
  # 코드 없는 "실패했습니다"를 남기지 않는다 -- 어디를 봐야 하는지 말한다.
  echo "java 를 찾지 못했습니다. JAVA_HOME 과 JAVA_BIN_DIR 을 확인해 주세요." >&2
  echo "  JAVA_HOME=${JAVA_HOME}" >&2
  echo "  JAVA_BIN_DIR=${JAVA_BIN_DIR}" >&2
  exit 1
fi

exec npm run test:rules
