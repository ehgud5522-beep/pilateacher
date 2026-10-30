import assert from "node:assert/strict";
import test from "node:test";
import {
  LINK_OUTCOME, linkCandidates, linkDeviceMember, uploadReadiness,
} from "../../src/features/roster/unlinked-members.js";
import { ROSTER_SOURCE } from "../../src/features/roster/roster-bridge.js";

/* 센터에 등록되지 않은 회원 -- 기기에만 있는 회원 (2026-10-31). 지우지 않는다. */

test("이을 후보는 아직 기기 회원과 이어지지 않았고 연락처가 있는 센터 회원뿐", () => {
  const roster = [
    { id: "a", name: "나", phone: "01011112222", rosterSource: ROSTER_SOURCE.ORG },
    { id: "b", name: "가", phone: "01033334444", rosterSource: ROSTER_SOURCE.ORG_LINKED },
    { id: "c", name: "다", phone: "", rosterSource: ROSTER_SOURCE.ORG },
    { id: "d", name: "라", phone: "01055556666", rosterSource: ROSTER_SOURCE.LOCAL_ONLY },
  ];
  assert.deepEqual(linkCandidates(roster).map((item) => item.id), ["a"]);
});

test("올리려면 이름과 연락처가 있어야 한다 — 없으면 무엇이 없는지", () => {
  assert.deepEqual(uploadReadiness({ name: "회원", phone: "010-1111-2222" }), { ready: true, missing: "" });
  assert.deepEqual(uploadReadiness({ name: "회원", phone: "" }), { ready: false, missing: "phone" });
  assert.deepEqual(uploadReadiness({ name: " ", phone: "01011112222" }), { ready: false, missing: "name" });
});

test("잇기는 연락처를 그 센터 회원의 것으로 맞춘다 — 회원 id · 기록은 그대로", () => {
  const members = [{ id: "m1", name: "기기", phone: "", notes: [{ id: "n1" }] }];
  const { outcome, members: next } = linkDeviceMember(members, "m1", { id: "c1", phone: "010-7777-8888" });
  assert.equal(outcome, LINK_OUTCOME.LINKED);
  assert.deepEqual(next[0], { id: "m1", name: "기기", phone: "01077778888", notes: [{ id: "n1" }] });
  assert.equal(members[0].phone, "", "원래 배열은 건드리지 않는다");
});

test("다른 기기 회원이 이미 그 연락처를 쓰면 잇지 않는다 — 어느 기록이 붙을지 모른다", () => {
  const members = [{ id: "m1", phone: "" }, { id: "m2", phone: "01077778888" }];
  assert.equal(linkDeviceMember(members, "m1", { phone: "01077778888" }).outcome, LINK_OUTCOME.PHONE_TAKEN);
  assert.equal(linkDeviceMember(members, "nope", { phone: "01099990000" }).outcome, LINK_OUTCOME.MISSING);
});
