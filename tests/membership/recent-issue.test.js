/* 같은 회원 최근 PT 발급 경고 (2026-11-28, PT 발급 대기 3단계). */
import assert from "node:assert/strict";
import { test } from "node:test";
import { recentPtIssueMessage, recentPtIssues } from "../../src/features/passes/recent-issue.js";

const now = new Date("2026-11-28T03:00:00Z");
const pass = (id, extra) => ({ id, clientId: "c1", category: "pt_1_1_new", status: "active", totalSessions: 20, productName: "1:1 PT 20회", createdAt: new Date("2026-11-20T03:00:00Z"), ...extra });

test("최근 60일 PT 회원권만 -- 취소 · 그룹 · 이관 · 오래된 것 · 다른 회원은 빼고, 새것부터", () => {
  const rows = recentPtIssues({ clientIds: ["c1"], now, passes: [
    pass("p1", { flowPostId: "88000001" }),
    pass("p2", { createdAt: new Date("2026-11-26T03:00:00Z"), flowBypassReason: "이전 등록" }),
    pass("old", { createdAt: new Date("2026-09-01T03:00:00Z") }),
    pass("cancel", { status: "cancelled" }),
    pass("group", { category: "etc" }),
    pass("migr", { contractedAt: new Date("2026-01-01") }),
    pass("other", { clientId: "c2" }),
    pass("duet", { clientId: "c9", clientIds: ["c9", "c1"], category: "pt_2_1_new", createdAt: new Date("2026-11-27T03:00:00Z") }),
  ] });
  assert.deepEqual(rows.map((row) => row.passId), ["duet", "p2", "p1"]);
  assert.equal(rows[2].via, "linked");
  assert.equal(rows[1].via, "bypass");
  assert.match(rows[2].label, /11\/20 · 1:1 PT 20회 · 20회 · 플로우 등록과 이어짐/);
});

test("듀엣이면 둘 다 본다 · 없으면 빈 문구", () => {
  const rows = recentPtIssues({ clientIds: ["c2", "c1"], now, passes: [pass("p1")] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].clientId, "c1");
  assert.equal(recentPtIssueMessage([]), "");
  assert.match(recentPtIssueMessage(rows, (id) => (id === "c1" ? "가회원" : "")), /^가회원님은 최근 60일 안에 PT 회원권을 받았어요: 11\/20/);
  assert.match(recentPtIssueMessage([...rows, ...rows]), /외 1건/);
});
