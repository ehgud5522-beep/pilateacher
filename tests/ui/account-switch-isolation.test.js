import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/* 센터 PC 한 대에서 강사 A 가 나가고 강사 B 가 같은 탭으로 들어온다 (2026-10-31).
   App 컴포넌트는 그대로라 ref 가 A 의 것을 들고 남는다. 나갈 때 A 의 것을 A 의
   이름으로 보내고 비우는지, 들어올 때 다른 계정이면 다시 비우는지 고정한다. */

const appSource = () => readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
const between = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

test("로그아웃: 로그인이 살아 있을 때 A 의 백업 · 일정을 먼저 보내고, 그다음 비운다", async () => {
  const source = await appSource();
  const logout = between(source, "const handleLogout = async () => {", "  };");
  const flush = logout.indexOf("await flushBeforeLogout()");
  const signOut = logout.indexOf("fbSignOut()");
  assert.ok(flush >= 0 && flush < signOut, "보내기가 로그아웃보다 먼저");
  for (const reset of [
    "unpublishedLessonsRef.current = new Map()",
    "initialSchedulePublishRef.current = false",
    "photosRef.current = {}",
    "lessonRecordDbRef.current = empty",
  ]) {
    assert.ok(logout.includes(reset), `비우지 않음: ${reset}`);
    assert.ok(logout.indexOf(reset) < logout.indexOf("setAccount(null)"), `${reset} 는 계정을 비우기 전에`);
  }
  const flushBody = between(source, "const flushBeforeLogout = async () => {", "  const handleLogout");
  assert.match(flushBody, /cloudPending\.current = null/, "3초 뒤 올라갈 A 의 백업 타이머를 남기지 않는다");
  assert.match(flushBody, /pushCloudBackup\(pending\.uid, pending\.data\)/, "A 의 백업은 A 의 uid 로");
});

test("계정을 불러올 때 다른 계정이면 앞 계정의 일정 대기열 · 맞추기 표시를 버린다", async () => {
  const source = await appSource();
  const load = between(source, "const loadAccount = async (acc) => {", "setRestoreOffer(null)");
  assert.match(load, /if \(loadedAccountIdRef\.current !== acc\?\.id\)/);
  assert.match(load, /unpublishedLessonsRef\.current = new Map\(\)/);
  assert.match(load, /initialSchedulePublishRef\.current = false/);
});

test("기기 데이터는 계정별 키에 있다 — B 는 A 의 db · 사진 메타를 읽지 않는다", async () => {
  const source = await appSource();
  assert.match(source, /const dbKey = \(id\) => `pilateacher_db_\$\{id\}`/);
  assert.match(source, /const phKey = \(id\) => `pilateacher_photos_\$\{id\}`/);
  const load = between(source, "const loadAccount = async (acc) => {", "const needsReviewBootstrap");
  assert.match(load, /window\.storage\.get\(dbKey\(acc\.id\)\)/);
  assert.match(load, /window\.storage\.get\(phKey\(acc\.id\)\)/);
});
