/**
 * 2:1 짝의 회원 카드 "이번 회원권" 막대 (2026-11-18).
 * 회원권은 한 사람(clientId) 이름으로 발급되고 짝은 clientIds 에 붙는다. 여정이 clientId 만 보면
 * 짝의 카드에서 막대가 빠졌다 -- 같은 회원권인데 두 카드가 다르게 보였다.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildPassJourney } from "../../functions/shared/pass-journey.mjs";
import { passBelongsTo } from "../../src/data/schema/pass-clients.js";
import { currentPassUsage } from "../../src/features/membership/pass-usage.js";

const duet = {
  id: "p-duet", clientId: "owner", clientIds: ["owner", "partner"], status: "active",
  totalSessions: 70, serviceSessions: 0, remainingCount: 55, purchaseRound: 4,
};

test("짝도 주인과 같은 막대를 본다", () => {
  const usageOf = (clientId) => currentPassUsage(buildPassJourney({ passes: [duet].filter((pass) => passBelongsTo(pass, clientId)) }));
  const owner = usageOf("owner");
  assert.deepEqual([owner.title, owner.usage], ["이번 회원권 · 4번째 등록", "70회 중 15회 사용"]);
  assert.deepEqual(usageOf("partner"), owner);
  assert.equal(usageOf("stranger"), null);
});

test("배선: 여정은 회원권 카드와 같은 기준(passBelongsTo)으로 회원권을 고른다", () => {
  const app = readFileSync(new URL("../../src/App.jsx", import.meta.url), "utf8");
  const body = app.slice(app.indexOf("const journeyForClient = useCallback"), app.indexOf("const passCardsForClient = useCallback"));
  assert.match(body, /rosterPasses\.filter\(\(item\) => passBelongsTo\(item, target\)\)/);
  assert.doesNotMatch(body, /item\?\.clientId === target/);
});
