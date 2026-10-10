/**
 * 오프라인 사본.
 *
 * 둘을 고정한다.
 *   1. **번호가 폰에 남지 않는다.** 서버가 지운 뒤에도 기기에 남으면 아무도
 *      그것을 지울 생각을 하지 않는다.
 *   2. **오래된 숫자를 지금 숫자처럼 보여주지 않는다.** 회원은 그 숫자를
 *      믿고 수업에 온다.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CACHE_MAX_AGE_DAYS,
  CACHE_VERSION,
  NEVER_CACHED,
  VIEW_CACHE_KEY,
  cacheAgeLabel,
  cacheableViews,
  offlineNotice,
  readViewCache,
  writeViewCache,
} from "../../member/src/offline-cache.js";
import { DEVICE_KEYS } from "../../member/src/session.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const NOW = new Date(2026, 8, 27, 12, 0, 0);
const ago = (ms) => new Date(NOW.getTime() - ms);
const DAY = 86400000;

/** localStorage 흉내. 던지게 만들 수도 있다. */
function box({ throwOnGet = false, throwOnSet = false } = {}) {
  const map = new Map();
  return {
    map,
    getItem(key) { if (throwOnGet) throw new Error("막혔습니다"); return map.get(key) ?? null; },
    setItem(key, value) { if (throwOnSet) throw new Error("막혔습니다"); map.set(key, value); },
    removeItem(key) { map.delete(key); },
  };
}

const place = (overrides = {}) => ({
  link: { organizationId: "org", clientId: "c1", locationId: "loc" },
  view: {
    organizationId: "org", clientId: "c1", name: "김하나", locationName: "반송점",
    clientStatus: "active", remainingTotal: 8,
    nextExpiresAt: new Date(2027, 0, 31),
    passes: [{ passId: "p1", displayName: "1:1 퍼스널 20회", remainingCount: 8, expiresAt: new Date(2027, 0, 31) }],
    history: [{ occurredAt: new Date(2026, 8, 18), type: "deduct", instructorName: "정예진" }],
    ...overrides,
  },
});

test("번호는 어떤 모양으로도 저장되지 않는다", () => {
  /* 투영에 `phone` 이 없는 것은 서버의 허용 목록이 막고 있어서다. 거기
     한 줄이 늘면 기기 저장에도 조용히 따라 들어온다 -- 그래서 사본이 자기
     목록을 따로 든다. */
  const dirty = place();
  dirty.view.phone = "010-0000-0000";
  dirty.view.userId = "uid-1";
  dirty.view.passes[0].unitPrice = 45000;
  dirty.view.history[0].notes = "강사가 자기를 위해 쓴 기록";

  const store = box();
  writeViewCache([dirty], NOW, store);
  const raw = store.map.get(VIEW_CACHE_KEY);
  for (const forbidden of NEVER_CACHED) {
    assert.doesNotMatch(raw, new RegExp(`"${forbidden}"`), forbidden);
  }
  assert.doesNotMatch(raw, /010-0000-0000/);
  assert.doesNotMatch(raw, /45000/);
  // 보여줄 것은 남는다.
  assert.match(raw, /김하나/);
  assert.match(raw, /"remainingTotal":8/);
});

test("모르는 칸은 말없이 버린다", () => {
  const extra = place();
  extra.view.somethingNew = "나중에 생긴 칸";
  const [cached] = cacheableViews([extra]);
  assert.equal(cached.view.somethingNew, undefined);
});

test("날짜는 화면이 되읽을 수 있는 모양으로 남는다", () => {
  /* Firestore Timestamp 를 그대로 JSON 에 넣으면 {seconds,nanoseconds} 가
     되는데, 그것도 screens.toDate 가 읽기는 한다. 다만 ISO 가 사람이 읽을
     수 있고 판이 바뀌어도 뜻이 안 변한다. */
  const [cached] = cacheableViews([place()]);
  assert.equal(cached.view.nextExpiresAt, new Date(2027, 0, 31).toISOString());
  assert.equal(cached.view.passes[0].expiresAt, new Date(2027, 0, 31).toISOString());
  assert.equal(cached.view.history[0].occurredAt, new Date(2026, 8, 18).toISOString());
});

test("Firestore Timestamp 도 받는다", () => {
  const stamped = place();
  stamped.view.nextExpiresAt = { seconds: Math.floor(new Date(2027, 0, 31).getTime() / 1000), nanoseconds: 0 };
  const [cached] = cacheableViews([stamped]);
  assert.equal(new Date(cached.view.nextExpiresAt).getFullYear(), 2027);
});

test("적고 되읽으면 같은 것이 나온다", () => {
  const store = box();
  assert.equal(writeViewCache([place()], NOW, store), true);
  const read = readViewCache(store, NOW);
  assert.equal(read.places.length, 1);
  assert.equal(read.places[0].view.remainingTotal, 8);
  assert.equal(read.savedAt.getTime(), NOW.getTime());
});

