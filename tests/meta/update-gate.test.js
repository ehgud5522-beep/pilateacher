import assert from "node:assert/strict";
import test from "node:test";

import {
  APP_STORE_ID, UPDATE_PROMPT, buildNumberOf, readAppUpdateConfig, snoozedToday,
  storeLinks, updatePrompt,
} from "../../src/features/app-update/update-gate.js";

/**
 * 앱 업데이트 안내.
 *
 * 이 파일이 지키는 것은 둘이다.
 *
 * 하나. **모르면 띄우지 않는다.** 설정을 못 읽거나 빌드 번호를 못 읽으면
 * 아무것도 하지 않는다 -- 네트워크가 흔들렸다고 앱이 팝업에 막히면 그것은
 * 업데이트를 돕는 것이 아니라 일을 막는 것이다.
 *
 * 둘. **필수는 미룰 수 없다.** 최소 빌드보다 낮으면 "나중에" 를 눌러 둔
 * 기억이 있어도 다시 묻는다.
 */

const NOW = new Date(2026, 9, 5, 9, 0);
const config = (overrides = {}) => ({
  android: { latestBuild: "65", minimumBuild: "", message: "", ...(overrides.android || {}) },
  ios: { latestBuild: "65", minimumBuild: "", message: "", ...(overrides.ios || {}) },
});

/* ── 모르면 띄우지 않는다 ────────────────────────────────────────────────── */

test("an unreadable build number shows nothing, and never becomes zero", () => {
  /* 0 으로 바꾸면 "읽지 못했다" 가 "아주 낮은 빌드" 가 되어, 번호를 못 읽는
     기기가 전부 필수 팝업에 갇힌다. */
  assert.equal(buildNumberOf(""), null);
  assert.equal(buildNumberOf("1.1.33"), null, "라벨은 번호가 아니다");
  assert.equal(buildNumberOf(null), null);
  assert.equal(buildNumberOf("64"), 64);

  for (const installed of ["", null, "1.1.33 (64)"]) {
    const result = updatePrompt({
      config: config({ android: { minimumBuild: "99" } }), platform: "android", installedBuild: installed, now: NOW,
    });
    assert.equal(result.prompt, UPDATE_PROMPT.NONE, String(installed));
  }
});

test("an empty or missing config shows nothing", () => {
  /* 대표가 아직 켜지 않은 상태다 (1.1.33 이 스토어에 올라간 뒤 켠다).
     빈 문서가 곧 "안내 없음" 이어야 한다. */
  for (const document of [null, undefined, {}, { android: {} }, { android: { latestBuild: "" } }]) {
    const result = updatePrompt({ config: document, platform: "android", installedBuild: "64", now: NOW });
    assert.equal(result.prompt, UPDATE_PROMPT.NONE, JSON.stringify(document));
  }
});

test("the web is never nagged", () => {
  /* 웹은 배포한 순간이 최신이다. 새로고침이 곧 업데이트이고, 보낼 스토어도 없다. */
  for (const platform of ["web", "", undefined, "windows"]) {
    const result = updatePrompt({
      config: config({ android: { minimumBuild: "99", latestBuild: "99" } }),
      platform, installedBuild: "64", now: NOW,
    });
    assert.equal(result.prompt, UPDATE_PROMPT.NONE, String(platform));
  }
});

/* ── 권유와 필수 ─────────────────────────────────────────────────────────── */

test("an older build is asked once, and the same build is not asked at all", () => {
  const older = updatePrompt({ config: config(), platform: "android", installedBuild: "64", now: NOW });
  assert.equal(older.prompt, UPDATE_PROMPT.OPTIONAL);
  assert.equal(older.latestBuild, 65);

  for (const installed of ["65", "66"]) {
    const current = updatePrompt({ config: config(), platform: "android", installedBuild: installed, now: NOW });
    assert.equal(current.prompt, UPDATE_PROMPT.NONE, installed);
  }
});

test("below the minimum build the prompt cannot be dismissed", () => {
  const result = updatePrompt({
    config: config({ android: { latestBuild: "65", minimumBuild: "65" } }),
    platform: "android", installedBuild: "64", now: NOW,
  });
  assert.equal(result.prompt, UPDATE_PROMPT.REQUIRED);
});

test("a required update ignores yesterday's and today's snooze", () => {
  /* 최소 빌드는 "이 빌드로는 더 이상 쓰면 안 된다" 는 뜻이다. 미뤄 둔 기억이
     그 선을 넘기면 안 된다. */
  const result = updatePrompt({
    config: config({ android: { latestBuild: "65", minimumBuild: "65" } }),
    platform: "android", installedBuild: "64", snoozedAt: NOW.toISOString(), now: NOW,
  });
  assert.equal(result.prompt, UPDATE_PROMPT.REQUIRED);
});

