"""회원 앱 빌드에 붙은 서명이 회원 앱의 것인지 본다.

한 저장소에 앱이 둘이고 Codemagic 워크플로도 둘이다. 설정이 한 번 섞이면
나오는 것은 잘못된 빌드가 아니라 **맞는 것처럼 보이는** 빌드다 -- 강사 앱
프로필로 서명된 회원 앱은 빌드가 통과하고 업로드에서 거절당하며, 그때 나오는
문구는 왜 그런지 말해 주지 않는다.

강사 앱 쪽 검사(codemagic.yaml 안에 인라인으로 있다)를 그대로 옮기지 않았다.
여기서 봐야 하는 것은 셋뿐이다: 회원 앱 프로필이 잡혔는가, 강사 앱 프로필이
섞이지 않았는가, 배포용 인증서인가.
"""

import os
import plistlib
import sys

EXPECTED_BUNDLE_ID = "com.bonitapilates.member"
INSTRUCTOR_BUNDLE_ID = "com.pilateacher.app"
EXPECTED_TEAM_ID = "7ADRYNV3B4"


def fail(message):
    print(f"Code signing validation failed: {message}", file=sys.stderr)
    raise SystemExit(1)


def main():
    path = os.path.expanduser("~/export_options.plist")
    if not os.path.isfile(path):
        fail(f"{path} was not created by `xcode-project use-profiles`")

    with open(path, "rb") as handle:
        options = plistlib.load(handle)

    profiles = options.get("provisioningProfiles") or {}
    if EXPECTED_BUNDLE_ID not in profiles:
        fail(f"no provisioning profile for {EXPECTED_BUNDLE_ID}: {sorted(profiles)}")
    # 강사 앱 프로필이 함께 잡혔다면 이 워크플로가 루트의 ios/ 를 열었다는
    # 뜻이다. 그대로 나가면 두 앱이 서로의 서명으로 나간다.
    if INSTRUCTOR_BUNDLE_ID in profiles:
        fail(f"the instructor app profile leaked into this build: {sorted(profiles)}")

    method = options.get("method")
    if method not in {"app-store", "app-store-connect"}:
        fail(f"unexpected export method: {method!r}")

    team_id = options.get("teamID")
    if team_id is not None and team_id != EXPECTED_TEAM_ID:
        fail(f"unexpected Team ID: {team_id!r}")

    certificate = str(options.get("signingCertificate") or "")
    if certificate and "Apple Distribution" not in certificate:
        fail(f"unexpected signing certificate: {certificate!r}")

    print(f"Bundle ID: {EXPECTED_BUNDLE_ID}")
    print(f"Provisioning profile: {profiles[EXPECTED_BUNDLE_ID]}")
    print(f"Team ID: {team_id}")
    print(f"Export method: {method}")


if __name__ == "__main__":
    main()
