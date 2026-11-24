"use strict";

/**
 * 점장용 재등록 레이더 재료 (2026-11-24 대표: "재등록 레이더를 점장한테 보이게 -- 강사들 면담할 때, 자기 지점만").
 *
 * ── 왜 서버가 골라 주는가 ──
 * 레이더는 회원 · 회원권 · 최근 8주 출석(원장의 차감)을 읽어 계산한다. 원장 줄에는 그 수업의 단가(강사 급여)가 있어
 * 규칙은 강사에게 남의 원장을 열지 않는다. 점장(직함, 역할은 강사)에게 원장을 여는 대신, 서버가 **자기 지점의 것만,
 * 계산에 필요한 칸만** 골라 건넨다 -- 출석은 회원 · 회원권 · 시각뿐(단가 · 카테고리 없음), 회원에게 보낸 말은 "있었다"
 * 표시와 시각뿐(원문 없음), 회원 앱 연결은 예/아니오뿐(계정 id 없음), 연락처는 없다.
 * 계산은 앱이 대표 화면과 같은 함수(features/records/renewal-radar.js)로 한다 -- 숫자가 갈라지지 않게.
 *
 * 볼 수 있는 사람 (대표 · 총괄은 원래 화면을 쓴다):
 *   점장(직함)  맡은 지점(locationIds · locationId)만
 *   부원장      모든 지점 (2026-11-24 대표: "부원장으로 지정되면 모든 지점 것 다 읽을 수 있게")
 */

const text = (value) => String(value ?? "").trim();
const DAY_MS = 86400000;
const LEDGER_DAYS = 56;
const NOTES_DAYS = 45;

const refusal = (reason, httpsCode = "permission-denied") => Object.assign(new Error(reason), { httpsCode, reason });

function scopedLocations(membership) {
  const many = Array.isArray(membership?.locationIds) ? membership.locationIds.map(text).filter(Boolean) : [];
  if (many.length) return [...new Set(many)];
  const one = text(membership?.locationId);
  return one ? [one] : [];
}

const isBranchManager = (membership) => Boolean(membership)
  && text(membership.status) === "active"
  && text(membership.role) === "instructor"
  && text(membership.title) === "branch_manager";

/* 부원장: 대표가 강사 관리에서 지정한다 (isDeputyDirector -- 규칙상 대표만 바꾼다). 강사 · FC 어느 쪽이든. */
const isDeputyDirector = (membership) => Boolean(membership)
  && text(membership.status) === "active"
  && ["instructor", "manager"].includes(text(membership.role))
  && membership.isDeputyDirector === true;

/** 누가 어느 지점을 보는가. 못 보면 null. */
function radarViewer(membership) {
  if (isDeputyDirector(membership)) return { scope: "all", locations: null };
  if (isBranchManager(membership)) return { scope: "branch", locations: scopedLocations(membership) };
  return null;
}

const millis = (value) => {
  if (!value) return null;
  if (typeof value.toMillis === "function") return value.toMillis();
  const at = new Date(value).getTime();
  return Number.isFinite(at) ? at : null;
};

const chunks = (list, size = 30) => {
  const out = [];
  for (let index = 0; index < list.length; index += size) out.push(list.slice(index, index + size));
  return out;
};

/**
 * @param {any} firestore Admin Firestore
 * @param {{ callerUid: string, organizationId: string, now?: Date }} input
 */
