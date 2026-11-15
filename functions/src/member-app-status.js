"use strict";

/* 보니따 앱 설치 현황 (2026-11-15 대표: "누가 아직 안 깔았는지 깔았는지 확인하는 거 더보기에").
 *
 * 대표(대표 · 총괄)만 부른다. 센터 회원 가운데 회원 앱 계정과 이어진 사람(clients.userId)마다
 * "앱을 쓰는가" 를 돌려준다. 근거는 둘이다 -- 서버만 쓰는 memberPush/{uid} 에 있는 것들:
 *   - tokens: 알림을 허락한 휴대폰 앱이 등록한 기기 (플랫폼 ios · android)
 *   - seen:   회원 앱이 켜질 때 남긴 마지막 시각 (member-push.js recordSeen, 플랫폼 ios · android · web)
 * 이름 · 전화번호 · 토큰 값은 돌려주지 않는다. 회원 id 와 "어디서 · 언제" 만 -- 이름은 강사 앱이 명부에서 붙인다.
 * 이어지지 않은 회원(가입 · 연결 전)은 여기에 없다 -- 강사 앱이 명부에서 userId 없는 회원으로 센다.
 */

const { isOwnerLevel, membershipId } = require("./member-link");

const text = (value) => String(value ?? "").trim();
const NATIVE = new Set(["ios", "android"]);
const toMillis = (value) => {
  if (!value) return NaN;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return new Date(value).getTime();
};
const statusError = (httpsCode, code) => Object.assign(new Error(code), { httpsCode, code });

/** memberPush 문서 하나에서 "어디서 · 언제" 만 뽑는다. 토큰 값은 버린다. */
function appUsageOf(doc) {
  const platforms = new Set();
  let notifications = false;
  const tokens = doc?.tokens && typeof doc.tokens === "object" ? Object.values(doc.tokens) : [];
  for (const entry of tokens) {
    if (!text(entry?.token)) continue;
    notifications = true;
    if (NATIVE.has(text(entry?.platform))) platforms.add(text(entry.platform));
  }
  let lastSeen = NaN, lastPlatform = "";
  const seen = doc?.seen && typeof doc.seen === "object" ? doc.seen : {};
  for (const [platform, at] of Object.entries(seen)) {
    const ms = toMillis(at);
    if (!Number.isFinite(ms)) continue;
    if (NATIVE.has(platform)) platforms.add(platform);
    if (!Number.isFinite(lastSeen) || ms > lastSeen) { lastSeen = ms; lastPlatform = platform; }
  }
  return {
    app: platforms.size > 0,
    platforms: [...platforms].sort(),
    notifications,
    lastSeenAt: Number.isFinite(lastSeen) ? new Date(lastSeen).toISOString() : "",
    lastPlatform,
  };
}

function createMemberAppStatusService({ firestore }) {
  async function list(request) {
    const uid = text(request?.auth?.uid);
    if (!uid) throw statusError("unauthenticated", "unauthenticated");
    const organizationId = text(request?.data?.organizationId);
    if (!organizationId || organizationId.includes("/")) throw statusError("invalid-argument", "organization_required");
    const membership = await firestore.doc(`memberships/${membershipId(organizationId, uid)}`).get();
    if (!isOwnerLevel(membership.exists ? membership.data() : null)) throw statusError("permission-denied", "not_owner");

    const clients = await firestore.collection(`organizations/${organizationId}/clients`).where("userId", ">", "").select("userId").get();
    const byUser = new Map();
    for (const doc of clients.docs) {
      const userId = text(doc.get("userId"));
      if (!userId || userId.includes("/")) continue;
      if (!byUser.has(userId)) byUser.set(userId, []);
      byUser.get(userId).push(doc.id);
    }
    const userIds = [...byUser.keys()];
    const members = [];
    for (let start = 0; start < userIds.length; start += 100) {
      const chunk = userIds.slice(start, start + 100);
      const docs = await firestore.getAll(...chunk.map((id) => firestore.collection("memberPush").doc(id)));
      docs.forEach((doc, index) => {
        const usage = appUsageOf(doc.exists ? doc.data() : null);
        for (const clientId of byUser.get(chunk[index])) members.push({ clientId, ...usage });
      });
    }
    return { members, checkedAt: new Date().toISOString() };
  }
  return { list };
}

module.exports = { createMemberAppStatusService, appUsageOf };
