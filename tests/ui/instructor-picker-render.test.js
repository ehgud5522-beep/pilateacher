/**
 * 담당 강사 고르기를 **실제로 그린다** -- 역할별(대표 · 총괄매니저 · FC매니저 ·
 * 강사)로 처음 눌린 지점 칩과 보이는 강사가 맞는지, 담당 변경 시트가 맡은 지점
 * 밖의 강사를 저장 단계에서 막는지.
 *
 * 렌더는 useEffect 를 돌리지 않는다 -- 처음 그려지는 모습이 곧 기본값이다.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
let vite = null;
const load = async (path) => {
  vite ||= await createServer({
    root: projectRoot, configFile: false, plugins: [react()], appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true }, logLevel: "silent",
  });
  return vite.ssrLoadModule(path);
};
test.after(async () => { if (vite) await vite.close(); });

const LOCATIONS = [{ id: "bansong", name: "반송점" }, { id: "centum", name: "센텀점" }];
const INSTRUCTORS = [
  { userId: "u-a", displayName: "김하나", locationId: "bansong", status: "active" },
  { userId: "u-b", displayName: "이두리", locationId: "centum", status: "active" },
  { userId: "u-old", displayName: "전강사", locationId: "centum", status: "active" },
];
const pressedLocation = (html) => html.match(/data-location-chip="([^"]+)" aria-pressed="true"/)?.[1];
const shownInstructors = (html) => [...html.matchAll(/data-instructor-chip="([^"]+)"/g)].map((m) => m[1]);

test("발급 화면 강사 고르기 — 역할별 기본 지점과 보이는 강사", async () => {
  const { default: InstructorPicker } = await load("/src/features/membership/InstructorPicker.jsx");
  const render = (viewer) => renderToStaticMarkup(createElement(InstructorPicker, {
    instructors: INSTRUCTORS, locations: LOCATIONS, viewer, value: "",
  }));
  for (const viewer of [{ role: "owner" }, { role: "area_manager", locationId: "bansong" }]) {
    const html = render(viewer);
    assert.equal(pressedLocation(html), "all", viewer.role);
    assert.deepEqual(shownInstructors(html), ["u-a", "u-b", "u-old"], viewer.role);
  }
  for (const viewer of [
    { role: "manager", locationId: "bansong", locationIds: ["bansong"] },
    { role: "instructor", locationId: "bansong" },
  ]) {
    const html = render(viewer);
    assert.equal(pressedLocation(html), "bansong", viewer.role);
    assert.deepEqual(shownInstructors(html), ["u-a"], viewer.role);
  }
  const html = render({ role: "owner" });
  assert.match(html, /김하나<\/span><span[^>]*>· 반송점/, "칩에 소속 지점");
  assert.match(html, /placeholder="강사 이름 검색"/);
});

test("고른 강사는 칩과 검색에 걸러져도 맨 앞에 남는다", async () => {
  const { default: InstructorPicker } = await load("/src/features/membership/InstructorPicker.jsx");
  const html = renderToStaticMarkup(createElement(InstructorPicker, {
    instructors: INSTRUCTORS, locations: LOCATIONS, viewer: { role: "owner" },
    value: "u-b", initialLocationId: "bansong",
  }));
  assert.deepEqual(shownInstructors(html), ["u-b", "u-a"]);
  assert.match(html, /data-instructor-chip="u-b" aria-pressed="true"/);
});

test("검색 결과가 없으면 그렇게 말한다", async () => {
  const { default: InstructorPicker } = await load("/src/features/membership/InstructorPicker.jsx");
  const html = renderToStaticMarkup(createElement(InstructorPicker, {
    instructors: INSTRUCTORS, locations: LOCATIONS, viewer: { role: "owner" }, initialQuery: "없는이름",
  }));
  assert.deepEqual(shownInstructors(html), []);
  assert.match(html, /이름이 맞는 강사가 없습니다/);
});

const NOW = new Date(2026, 10, 4, 12, 0);
const PASS = {
  id: "p1", clientId: "c1", instructorId: "u-old", status: "active", category: "pt_1_1_new",
  baseUnitPrice: 25000, remainingCount: 8, locationId: "centum", expiresAt: new Date(2027, 0, 1),
};
const handover = (HandoverSheet, viewer, extra = {}) => renderToStaticMarkup(createElement(HandoverSheet, {
  passes: [PASS], instructors: [...INSTRUCTORS, { userId: "u-c", displayName: "센텀둘", locationId: "centum", status: "active" }],
  fromInstructorId: "u-old", fromName: "전강사", clientNameOf: () => "회원", sessionsOf: () => 0,
  initialAssignments: { p1: "u-c" }, now: NOW, viewer, locations: LOCATIONS, ...extra,
}));
const runButton = (html) => html.match(/<button[^>]*>(?:<[^>]*>)*\d+장 넘기기/)?.[0] || "";

test("담당 변경 — FC매니저가 맡은 지점 밖 강사를 고르면 막히고 버튼이 꺼진다", async () => {
  const { default: HandoverSheet } = await load("/src/features/members/HandoverSheet.jsx");
  const fc = handover(HandoverSheet, { role: "manager", locationId: "bansong", locationIds: ["bansong"] });
  assert.match(fc, /data-out-of-scope/);
  assert.match(fc, /코드 instructor_out_of_scope/);
  assert.match(runButton(fc), /disabled=""/);

  for (const viewer of [{ role: "owner" }, { role: "area_manager" }]) {
    const html = handover(HandoverSheet, viewer);
    assert.doesNotMatch(html, /data-out-of-scope/, viewer.role);
    assert.doesNotMatch(runButton(html), /disabled=""/, viewer.role);
  }
  assert.match(handover(HandoverSheet, { role: "owner" }), /센텀둘 · 센텀점/, "칩에 소속 지점");
});

test("담당 변경 — viewer 를 안 넘기면 전과 같다 (검색 · 지점 표시 없음)", async () => {
  const { default: HandoverSheet } = await load("/src/features/members/HandoverSheet.jsx");
  const html = handover(HandoverSheet, null, { locations: [] });
  assert.doesNotMatch(html, /data-picker-search/);
  assert.doesNotMatch(html, /data-out-of-scope/);
  assert.doesNotMatch(html, / · 센텀점/);
});