test("a minimum build with no latest build still blocks", () => {
  /* 대표가 최소만 올리고 최신을 안 적는 경우가 있다. 그때 안내할 번호는
     최소 빌드다 -- 없는 번호를 보여주느니 아는 것을 말한다. */
  const result = updatePrompt({
    config: config({ ios: { latestBuild: "", minimumBuild: "70" } }),
    platform: "ios", installedBuild: "64", now: NOW,
  });
  assert.equal(result.prompt, UPDATE_PROMPT.REQUIRED);
  assert.equal(result.latestBuild, 70);
});

/* ── 나중에 ──────────────────────────────────────────────────────────────── */

test("later means not again today, but again tomorrow", () => {
  /* 열 때마다 뜨면 그 팝업은 곧 반사적으로 닫힌다. 24시간이 아니라 날짜로
     세는 이유: 아침에 누른 사람이 다음 날 아침에 다시 보는 쪽이 예측된다. */
  const asked = { config: config(), platform: "android", installedBuild: "64" };

  assert.equal(updatePrompt({ ...asked, snoozedAt: new Date(2026, 9, 5, 8, 0), now: NOW }).prompt, UPDATE_PROMPT.NONE);
  assert.equal(updatePrompt({ ...asked, snoozedAt: new Date(2026, 9, 4, 23, 59), now: NOW }).prompt, UPDATE_PROMPT.OPTIONAL);
  // 23시에 누르고 한 시간 뒤에 열면 날짜가 바뀌어 다시 묻는다.
  assert.equal(
    updatePrompt({ ...asked, snoozedAt: new Date(2026, 9, 5, 23, 0), now: new Date(2026, 9, 6, 0, 10) }).prompt,
    UPDATE_PROMPT.OPTIONAL,
  );
});

test("a broken snooze value is treated as never snoozed", () => {
  /* localStorage 는 아무 글자나 들고 있을 수 있다. 읽지 못하면 안 누른 것으로
     본다 -- 묻지 않는 쪽으로 기울면 안내가 영영 안 뜬다. */
  for (const value of ["", "어제", null, "NaN"]) {
    assert.equal(snoozedToday(value, NOW), false, String(value));
  }
  assert.equal(snoozedToday(NOW.toISOString(), NOW), true);
  assert.equal(snoozedToday(NOW.getTime(), NOW), true);
});

/* ── 설정 읽기 ───────────────────────────────────────────────────────────── */

test("the config is read defensively — it is typed by hand in the console", () => {
  const read = readAppUpdateConfig({
    android: { latestBuild: 65, minimumBuild: null, message: "x".repeat(500) },
    ios: "엉뚱한 값",
  });
  assert.equal(read.android.latestBuild, "65", "숫자로 적어도 읽는다");
  assert.equal(read.android.minimumBuild, "");
  assert.equal(read.android.message.length, 200, "긴 문구는 자른다");
  assert.deepEqual(read.ios, { latestBuild: "", minimumBuild: "", message: "" });
});

test("a centre message replaces the default copy", () => {
  const result = updatePrompt({
    config: config({ android: { latestBuild: "65", message: "이번 업데이트에 급여 화면이 바뀌었어요" } }),
    platform: "android", installedBuild: "64", now: NOW,
  });
  assert.equal(result.message, "이번 업데이트에 급여 화면이 바뀌었어요");
});

/* ── 스토어 주소 ─────────────────────────────────────────────────────────── */

test("each platform has an app link and a web fallback", () => {
  /* 스토어 앱이 없는 기기에서 앞엣것만 쓰면 버튼이 아무 일도 하지 않는다. */
  const android = storeLinks("android");
  assert.match(android.app, /^market:\/\/details\?id=com\.pilateacher\.app$/);
  assert.match(android.web, /^https:\/\/play\.google\.com\/store\/apps\/details\?id=com\.pilateacher\.app$/);

  const ios = storeLinks("ios");
  /* 번들 ID 로 조회해 확인한 번호다 (2026-10-05). 계정 헤더의 팀 ID 를 적으면
     빈 페이지로 간다 -- 실제로 한 번 그럴 뻔했다. */
  assert.equal(APP_STORE_ID, "6795406545");
  assert.match(ios.app, /^itms-apps:\/\/apps\.apple\.com\/app\/id6795406545$/);
  assert.match(ios.web, /^https:\/\/apps\.apple\.com\/kr\/app\/id6795406545$/);
});
