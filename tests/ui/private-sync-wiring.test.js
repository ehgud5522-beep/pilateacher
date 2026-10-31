import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

/* 본인 일정 · 메모 동기화 (2026-10-31, 3단계) -- 앱 연결을 고정한다. 스위치가 꺼지면 웹 · 폰
   모두 서버에 아무것도 쓰지 않는다 (규칙 에뮬레이터는 tests/rules 의 3단계 묶음이 본다). */

const source = () => readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");

test("보내기 · 받기 모두 스위치(privateSync)가 켜진 계정만", async () => {
  const app = await source();
  assert.match(app, /if \(!fromServer && privateSyncOnRef\.current && prev\?\.schedule !== next\?\.schedule\)/, "회원(상담 메모 · 목표)이 바뀌어도 보내지 않는다");
  const publish = app.slice(app.indexOf("const publishPrivate = async"), app.indexOf("privatePublishRef.current = publishPrivate;"));
  assert.match(publish, /if \(!accountId \|\| !privateSyncOnRef\.current\) return;/, "보내는 함수도 한 번 더 막는다");
  assert.match(app, /if \(!privateSyncOn \|\| !accountId \|\| !roster\) return undefined;/, "받기도 켜진 계정만");
  assert.match(app, /const privateSyncOn = privateSyncAllowed\(\{ syncOn: scheduleSyncEnabledFor\(privateSyncConfig, account\?\.id\) \}\);/);
  assert.ok(app.includes("const [privateSyncConfig, setPrivateSyncConfig] = useState(undefined);"), "못 읽었으면 꺼짐(undefined)");
});

test("처음 받기 전 스냅샷 · 받은 뒤에 올리기 · 받는 기간 밖은 올리지 않기", async () => {
  const app = await source();
  const listener = app.slice(app.indexOf("subscribePrivateItems({"), app.indexOf("}, [privateSyncOn, account?.id, Boolean(roster), syncDay]);"));
  assert.ok(listener.indexOf("ensurePrivateSnapshot(accountId)") < listener.indexOf("mergePrivateItems("), "스냅샷이 먼저");
  assert.ok(listener.indexOf("mergePrivateItems(") < listener.indexOf("publishPrivate(null, null, { initialDocs })"), "받은 뒤에 올린다");
  assert.match(listener, /!serverIds\.has\(item\.itemId\) && !held\.has\(item\.itemId\)/, "서버에 있거나 중복 의심이면 올리지 않는다");
  assert.match(listener, /item\.data\.date >= from && item\.data\.date <= to/, "30일 전 ~ 60일 뒤만");
});

test("받아 합칠 때 회원 행을 넘기지 않는다 — 상담 메모 · 목표는 기기 값 그대로", async () => {
  const app = await source();
  const listener = app.slice(app.indexOf("subscribePrivateItems({"), app.indexOf("}, [privateSyncOn, account?.id, Boolean(roster), syncDay]);"));
  assert.match(listener, /mergePrivateItems\(\{\s+schedule: current\.schedule, docs, pendingIds:/);
  assert.match(listener, /saveDbRef\.current\?\.\(\{ \.\.\.current, schedule: merged\.schedule \}/);
  assert.doesNotMatch(listener, /members: merged\.members/);
});

test("화면 안내 — 메모 · 상담 메모 · 목표는 '이 기기에만', 개인 일정 이름은 '다른 기기에도'", async () => {
  const app = await source();
  assert.ok(app.includes('const DEVICE_ONLY_HINT = "이 기기에만 저장돼요";'));
  assert.ok(app.includes('const SHARED_TITLE_HINT = "다른 기기에도 보여요";'));
  assert.ok(app.includes('<Sheet title={sheet === "memo" ? "상담 메모 추가" : "수업 기록"} onClose={() => setSheet(null)}><div className="space-y-2"><DeviceOnlyNote />'), "상담 메모 · 수업 기록");
  assert.ok(app.includes('<Sheet title="상담 메모 전체 보기" onClose={() => setSheet(null)}><div className="space-y-2"><DeviceOnlyNote />'));
  assert.ok(app.includes('<Sheet title="목표·주의사항 수정" onClose={() => setSheet(null)}><div className="space-y-3"><DeviceOnlyNote />'), "목표 · 통증 및 주의사항");
  assert.ok(app.includes("그래프 목표선과 종합 평가에 사용됩니다 · {DEVICE_ONLY_HINT}"), "목표 체중 · 체지방");
  assert.ok(app.includes('<Field label="상담 메모" hint={DEVICE_ONLY_HINT}>'), "회원 등록의 상담 메모");
  assert.ok(app.includes('{(kind === "consult" || kind === "off") && <p data-shared-hint'), "개인 일정 고를 때");
});

test("대표 화면에 두 스위치가 따로 보인다", async (t) => {
  const vite = await createServer({
    root: fileURLToPath(new URL("../../", import.meta.url)), configFile: false, plugins: [react()], appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true }, ssr: { noExternal: ["@capgo/camera-preview"] }, logLevel: "silent",
  });
  t.after(() => vite.close());
  const { createAppScreenSmokeCases } = await vite.ssrLoadModule("/src/App.jsx");
  const screen = createAppScreenSmokeCases().find((item) => item.name === "더보기 탭 · 앱 업데이트 안내");
  const markup = renderToStaticMarkup(screen.element);
  assert.ok(markup.includes("일정 동기화 (서버가 기준)"));
  assert.ok(markup.includes("본인 일정 동기화"));
  assert.ok(markup.includes("메모 · 상담 메모 · 회원 목표는 입력한 기기에만 남습니다"));
  assert.ok(markup.includes("대표 · FC · 다른 강사는 볼 수 없습니다"));
  assert.ok(markup.includes('data-schedule-sync-admin="privateSync"'));
});
