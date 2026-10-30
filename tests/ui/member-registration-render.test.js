import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));

/**
 * 센터 계정의 회원 등록 (2026-10-31).
 *
 * 회원 탭의 "회원 등록" 이 서버가 아니라 기기에만 회원을 만들었고, 명부가 그런 회원을
 * 빼서 앱을 껐다 켜도 보이지 않았다. 더보기 → 센터 회원 관리에서 등록하면 서버에는
 * 들어가지만 회원 탭 명부는 앱을 열 때만 읽어 "껐다 켜면 보이는" 증상이었다.
 */
test("회원 탭 — 센터 계정에는 등록 버튼 대신 안내 · 미등록 회원 수, 개인 계정은 그대로", async (t) => {
  const vite = await createServer({
    root: projectRoot,
    configFile: false,
    plugins: [react()],
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true },
    ssr: { noExternal: ["@capgo/camera-preview"] },
    logLevel: "silent",
  });
  t.after(() => vite.close());
  const { createAppScreenSmokeCases } = await vite.ssrLoadModule("/src/App.jsx");
  const render = (name) => {
    const screen = createAppScreenSmokeCases().find((item) => item.name === name);
    assert.ok(screen, `화면이 없습니다: ${name}`);
    return renderToStaticMarkup(screen.element);
  };

  const centre = render("회원 목록 · 대표");
  assert.equal(centre.includes("추가</button>"), false, "센터 계정 회원 탭에는 등록 버튼이 없다");
  assert.ok(centre.includes("회원 등록은 더보기 → 센터 회원 관리에서 해요"));
  assert.ok(centre.includes("바로 가기"));
  assert.ok(centre.includes("센터에 등록되지 않은 회원 1명"));

  const personal = render("회원 목록");
  assert.ok(personal.includes("추가</button>"), "센터에 소속되지 않은 계정(심사 · 테스트)은 그대로 등록한다");
  assert.equal(personal.includes("센터 회원 관리에서 해요"), false);

  const sheet = render("센터에 등록되지 않은 회원");
  assert.ok(sheet.includes("센터 명부에 올리기"));
  assert.ok(sheet.includes("기존 회원과 잇기"));
  assert.ok(sheet.includes("연락처가 없어 올릴 수 없어요"), "연락처 없는 회원은 무엇이 없는지 말한다");
  assert.equal(/삭제|지우기/.test(sheet), false, "지우는 버튼이 없다");

  const instructorSheet = render("센터에 등록되지 않은 회원 · 강사");
  assert.equal(instructorSheet.includes("센터 명부에 올리기"), false, "강사는 올리지 못한다 (규칙)");
  assert.ok(instructorSheet.includes("대표 · 매니저가 해요"));

  const existing = render("회원 관리 · 이미 있는 회원");
  assert.ok(existing.includes("이미 등록된 회원입니다"));
  assert.ok(existing.includes("새로 만들지 않았어요"));
  assert.ok(existing.includes("기존 회원 보기"));
});

test("센터 회원 관리에서 등록하면 회원 탭 · 수업 등록 회원 선택이 쓰는 명부를 다시 읽는다", async () => {
  const source = await readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
  const directory = source.slice(source.indexOf("function ClientDirectory("), source.indexOf("const submit = async (event) =>", source.indexOf("function ClientDirectory(")));
  assert.match(directory, /checkServer: true/, "등록 직전에 서버에도 묻는다");
  assert.ok(directory.indexOf("onChanged?.()") > directory.indexOf("await createClient("), "등록이 끝난 뒤 알린다");
  // 더보기 → ClientDirectory 의 onChanged 는 앱의 명부 다시 읽기다.
  assert.match(source, /onChanged=\{onRosterChanged\}/);
  assert.match(source, /onRosterChanged=\{\(\) => setRosterRevision\(\(value\) => value \+ 1\)\}/);
  // 회원 탭과 수업 등록의 회원 선택은 같은 명부(rosterDb)를 그린다.
  assert.match(source, /<ReferenceMemberList[^>]*members=\{rosterMembers\}/);
  assert.match(source, /<ScheduleManager db=\{rosterDb\}/);
  // 센터 계정에서는 회원 탭에서 등록하지 않는다.
  assert.match(source, /canRegister=\{canRegisterInMemberTab\}/);
  assert.match(source, /const canRegisterInMemberTab = canRegisterMembers && !centreAccount;/);
});