async function renewalRadarBranch(firestore, input) {
  const callerUid = text(input?.callerUid);
  const organizationId = text(input?.organizationId);
  if (!callerUid) throw refusal("unauthenticated", "unauthenticated");
  if (!organizationId || organizationId.includes("/")) throw refusal("missing_fields", "invalid-argument");
  const membershipSnapshot = await firestore.collection("memberships").doc(`${organizationId}_${callerUid}`).get();
  const membership = membershipSnapshot.exists ? membershipSnapshot.data() || {} : null;
  const viewer = radarViewer(membership);
  if (!viewer) throw refusal("not_branch_manager");
  if (viewer.scope === "branch" && !viewer.locations.length) throw refusal("no_branch", "failed-precondition");

  const now = input?.now instanceof Date ? input.now : new Date();
  const org = firestore.collection("organizations").doc(organizationId);
  const locationsSnapshot = await org.collection("locations").get();
  /* 부원장은 센터의 모든 지점. */
  const mine = viewer.scope === "all" ? locationsSnapshot.docs.map((snapshot) => snapshot.id) : viewer.locations;
  const inScope = (locationId) => viewer.scope === "all" || mine.includes(text(locationId));

  /* 회원 · 회원권: 맡은 지점만 (부원장은 전부). */
  const clientDocs = [];
  const passDocs = [];
  if (viewer.scope === "all") {
    const [clients, passes] = await Promise.all([org.collection("clients").get(), org.collection("passes").get()]);
    clientDocs.push(...clients.docs);
    passDocs.push(...passes.docs);
  } else {
    for (const ids of chunks(mine)) {
      const [clients, passes] = await Promise.all([
        org.collection("clients").where("locationId", "in", ids).get(),
        org.collection("passes").where("locationId", "in", ids).get(),
      ]);
      clientDocs.push(...clients.docs);
      passDocs.push(...passes.docs);
    }
  }
  const clients = clientDocs.map((snapshot) => {
    const data = snapshot.data() || {};
    return {
      id: snapshot.id,
      name: text(data.name || data.displayName),
      locationId: text(data.locationId),
      instructorIds: Array.isArray(data.instructorIds) ? data.instructorIds.map(text).filter(Boolean) : [],
      archived: data.archived === true,
      /* 회원 앱에 연결됐는가만. 레이더는 이 칸이 비었는지만 본다 -- 계정 id 는 보내지 않는다. */
      userId: text(data.userId) ? "linked" : "",
      ...(data.reviewDemo === true ? { reviewDemo: true } : {}),
    };
  });
  const clientIds = new Set(clients.map((client) => client.id));
  const passes = passDocs.map((snapshot) => {
    const data = snapshot.data() || {};
    return {
      id: snapshot.id,
      clientId: text(data.clientId),
      clientIds: Array.isArray(data.clientIds) ? data.clientIds.map(text).filter(Boolean) : [],
      locationId: text(data.locationId),
      instructorId: text(data.instructorId),
      status: text(data.status),
      remainingCount: Number(data.remainingCount) || 0,
      totalSessions: Number(data.totalSessions) || 0,
      serviceSessions: Number(data.serviceSessions) || 0,
      purchaseRound: Number(data.purchaseRound) || 0,
      expiresAt: millis(data.expiresAt),
      createdAt: millis(data.createdAt),
      holdFrom: millis(data.holdFrom),
      holdUntil: millis(data.holdUntil),
    };
  });
  const passIds = new Set(passes.map((pass) => pass.id));

  /* 출석: 최근 8주의 차감 · 되돌림. 단가 · 카테고리 · 강사 칸은 빼고 회원 · 회원권 · 시각만. */
  const ledgerSnapshot = await firestore.collectionGroup("ledger")
    .where("organizationId", "==", organizationId)
    .where("type", "in", ["deduct", "correction"])
    .where("occurredAt", ">=", new Date(now.getTime() - LEDGER_DAYS * DAY_MS))
    .where("occurredAt", "<", new Date(now.getTime() + DAY_MS))
    .get();
  const ledger = ledgerSnapshot.docs
    .map((snapshot) => ({ id: snapshot.id, ...(snapshot.data() || {}) }))
    .filter((entry) => passIds.has(text(entry.passId)))
    .map((entry) => ({
      id: entry.id, type: text(entry.type), passId: text(entry.passId), clientId: text(entry.clientId),
      occurredAt: millis(entry.occurredAt),
      ...(text(entry.correctsEntryId) ? { correctsEntryId: text(entry.correctsEntryId) } : {}),
    }));

  /* 회원에게 보낸 말: 있었다는 것과 시각만. */
  const notesSnapshot = await org.collection("lessonNotes")
    .where("createdAt", ">=", new Date(now.getTime() - NOTES_DAYS * DAY_MS))
    .where("createdAt", "<", new Date(now.getTime() + DAY_MS))
    .get();
  const lessonNotes = notesSnapshot.docs
    .map((snapshot) => snapshot.data() || {})
    .filter((note) => clientIds.has(text(note.clientId)) && text(note.memberNote))
    .map((note) => ({ clientId: text(note.clientId), createdAt: millis(note.createdAt), memberNote: "1" }));

  /* 재등록 결과 (서버가 만든 후보 줄): 맡은 지점만. */
  const candidates = [];
  const candidatePages = viewer.scope === "all"
    ? [await org.collection("renewalCandidates").get()]
    : await Promise.all(chunks(mine).map((ids) => org.collection("renewalCandidates").where("locationId", "in", ids).get()));
  for (const page of candidatePages) {
    for (const snapshot of page.docs) {
      const data = snapshot.data() || {};
      candidates.push({
        id: snapshot.id, clientId: text(data.clientId), instructorId: text(data.instructorId), locationId: text(data.locationId),
        status: text(data.status), decidedAt: millis(data.decidedAt),
      });
    }
  }

  /* 강사 이름 · 지점 (명부). 점장 본인도 강사라 함께 나온다. */
  const membersSnapshot = await firestore.collection("memberships").where("organizationId", "==", organizationId).get();
  const members = membersSnapshot.docs.map((snapshot) => snapshot.data() || {})
    .filter((member) => viewer.scope === "all" || scopedLocations(member).some((location) => inScope(location)))
    .map((member) => ({
      userId: text(member.userId), displayName: text(member.displayName), role: text(member.role), status: text(member.status),
      locationId: text(member.locationId), locationIds: scopedLocations(member),
      ...(Array.isArray(member.previousUids) ? { previousUids: member.previousUids.map(text).filter(Boolean) } : {}),
    }));
  const locations = locationsSnapshot.docs
    .filter((snapshot) => inScope(snapshot.id))
    .map((snapshot) => ({ id: snapshot.id, name: text(snapshot.data()?.name) }));

  return { scope: viewer.scope, locationIds: mine, now: now.getTime(), clients, passes, ledger, lessonNotes, candidates, members, locations };
}

module.exports = { renewalRadarBranch, radarViewer, isBranchManager, isDeputyDirector, scopedLocations };
