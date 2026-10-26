/**
 * 인계를 실행한다. 계획은 `features/members/instructor-handover.js` 가 세운다.
 *
 * ── 왜 장마다 따로 쓰는가 ──
 * 한 배치에 다 담지 않는다. 퇴사 인계는 수십 장이 될 수 있고, Firestore 배치는
 * 500 쓰기에서 끊긴다 -- 회원권 한 장이 문서 둘(회원권 + 원장)을 쓰므로 그
 * 한계가 생각보다 가깝다.
 *
 * **그리고 중간에 멈추는 쪽이 낫다.** 스무 장 중 열두 장이 넘어갔으면 그
 * 열두 장은 실제로 넘어간 것이고, 화면이 어디까지 갔는지 말할 수 있다.
 * 통째로 되돌리면 대표는 다시 처음부터 눌러야 하고, 그 사이 차감이 섞인다.
 *
 * 장 하나 안에서는 한 배치다 (transferPassInstructor) -- 담당만 바뀌고 이력이
 * 없거나 그 반대가 되면 안 된다.
 *
 * ── 누적은 맨 마지막에, 회원당 한 번 ──
 * 누적은 강사-회원 쌍 하나당 하나다. 장마다 더하면 세 장이면 세 배가 되고,
 * 그 숫자가 20회 경계를 정하므로 재등록 첫 차감부터 기준 단가가 된다.
 */

import { transferPassInstructor } from "./pass-repository.js";
import { AUDIT_ACTION, auditEntry, auditLogId } from "./audit-repository.js";
import { paths } from "../schema/paths.js";

const text = (value) => String(value ?? "").trim();

/**
 * @typedef {object} HandoverStore
 * @property {(writes: Array<any>) => Promise<void>} commit
 * @property {() => Promise<any>} serverTimestamp
 */

/**
 * 계획을 실행한다.
 *
 * @param {string} organizationId
 * @param {{
 *   fromInstructorId?: string,
 *   rows?: Array<any>,
 *   actorId?: string, actorRole?: string,
 * }} plan
 * @param {{ store?: HandoverStore, passStore?: any, now?: () => Date }} [options]
 * @returns {Promise<{ moved: Array<any>, failed: Array<any>, carried: Array<any> }>}
 */
export async function runHandover(organizationId, plan, options = {}) {
  const organization = text(organizationId);
  if (!organization) throw new Error("Missing organizationId");
  const fromInstructorId = text(plan?.fromInstructorId);
  if (!fromInstructorId) throw new Error("Missing fromInstructorId");
  const { store, passStore } = options;
  if (!store) throw new Error("Missing store");

  const rows = (Array.isArray(plan?.rows) ? plan.rows : []).filter(
    (row) => row && row.blocks?.length === 0 && text(row.toInstructorId),
  );

  const moved = [];
  const failed = [];
  for (const row of rows) {
    try {
      await transferPassInstructor(organization, row.passId, {
        clientId: row.clientIds[0],
        clientIds: row.clientIds,
        fromInstructorId,
        toInstructorId: row.toInstructorId,
        locationId: row.locationId,
        createdBy: text(plan?.actorId),
      }, { store: passStore });
      moved.push(row);
    } catch (error) {
      /* 한 장이 막혀도 나머지는 간다. 원본 코드를 버리지 않는다 -- 그것이
         없으면 왜 막혔는지 확정할 수 없다 (CLAUDE.md 2항). */
      failed.push({ ...row, errorCode: text(error?.code) || text(error?.message) || "unknown" });
    }
  }

  /* ── 누적은 옮기지 않는다 (2026-10-23 대표 결정) ────────────────────
     **새 강사의 누적은 새 강사가 실제로 한 수업만 센다.** 전 강사의 누적을
     더하면 새 강사는 한 번도 보지 않은 회원을 "이미 20회 넘긴 회원" 으로
     물려받고, 첫 수업부터 기준 단가가 된다.

     회원권은 그대로 인수인계 단가다 (handedOver → 판정 2) -- 남은 회차
     전부가 신규 단가이므로 누적과 무관하게 낮게 유지된다. */
  const carried = [];

  /* 기록은 **한 번**이다. 장마다 남기면 퇴사 인계 하나가 감사 목록 수십 줄이
     되고, 그러면 그 목록은 안 읽힌다. 몇 장이 넘어갔는지가 그 줄의 내용이다. */
  if (moved.length > 0) {
    const stampedAt = await store.serverTimestamp();
    const entry = auditEntry(organization, {
      action: AUDIT_ACTION.MEMBER_PROFILE_CHANGED,
      actorId: text(plan?.actorId),
      actorRole: text(plan?.actorRole),
      targetId: fromInstructorId,
      stage: "handover",
      succeeded: moved.length,
      failed: failed.length,
      stampedAt,
    });
    await store.commit([{
      path: paths.auditLog(auditLogId(entry.action, fromInstructorId, String(Date.now()))),
      data: entry,
    }]);
  }

  return { moved, failed, carried };
}
