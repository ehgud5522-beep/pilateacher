"use strict";

/**
 * 비포애프터 공유 현황 (2026-11-21 대표: "비포애프터도 보내는지 안 보내는지, 회원별로 잘 보내고 있는지").
 *
 * ── 왜 서버인가 ──
 * beforeAfterShares 는 규칙이 아무에게도 열지 않는다 (사진 · 코멘트 · 회원 계정이 함께 있다).
 * 그래서 대표 화면은 이 함수로만 읽고, 이 함수는 **누가 · 어느 회원에게 · 언제 · 지금 상태 · 회원이 열었는지**만
 * 돌려준다. 사진 · 카드 경로 · 코멘트 · 회원 계정 uid · 이름은 돌려주지 않는다 -- 이름은 대표 화면이 자기 명부로 붙인다.
 *
 * 역할은 대표 · 총괄매니저만 (규칙의 ownerLevel() 과 같은 선).
 */

const SHARE_STATS = Object.freeze({
  NOT_ALLOWED: "share_stats_not_allowed",
  INVALID_REQUEST: "share_stats_invalid_request",
  UNAVAILABLE: "share_stats_unavailable",
});
const STATS_ROLES = Object.freeze(["owner", "area_manager"]);
/* 한 센터가 지금까지 만든 카드. 넘치면 잘렸다고 말한다 (truncated). */
const MAX_SHARES = 5000;

class ShareStatsError extends Error {
  constructor(code, options = {}) {
    super(code, options.cause ? { cause: options.cause } : undefined);
    this.name = "ShareStatsError";
    this.code = code;
    this.stage = options.stage || "authorize";
  }
}

const text = (value) => String(value ?? "").trim();
const iso = (value) => {
  if (!value) return null;
  const at = typeof value.toDate === "function" ? value.toDate() : new Date(value);
  return Number.isFinite(at.getTime()) ? at.toISOString() : null;
};

/** 공유 문서 한 장 → 대표 화면 한 줄. 여기에 없는 칸은 나가지 않는다. */
function shareRow(share) {
  return {
    teacherId: text(share?.teacherId),
    clientId: text(share?.clientId),
    status: text(share?.status) || "unknown",
    createdAt: iso(share?.createdAt),
    sharedAt: iso(share?.sharedAt),
    revokedAt: iso(share?.revokedAt),
    read: Boolean(share?.readAt),
  };
}

/**
 * @param {{
 *   readMembership: (membershipDocumentId: string) => Promise<any>,
 *   listShares: (organizationId: string, limit: number) => Promise<any[]>,
 * }} dependencies
 */
function createShareStatsService({ readMembership, listShares }) {
  async function list(request) {
    const callerUid = text(request?.auth?.uid);
    if (!callerUid) throw new ShareStatsError("unauthenticated");
    const organizationId = text(request?.data?.organizationId);
    if (!organizationId) throw new ShareStatsError(SHARE_STATS.INVALID_REQUEST);
    let membership;
    try {
      membership = await readMembership(`${organizationId}_${callerUid}`);
    } catch (error) {
      throw new ShareStatsError(SHARE_STATS.UNAVAILABLE, { cause: error, stage: "read_membership" });
    }
    const role = membership && membership.status === "active" ? text(membership.role) : "";
    if (!STATS_ROLES.includes(role)) throw new ShareStatsError(SHARE_STATS.NOT_ALLOWED);
    let shares;
    try {
      shares = await listShares(organizationId, MAX_SHARES + 1);
    } catch (error) {
      throw new ShareStatsError(SHARE_STATS.UNAVAILABLE, { cause: error, stage: "list_shares" });
    }
    const rows = (Array.isArray(shares) ? shares : [])
      .filter((share) => share && text(share.organizationId) === organizationId)
      .map(shareRow)
      .filter((row) => row.teacherId && row.clientId);
    return { rows: rows.slice(0, MAX_SHARES), truncated: rows.length > MAX_SHARES };
  }
  return { list };
}

function createFirestoreShareStatsPorts(firestore) {
  return {
    async listShares(organizationId, limit) {
      const snapshot = await firestore.collection("beforeAfterShares")
        .where("organizationId", "==", organizationId)
        .limit(limit)
        .get();
      return snapshot.docs.map((document) => document.data());
    },
  };
}

module.exports = {
  MAX_SHARES, SHARE_STATS, ShareStatsError, createFirestoreShareStatsPorts, createShareStatsService, shareRow,
};
