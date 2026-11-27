/**
 * 수업 관리 시트 개편 (2026-11-17) -- [수업 확정] 을 **실제로 누른다.**
 *
 * 출석은 기본값, 노쇼는 기본 1회 차감. 누르면 아직 안 고른 것을 그 값으로 한 명씩 적고, 저장이 끝난 뒤에
 * 확정한다. 저장과 확정의 순서가 뒤집히면 확정이 옛 일정을 읽고(settleLesson 은 저장된 일정을 본다) 한 명을
 * "예약" 으로 남긴 채 확정한다 -- 그래서 손으로 상태를 들고 있는 하네스로 걸음을 하나씩 확인한다.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { act, cloneElement, createElement, useState } from "react";
import { JSDOM } from "jsdom";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
let shared = null;
const appModule = async () => {
  if (!shared) {
    const vite = await createServer({
      root: projectRoot, configFile: false, plugins: [react()], appType: "custom",
      optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true },
      ssr: { noExternal: ["@capgo/camera-preview"] }, logLevel: "silent",
    });
    shared = { vite, module: await vite.ssrLoadModule("/src/App.jsx") };
  }
  return shared.module;
};
test.after(async () => { if (shared) await shared.vite.close(); });

/** 픽스처의 ScheduleForm 을 상태를 가진 하네스로 감싸 그린다. calls 에 부른 순서가 남는다. */
async function mount(caseName, override = (lesson) => lesson) {
  const { createAppScreenSmokeCases } = await appModule();
  const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost", pretendToBeVisual: true });
  dom.window.HTMLElement.prototype.scrollTo = () => {};
  const globals = {
    window: dom.window, document: dom.window.document,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = Object.fromEntries(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.assign(globalThis, globals);
  const { element } = createAppScreenSmokeCases().find(({ name }) => name === caseName);
  const organization = element.props.children;
  const form = organization.props.children;
  const calls = [];
  const patch = (lesson, memberId, change) => ({ ...lesson, attendees: lesson.attendees.map((a) => (a.memberId === memberId ? { ...a, ...change } : a)) });
  function Harness() {
    const [draft, setDraft] = useState(() => override(form.props.draft));
    return cloneElement(element, {}, cloneElement(organization, {}, cloneElement(form, {
      draft,
      onStatus: (id, status, memberId, options) => { calls.push(["status", memberId, status, options]); setDraft((d) => patch(d, memberId, { status })); },
      onStatusAll: (id, status) => { calls.push(["all", status]); setDraft((d) => ({ ...d, attendees: d.attendees.map((a) => ({ ...a, status })) })); },
      onNoshowFee: (id, charge, memberId) => { calls.push(["fee", memberId, charge]); setDraft((d) => patch(d, memberId, { noshowFee: charge })); },
      onSettleLesson: async (id) => { calls.push(["settle", id]); },
    })));
  }
  const { createRoot } = await import("react-dom/client");
  const container = dom.window.document.getElementById("root");
  const root = createRoot(container);
  await act(async () => root.render(createElement(Harness)));
  const confirm = () => container.querySelector("[data-lesson-confirm]");
  const press = async (node) => { await act(async () => { node.click(); }); await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  const cleanup = async () => {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  };
  return { container, calls, confirm, press, cleanup };
}

test("수업 전 → [수업 끝 · 처리하기] 는 수업 후로 넘어가기만 한다 (아무것도 저장하지 않는다)", async () => {
  const view = await mount("일정 탭 · 소속 · 예상 단가", (lesson) => ({ ...lesson, attendees: lesson.attendees.map((a) => ({ ...a, status: "booked" })) }));
  try {
    assert.equal(view.container.querySelector("[data-lesson-stage]").dataset.lessonStage, "pre");
    assert.match(view.confirm().textContent, /수업 끝 · 처리하기/);
    await view.press(view.confirm());
    assert.equal(view.container.querySelector("[data-lesson-stage]").dataset.lessonStage, "post");
    assert.deepEqual(view.calls, []);
    assert.match(view.container.textContent, /출석으로 처리됩니다/);
  } finally { await view.cleanup(); }
});

test("[수업 확정]: 안 고른 사람을 한 명씩 출석으로 적고, 다 적힌 뒤에 확정한다", async () => {
  const view = await mount("일정 탭 · 소속 · 예상 단가", (lesson) => ({ ...lesson, attendees: lesson.attendees.map((a) => ({ ...a, status: "booked" })) }));
  try {
    await view.press(view.confirm()); // 수업 전 → 수업 후
    assert.match(view.confirm().textContent, /수업 확정 · 2명 차감/);
    await view.press(view.confirm());
    for (let i = 0; i < 5 && !view.calls.some(([kind]) => kind === "settle"); i += 1) {
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    }
    const kinds = view.calls.map(([kind, , status, options]) => (kind === "status" ? `status:${status}:${options?.single}` : kind));
    assert.deepEqual(kinds, ["status:done:true", "status:done:true", "settle"], JSON.stringify(view.calls));
  } finally { await view.cleanup(); }
});

test("[노쇼 처리]: 차감을 고르지 않았으면 1회 차감으로 적은 뒤 확정한다", async () => {
  const view = await mount("일정 탭 · 소속 · 1:1 노쇼", (lesson) => ({ ...lesson, attendees: lesson.attendees.map((a) => { const { noshowFee, ...rest } = a; return rest; }) }));
  try {
    assert.match(view.confirm().textContent, /노쇼 처리 · 1회 차감/);
    await view.press(view.confirm());
    for (let i = 0; i < 5 && !view.calls.some(([kind]) => kind === "settle"); i += 1) {
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    }
    assert.deepEqual(view.calls.map(([kind, , value]) => `${kind}:${value ?? ""}`).filter((v) => !v.startsWith("settle")), ["fee:true"]);
    assert.equal(view.calls.at(-1)[0], "settle");
  } finally { await view.cleanup(); }
});

test("출석 · 노쇼 · 취소 버튼은 누르지 않아도 보인다 -- [상태 변경] 을 찾지 못했다 (2026-11-28 반송 최형인 점장)", async () => {
  const view = await mount("일정 탭 · 소속 · 1:1 노쇼", (lesson) => lesson);
  try {
    for (const key of ["done", "noshow", "cancel"]) {
      const button = view.container.querySelector(`[data-attendance-choice="${key}"]`);
      assert.ok(button, key);
      assert.equal(button.closest("[inert]"), null, `${key} 버튼이 접힌 칸(inert) 안에 있으면 보이지 않는다`);
    }
    const toggle = [...view.container.querySelectorAll("button")].find((b) => ["상태 변경", "접기"].includes(b.textContent.trim()));
    assert.equal(toggle, undefined, "펼치는 작은 글자 버튼은 없다");
  } finally { await view.cleanup(); }
});

test("노쇼 → 차감 안 함: 하단 버튼이 그대로 따라 말한다 (출석 · 노쇼 · 취소는 늘 펼쳐 있다)", async () => {
  const view = await mount("일정 탭 · 소속 · 1:1 노쇼", (lesson) => ({ ...lesson, attendees: lesson.attendees.map((a) => { const { noshowFee, ...rest } = a; return rest; }) }));
  try {
    const waive = [...view.container.querySelectorAll("button")].find((b) => b.textContent.trim() === "차감 안 함");
    await view.press(waive);
    assert.match(view.confirm().textContent, /노쇼 처리 · 차감 없음/);
    assert.match(view.container.querySelector("[data-lesson-confirm-hint]").textContent, /유지/);
    const cancel = view.container.querySelector('[data-attendance-choice="cancel"]');
    await view.press(cancel);
    assert.match(view.confirm().textContent, /취소 처리 · 차감 없음/);
    assert.equal(view.container.querySelector("[data-attendance-badge]").dataset.attendanceBadge, "cancel");
  } finally { await view.cleanup(); }
});
