"use strict";

/**
 * FC 회원권 발급 → 대표 · 총괄 알림함 (2026-11-21 대표: "FC 가 수강권 발급 때도 알림이 가게 해줘").
 * 문구 · 눈여겨볼 것은 shared/issue-notice.mjs.
 *
 * 회원권 문서가 생기면(트리거) 만든 사람의 소속을 읽어 FC매니저(role manager)일 때만 보낸다. 대표 · 총괄이 발급한 것은
 * 보내지 않는다. 이관(csv_) 회원권도 보내지 않는다. 같은 회원권은 한 번만 (알림 id = issue_{회원권}).
 * 실패해도 던지지 않는다 -- 발급은 이미 끝났고, 알림 때문에 무엇도 되돌리지 않는다. 진단만 남긴다.
 */

const text = (value) => String(value ?? "").trim();
const loadShared = () => import("../shared/issue-notice.mjs");

/**
 * @param {{ firestore: any, isOwnerLevel: (membership: any) => boolean, log?: (level: string, event: string, fields: any) => void }} deps
 */
function createIssueNoticeService({ firestore, isOwnerLevel, log = () => {} }) {
  async function nameOf(path, field = "name") {
    try {
      const snapshot = await firestore.doc(path).get();
      return snapshot.exists ? text(snapshot.data()?.[field]) : "";
    } catch {
      return "";
    }
  }

  /** @returns {Promise<{ sent: number, skipped?: string, errorCode?: string }>} */
  async function onPassCreated(organizationId, passId, pass, at = new Date()) {
    const org = text(organizationId);
    const id = text(passId);
    const where = { feature: "issue_notice", stage: "notify_owner", organizationId: org, correlationId: id.slice(-8) };
    try {
      if (!org || !id || !pass) return { sent: 0, skipped: "missing_fields" };
      if (id.startsWith("csv_") || (pass.contractedAt !== undefined && pass.contractedAt !== null)) return { sent: 0, skipped: "migrated" };
      const creator = text(pass.createdBy);
      if (!creator) return { sent: 0, skipped: "no_creator" };
      const members = (await firestore.collection("memberships").where("organizationId", "==", org).get()).docs.map((document) => document.data() || {});
      const issuer = members.find((row) => text(row.userId) === creator);
      if (!issuer || issuer.role !== "manager") return { sent: 0, skipped: "not_fc" };
      const owners = members.filter((row) => row.status === "active" && isOwnerLevel(row) && text(row.userId) && text(row.userId) !== creator);
      if (!owners.length) return { sent: 0, skipped: "no_owner" };
      const shared = await loadShared();
      const instructor = members.find((row) => text(row.userId) === text(pass.instructorId));
      const [clientName, productName, locationName] = await Promise.all([
        pass.clientId ? nameOf(`organizations/${org}/clients/${text(pass.clientId)}`) : "",
        pass.productId ? nameOf(`organizations/${org}/products/${text(pass.productId)}`) : "",
        pass.locationId ? nameOf(`organizations/${org}/locations/${text(pass.locationId)}`) : "",
      ]);
      const notice = shared.passIssuedNotice({
        issuerName: text(issuer.displayName) || "FC", instructorName: text(instructor?.displayName),
        clientName, productName, locationName, pass,
      });
      for (const owner of owners) {
        await firestore.collection("users").doc(text(owner.userId)).collection("inbox").doc(`issue_${id}`).set({
          kind: shared.PASS_ISSUED_INBOX_KIND, organizationId: org, passId: id, clientId: text(pass.clientId),
          issuedBy: creator, watch: notice.watch, title: notice.title, body: notice.body, createdAt: at,
        });
      }
      return { sent: owners.length };
    } catch (error) {
      const errorCode = String(error?.code || "unknown");
      log("error", "issue_notice_failed", { ...where, errorDomain: "firestore", errorCode, message: String(error?.message || "").slice(0, 200) });
      return { sent: 0, errorCode };
    }
  }

  return { onPassCreated };
}

module.exports = { createIssueNoticeService };
