#!/usr/bin/env python3
import os
import pathlib
import re
import subprocess
import sys


def fail(message):
    print(f"Build metadata validation failed: {message}", file=sys.stderr)
    raise SystemExit(1)


root = pathlib.Path(os.environ.get("CM_BUILD_DIR", ".")).resolve()
project = root / "ios/App/App.xcodeproj/project.pbxproj"
project_text = project.read_text(encoding="utf-8")


def unique_build_setting(name):
    values = {
        value.strip().strip('"')
        for value in re.findall(rf"\b{name}\s*=\s*([^;]+);", project_text)
    }
    if len(values) != 1:
        fail(f"expected one {name} value, found {sorted(values)!r}")
    return values.pop()


commit_sha = subprocess.check_output(
    ["git", "rev-parse", "HEAD"], cwd=root, text=True
).strip()
branch = os.environ.get("CM_BRANCH", "").strip()
if not branch:
    branch = subprocess.check_output(
        ["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=root, text=True
    ).strip()
build_number = os.environ.get("BUILD_NUMBER", "").strip()
version = unique_build_setting("MARKETING_VERSION")
bundle_id = unique_build_setting("PRODUCT_BUNDLE_IDENTIFIER")
expected_bundle_id = os.environ.get("BUNDLE_ID", "com.pilateacher.app")

if not build_number:
    fail("BUILD_NUMBER is empty")
if bundle_id != expected_bundle_id:
    fail(f"unexpected bundle identifier: {bundle_id!r}")
if any("\n" in value or "\r" in value for value in (
    commit_sha, branch, build_number, version, bundle_id
)):
    fail("build metadata contains a newline")

cm_env = os.environ.get("CM_ENV", "")
if not cm_env:
    fail("CM_ENV is unavailable")
with open(cm_env, "a", encoding="utf-8") as environment_file:
    for key, value in {
        "VITE_BUILD_COMMIT": commit_sha,
        "VITE_BUILD_BRANCH": branch,
        "VITE_BUILD_NUMBER": build_number,
        "VITE_APP_VERSION": version,
        "VITE_APP_BUNDLE_ID": bundle_id,
    }.items():
        environment_file.write(f"{key}={value}\n")

(root / "build/ios/metadata").mkdir(parents=True, exist_ok=True)
print(f"Git commit SHA: {commit_sha}")
print(f"Git branch: {branch}")
print(f"Codemagic build number: {build_number}")
print(f"CFBundleShortVersionString: {version}")
print(f"CFBundleVersion: {build_number}")
print(f"Bundle ID: {bundle_id}")
