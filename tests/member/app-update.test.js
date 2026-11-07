import assert from "node:assert/strict";
import test from "node:test";
import {
  MEMBER_UPDATE_KEYS, UPDATE_PROMPT, UPDATE_START, compareVersionNames, decideMemberUpdate,
  readMemberUpdateConfig, storeStateFrom, updateStartPlan,
} from "../../member/src/app-update.js";

/* 보니따 VIP 앱 최신 버전 확인 · 강제 업데이트 (2026-11-07, 지시서 11번). */

const K = MEMBER_UPDATE_KEYS;
const config = (values = {}) => readMemberUpdateConfig({
  [K.androidLatest]: "120", [K.androidMinimum]: "110", [K.iosLatest]: "45", [K.iosMinimum]: "40",
  [K.force]: "true", ...values,
});
const decide = (input) => decideMemberUpdate({ config: config(), platform: "android", installedBuild: "100", store: { available: true, availableBuild: 120 }, now: new Date("2026-11-07T10:00:00"), ...input });

test("최소 지원 버전보다 낮으면 필수, 최신보다만 낮으면 권유, 같거나 높으면 없음 — 빌드 번호로", () => {
  assert.equal(decide({}).prompt, UPDATE_PROMPT.REQUIRED);
  assert.equal(decide({ installedBuild: "115" }).prompt, UPDATE_PROMPT.OPTIONAL);
  assert.equal(decide({ installedBuild: "120" }).prompt, UPDATE_PROMPT.NONE);
  assert.equal(decide({ platform: "ios", installedBuild: "39", store: { available: true } }).prompt, UPDATE_PROMPT.REQUIRED, "iOS 는 따로");
  assert.equal(decide({ platform: "ios", installedBuild: "42", store: { available: true } }).prompt, UPDATE_PROMPT.OPTIONAL);
});

test("업데이트할 수 없는 회원은 막지 않는다 — 스토어에 없음 · 스토어 확인 실패 · Play 가 아직 최소 버전 전", () => {
  assert.equal(decide({ store: { available: false, availableBuild: null } }).prompt, UPDATE_PROMPT.NONE, "스토어에 새 버전이 없으면 띄우지 않는다");
  const unknown = decide({ store: { available: null, availableBuild: null } });
  assert.equal(unknown.prompt, UPDATE_PROMPT.OPTIONAL, "모르면 막지 않고 권유");
  assert.equal(unknown.reason, "store_unknown");
  const behind = decide({ store: { available: true, availableBuild: 105 } });
  assert.equal(behind.prompt, UPDATE_PROMPT.OPTIONAL, "Play 에 올라간 것이 최소 버전보다 낮으면 아직 막지 않는다");
  assert.equal(behind.reason, "store_behind_minimum");
});

test("강제 적용 스위치가 꺼져 있으면 최소 버전 아래여도 권유 — 나중에(오늘만)도 지킨다", () => {
  const off = decide({ config: config({ [K.force]: "false" }) });
  assert.equal(off.prompt, UPDATE_PROMPT.OPTIONAL);
  assert.equal(off.reason, "force_off");
  const snoozed = decide({ config: config({ [K.force]: "false" }), snoozedAt: "2026-11-07T08:00:00" });
  assert.equal(snoozed.prompt, UPDATE_PROMPT.NONE);
  assert.equal(decide({ snoozedAt: "2026-11-07T08:00:00" }).prompt, UPDATE_PROMPT.REQUIRED, "필수는 나중에를 눌러 두었어도 다시 막는다");
  assert.equal(decide({ installedBuild: "115", snoozedAt: "2026-11-07T08:00:00" }).prompt, UPDATE_PROMPT.NONE, "권유는 오늘만 쉰다");
  assert.equal(decide({ installedBuild: "115", snoozedAt: "2026-11-06T08:00:00" }).prompt, UPDATE_PROMPT.OPTIONAL, "날짜가 바뀌면 다시");
});

test("모르면 띄우지 않는다 — 설정 없음 · 빌드 번호 모름 · 웹", () => {
  assert.equal(decideMemberUpdate({ config: readMemberUpdateConfig({}), platform: "android", installedBuild: "100", store: { available: true } }).prompt, UPDATE_PROMPT.NONE);
  assert.equal(decide({ installedBuild: "" }).prompt, UPDATE_PROMPT.NONE);
  assert.equal(decide({ platform: "web" }).prompt, UPDATE_PROMPT.NONE);
});

test("스토어 답 읽기 — Android 는 Play 의 가용성 · versionCode, iOS 는 스토어 버전명 비교", () => {
  assert.deepEqual(storeStateFrom("android", { currentVersionCode: "100", availableVersionCode: "120", updateAvailability: 2, immediateUpdateAllowed: true }),
    { installedBuild: 100, available: true, availableBuild: 120, immediateAllowed: true });
  assert.equal(storeStateFrom("android", { currentVersionCode: "120", availableVersionCode: "120", updateAvailability: 1 }).available, false);
  assert.equal(storeStateFrom("android", { currentVersionCode: "120", updateAvailability: 0 }).available, null, "UNKNOWN 은 모름");
  assert.equal(storeStateFrom("ios", { currentVersionCode: "40", currentVersionName: "1.1.0", availableVersionName: "1.1.1" }).available, true);
  assert.equal(storeStateFrom("ios", { currentVersionName: "1.1.1", availableVersionName: "1.1.1" }).available, false);
  assert.equal(storeStateFrom("ios", null).available, null);
  assert.equal(compareVersionNames("1.2.10", "1.2.9"), 1);
  assert.equal(compareVersionNames("1.2", "1.2.0"), 0);
});

test("[지금 업데이트] — Android 는 즉시 업데이트 우선, 안 되면 스토어 · iOS 는 앱스토어 (콘솔 주소가 있으면 그 주소)", () => {
  assert.equal(updateStartPlan("android", { available: true, immediateAllowed: true }, config()).kind, UPDATE_START.IMMEDIATE);
  assert.equal(updateStartPlan("android", { available: true, immediateAllowed: false }, config()).kind, UPDATE_START.STORE);
  assert.deepEqual(updateStartPlan("android", { available: null }, config({ [K.androidStoreUrl]: "https://play.google.com/store/apps/details?id=com.bonitapilates.member" })),
    { kind: UPDATE_START.URL, url: "https://play.google.com/store/apps/details?id=com.bonitapilates.member" });
  assert.equal(updateStartPlan("ios", { available: true }, config()).kind, UPDATE_START.STORE);
  assert.equal(updateStartPlan("ios", {}, config({ [K.iosStoreUrl]: "javascript:alert(1)" })).kind, UPDATE_START.STORE, "https 가 아닌 주소는 버린다");
});
