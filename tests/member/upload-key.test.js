import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { MEMBER_UPLOAD_KEY, checkUploadSignature } from "../../tools/member/upload-key.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** 강사 앱 업로드 키 SHA-1 의 앞뒤 (member-app/README.md 에 적힌 그대로). */
const INSTRUCTOR_SHA1_PREFIX = "17:07:22";

const printcert = (sha1) => [
  "Signer #1:", "", "Certificate #1:", "Owner: CN=x", `\t SHA1: ${sha1}`, "\t SHA256: AA:BB",
].join("\n");

test("회원 앱 업로드 키는 강사 앱 키가 아니다", () => {
  assert.ok(!MEMBER_UPLOAD_KEY.sha1.startsWith(INSTRUCTOR_SHA1_PREFIX));
  assert.equal(MEMBER_UPLOAD_KEY.alias, "bonita-member-upload");
  assert.match(MEMBER_UPLOAD_KEY.sha1, /^([0-9A-F]{2}:){19}[0-9A-F]{2}$/);
  assert.match(MEMBER_UPLOAD_KEY.sha256, /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
});

test("회원 앱 키로 서명된 번들은 통과한다", () => {
  assert.deepEqual(checkUploadSignature(printcert(MEMBER_UPLOAD_KEY.sha1)),
    { ok: true, code: "OK", found: MEMBER_UPLOAD_KEY.sha1 });
  // 소문자 · 다른 로캘 표기 (SHA-1) 도 같은 지문이다.
  assert.equal(checkUploadSignature(`SHA-1: ${MEMBER_UPLOAD_KEY.sha1.toLowerCase()}`).ok, true);
});

test("다른 키로 서명된 번들은 막는다 — 강사 앱 키가 섞인 경우", () => {
  const result = checkUploadSignature(printcert(`${INSTRUCTOR_SHA1_PREFIX}:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:7A:09`));
  assert.equal(result.ok, false);
  assert.equal(result.code, "WRONG_UPLOAD_KEY");
});

test("서명이 없으면 막는다", () => {
  for (const output of ["", "jar is unsigned.", null]) {
    assert.equal(checkUploadSignature(output).code, "SIGNATURE_UNREADABLE", String(output));
  }
});

test("키와 비밀번호는 저장소에 없다", () => {
  /* 키스토어는 대표 PC 의 ~/bonita-member-key/ 와 Codemagic 에만 있다. */
  const ignore = readFileSync(path.join(root, ".gitignore"), "utf8");
  assert.match(ignore, /^member-app\/android\/keystore\.properties$/m);
});

test("로컬 키 설정이 있으면 강사 앱 키 파일을 가리키지 않는다", {
  skip: !existsSync(path.join(root, "member-app/android/keystore.properties"))
    && "로컬 키 설정이 없다 (CI 에서는 정상)",
}, () => {
  const props = readFileSync(path.join(root, "member-app/android/keystore.properties"), "utf8");
  const storeFile = props.match(/^storeFile=(.*)$/m)?.[1]?.trim() || "";
  const alias = props.match(/^keyAlias=(.*)$/m)?.[1]?.trim() || "";
  assert.doesNotMatch(storeFile, /pilateacher-key|pilateacher-upload/i);
  assert.equal(alias, MEMBER_UPLOAD_KEY.alias);
});
