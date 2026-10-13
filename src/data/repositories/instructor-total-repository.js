/**
 * 누적 보정 — **급여 판정 3 이 보는 숫자를 손으로 고치는 일.**
 *
 * ── 왜 따로 있는가 ──
 * 이 숫자 하나가 그 회원의 남은 수업 단가를 전부 정한다. 20 을 넘기면 카테고리
 * 단가이고 아니면 신규 단가인데, 그 경계가 한 칸 어긋나면 그 회원권의 모든
 * 회차가 틀린 금액으로 원장에 박힌다 -- 원장은 append-only 라 되돌릴 수 없다.
 *
 * 그래서 **기록 없이는 고칠 수 없게** 묶어 둔다. 누적 문서와 감사 항목이 한
 * 배치다. 둘 중 하나만 쓰이면 숫자는 바뀌었는데 왜 바뀌었는지가 없거나, 그
 * 반대가 된다.
 *
 * ── 왜 플래그가 아닌가 ──
 * "기준 단가 고정" 플래그는 틀린 숫자를 그대로 둔 채 덮는다. 누적이 23 인데
 * 실제 15 인 회원에게 플래그를 켜면 그 회원은 21번째를 영영 못 넘고, 플래그를
 * 끄는 날 다시 신규 단가로 돌아간다 -- 원인인 그 숫자가 그대로이기 때문이다.
 * 보정은 원인을 고친다 (2026-10-13 대표 결정).
 *
 * ── 누가 ──
 * 대표와 총괄매니저다 (ownerLevel). 규칙은 이미 그 둘에게 `sessions >= 0` 을
 * 열어 두고 있어 이 파일 때문에 바뀌는 문이 없다 -- 감사 쪽만 늘어난다.
 */

import {
  TOTAL_ADJUST_REASON, totalAdjustmentEntry,
} from "./audit-repository.js";
import { paths } from "../schema/paths.js";

const requiredText = (value, label) => {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`Missing ${label}`);
  return text;
};

const requiredCount = (value, label) => {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    /* 음수가 들어가면 규칙이 그 문서의 **모든 쓰기를 거부**하고, 그때부터 그
       회원의 차감이 통째로 막힌다. 화면에는 permission-denied 한 줄로만
       도착해서 원인을 짚을 수 없다. */
    throw new Error(`Invalid ${label}`);
  }
  return value;
};

export { TOTAL_ADJUST_REASON };

/** 누적 문서의 id. 강사–회원 쌍 하나에 문서 하나다. */
export const instructorTotalId = (instructorId, clientId) =>
  `${requiredText(instructorId, "instructorId")}_${requiredText(clientId, "clientId")}`;

/**
 * @typedef {object} InstructorTotalStore
 * @property {(path: string) => Promise<any>} read
 * @property {(writes: Array<{ path: string, data: object, operation?: string }>) => Promise<void>} commit
 * @property {() => Promise<any>} serverTimestamp
 */

/**
 * 누적을 정해진 값으로 맞춘다. 더하거나 빼지 않는다.
 *
 * **읽은 값과 기대한 값이 다르면 쓰지 않는다** (`expectedSessions`). 목록을
 * 뽑아 놓고 누르기까지 사이에 그 회원의 수업이 확정되면, 그 회차가 조용히
 * 사라진다 -- 화면에 보인 숫자가 아직 참인지를 쓰기 직전에 한 번 더 본다.
 *
 * @param {string} organizationId
 * @param {{
 *   instructorId?: string, clientId?: string, sessions?: number,
 *   expectedSessions?: number | null, reason?: string,
 *   actorId?: string, actorRole?: string,
 * }} input
 *   sessions         바꿀 값. 더하는 값이 아니라 **그 자체**다
 *   expectedSessions 지금 저장돼 있다고 믿는 값. 다르면 던진다
 *   reason           TOTAL_ADJUST_REASON 중 하나
 * @param {{ store?: InstructorTotalStore, now?: () => Date }} [options]
 */
export async function adjustInstructorTotal(organizationId, input, options = {}) {
  const { store } = options;
  if (!store) throw new Error("Missing store");
  const organization = requiredText(organizationId, "organizationId");
  const instructorId = requiredText(input?.instructorId, "instructorId");
  const clientId = requiredText(input?.clientId, "clientId");
  const sessions = requiredCount(input?.sessions, "sessions");

  const path = paths.instructorClientTotal(organization, instructorId, clientId);
  const current = await store.read(path);
  /* 문서가 없으면 만들지 않는다. 없다는 것은 그 강사가 그 회원을 앱으로
     가르친 적이 없다는 뜻이고, 거기에 숫자를 심으면 있지도 않던 기록이 생긴다.
     정말 필요하면 이관 통로로 심는다 -- 그쪽은 이력이 남는다. */
  if (!current) throw new Error("Missing total");
  const previousSessions = requiredCount(Number(current?.sessions), "previousSessions");

  if (input?.expectedSessions !== undefined && input?.expectedSessions !== null
    && Number(input.expectedSessions) !== previousSessions) {
    /* 코드를 남긴다. "저장하지 못했습니다" 만으로는 다시 눌러야 하는지 값을
       다시 봐야 하는지 알 수 없다. */
    throw Object.assign(new Error("Stale total"), { code: "stale_total" });
  }

  const stampedAt = await store.serverTimestamp();
  /* 사유와 전·후가 없으면 여기서 던진다 -- 감사 항목을 먼저 만드는 이유가
     그것이다. 누적만 바뀌고 기록이 없는 상태를 만들 수 없다. */
  const entry = totalAdjustmentEntry(organization, {
    actorId: input?.actorId,
    actorRole: input?.actorRole,
    instructorId,
    clientId,
    previousSessions,
    sessions,
    reason: input?.reason,
    stampedAt,
  });

  /* 한 배치다. 숫자만 바뀌고 기록이 없거나 그 반대가 되면, 다음 달 정산에서
     그 차이를 설명할 사람이 없다. */
  const logId = `instructor_total_adjusted_${instructorId}_${clientId}_${Date.now()}`
    .replace(/[^A-Za-z0-9_-]/g, "");
  await store.commit([
    { path, data: { sessions }, operation: "update" },
    { path: paths.auditLog(logId), data: entry },
  ]);
  return { path, logId, previousSessions, sessions, entry };
}
