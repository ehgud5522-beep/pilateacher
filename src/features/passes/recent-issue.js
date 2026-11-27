/**
 * 같은 회원이 최근에 PT 회원권을 받았는가 (2026-11-28, PT 발급 대기 3단계).
 *
 * 플로우 업무 하나로는 회원권이 하나만 나간다 (규칙). 그런데 같은 회원을 **새 업무로 다시 올리면** -- 상담 실패 뒤
 * 다시 연락해 새로 올렸거나, 같은 계약을 두 번 올렸거나 -- 업무 번호가 달라 규칙이 막을 수 없다. 재등록은 정상이므로
 * 막지 않고, 발급 화면과 확인 화면에서 "최근 발급이 있다" 를 날짜 · 상품 · 플로우 연결 여부와 함께 보여 준다.
 *
 * 순수 함수다. 회원권 목록은 발급 화면이 이미 읽은 것을 그대로 쓴다.
 */
import { passBelongsTo } from "../../../functions/shared/pass-clients.mjs";

export const RECENT_ISSUE_DAYS = 60;

const text = (value) => String(value ?? "").trim();
const asDate = (value) => {
  if (!value) return null;
  const at = typeof value?.toDate === "function" ? value.toDate() : value instanceof Date ? value : new Date(value);
  return Number.isFinite(at?.getTime?.()) ? at : null;
};
const ptCategory = (category) => /^(pt_|diosa_)/.test(text(category));
const monthDay = (at) => `${at.getMonth() + 1}/${at.getDate()}`;

/**
 * @param {{ clientIds: Array<string>, passes: Array<any>, now?: Date, days?: number }} input
 * @returns {Array<{ passId: string, clientId: string, issuedAt: Date, label: string, via: "linked" | "bypass" | "none" }>}
 *   새것부터. 취소된 회원권 · PT 아닌 회원권 · 이관분은 빼고 센다.
 */
export function recentPtIssues({ clientIds = [], passes = [], now = new Date(), days = RECENT_ISSUE_DAYS }) {
  const ids = [...new Set((clientIds || []).map(text).filter(Boolean))];
  if (!ids.length) return [];
  const since = now.getTime() - days * 86400000;
  const rows = [];
  for (const pass of passes || []) {
    if (!pass || !ptCategory(pass.category) || text(pass.status) === "cancelled" || pass.contractedAt) continue;
    const issuedAt = asDate(pass.createdAt);
    if (!issuedAt || issuedAt.getTime() < since || issuedAt.getTime() > now.getTime() + 60000) continue;
    const clientId = ids.find((id) => passBelongsTo(pass, id));
    if (!clientId) continue;
    const via = text(pass.flowPostId) ? "linked" : text(pass.flowBypassReason) ? "bypass" : "none";
    const sessions = Number(pass.totalSessions) > 0 ? `${Number(pass.totalSessions)}회` : "";
    rows.push({
      passId: text(pass.id || pass.passId),
      clientId,
      issuedAt,
      via,
      label: [monthDay(issuedAt), text(pass.productName) || "PT", sessions, via === "linked" ? "플로우 등록과 이어짐" : via === "bypass" ? "플로우 없이 발급" : ""].filter(Boolean).join(" · "),
    });
  }
  return rows.sort((left, right) => right.issuedAt.getTime() - left.issuedAt.getTime());
}

/** 화면 한 줄. 없으면 "". */
export function recentPtIssueMessage(rows, nameOf = () => "") {
  if (!rows?.length) return "";
  const first = rows[0];
  const who = nameOf(first.clientId);
  const more = rows.length > 1 ? ` 외 ${rows.length - 1}건` : "";
  return `${who ? `${who}님은 ` : ""}최근 ${RECENT_ISSUE_DAYS}일 안에 PT 회원권을 받았어요: ${first.label}${more}. 같은 계약을 두 번 발급하는 게 아닌지 플로우에서 확인해 주세요.`;
}