test("빈 목록은 적지 않는다", () => {
  /* 아직 아무것도 못 읽은 상태를 "회원권이 없다" 로 굳혀 두면, 다음에
     오프라인으로 열었을 때 0회로 보인다. */
  const store = box();
  assert.equal(writeViewCache([], NOW, store), false);
  assert.equal(writeViewCache([{ link: { organizationId: "org", clientId: "c1" }, view: null }], NOW, store), false);
  assert.equal(store.map.size, 0);
});

test("오래된 사본은 쓰지 않는다 — 경계", () => {
  /* 잔여 횟수는 시간이 지나면 틀린다. 아무것도 안 보이는 편이 틀린 숫자보다
     낫다. */
  const fresh = box();
  writeViewCache([place()], ago(CACHE_MAX_AGE_DAYS * DAY - 1000), fresh);
  assert.ok(readViewCache(fresh, NOW), "하루 못 미치면 쓴다");

  const stale = box();
  writeViewCache([place()], ago(CACHE_MAX_AGE_DAYS * DAY), stale);
  assert.equal(readViewCache(stale, NOW), null);
});

test("미래에 적힌 사본은 믿지 않는다", () => {
  /* 시계가 틀렸거나 손댄 것이다. 통과시키면 그 사본은 영영 안 늙는다. */
  const store = box();
  writeViewCache([place()], new Date(NOW.getTime() + DAY), store);
  assert.equal(readViewCache(store, NOW), null);
});

test("판이 다르면 버린다", () => {
  const store = box();
  store.setItem(VIEW_CACHE_KEY, JSON.stringify({
    version: CACHE_VERSION + 1, savedAt: NOW.toISOString(), places: [place()],
  }));
  assert.equal(readViewCache(store, NOW), null);
});

test("깨진 사본에 화면이 죽지 않는다", () => {
  const store = box();
  store.setItem(VIEW_CACHE_KEY, "{ 이건 JSON 이 아니다");
  assert.equal(readViewCache(store, NOW), null);

  store.setItem(VIEW_CACHE_KEY, JSON.stringify({ version: CACHE_VERSION, savedAt: "언제였더라", places: [place()] }));
  assert.equal(readViewCache(store, NOW), null);

  store.setItem(VIEW_CACHE_KEY, JSON.stringify({ version: CACHE_VERSION, savedAt: NOW.toISOString(), places: "전부" }));
  assert.equal(readViewCache(store, NOW), null);
});

test("저장이 막힌 기기에서도 죽지 않는다", () => {
  assert.equal(writeViewCache([place()], NOW, box({ throwOnSet: true })), false);
  assert.equal(readViewCache(box({ throwOnGet: true }), NOW), null);
  assert.doesNotThrow(() => readViewCache(null, NOW));
});

test("언제 본 것인지 감추지 않는다", () => {
  assert.equal(cacheAgeLabel(ago(30000), NOW), "조금 전");
  assert.equal(cacheAgeLabel(ago(5 * 60000), NOW), "5분 전");
  assert.equal(cacheAgeLabel(ago(3 * 3600000), NOW), "3시간 전");
  assert.equal(cacheAgeLabel(ago(DAY + 3600000), NOW), "어제");
  assert.equal(cacheAgeLabel(ago(5 * DAY), NOW), "5일 전");
  assert.equal(cacheAgeLabel("언제였더라", NOW), "");

  /* 문장은 나이와 다음에 할 일을 함께 말한다. "오프라인" 이라는 말은 쓰지
     않는다 -- 회원이 고칠 수 있는 것을 가리켜야 한다. */
  const notice = offlineNotice(ago(2 * 3600000), NOW);
  assert.match(notice, /2시간 전에 확인한 정보/);
  assert.match(notice, /연결되면/);
});

test("계정을 지우면 사본도 걷는다", () => {
  /* 계정은 지웠는데 잔여가 폰에 남아 있으면, 다음에 이 폰을 여는 사람이
     서버에는 없는 숫자를 본다. */
  assert.ok(DEVICE_KEYS.includes(VIEW_CACHE_KEY));
});

test("화면은 사본을 지금 것처럼 그리지 않는다", async () => {
  /* 사본을 쓰는 자리와 그 사실을 말하는 자리가 갈라지면, 갈라진 쪽은
     아무도 안 본다. */
  const app = await readFile(path.join(root, "member/src/App.jsx"), "utf8");
  assert.match(app, /readViewCache\(\)/);
  assert.match(app, /offlineAt: cached\.savedAt/);
  assert.match(app, /state\.offlineAt \?[\s\S]{0,200}offlineNotice\(state\.offlineAt\)/);
  /* 오프라인에서는 계정 삭제를 내지 않는다 -- 누르면 실패할 뿐이고,
     되돌릴 수 없는 버튼이 실패하는 것은 회원을 불안하게 한다. */
  assert.match(app, /state\.offlineAt \? undefined : removeAccount/);
});
