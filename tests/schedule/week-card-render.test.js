import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));

/* 주간 일정표를 실제로 렌더해서 카드가 유형 → 회원 → 기구 순으로 읽히는지 확인한다. */
test("weekly cards read type, member, then equipment", async (t) => {
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
  const busy = createAppScreenSmokeCases().find((item) => item.name === "일정 탭 · 하루 11건 혼합");
  assert.ok(busy, "혼합 일정 fixture 화면이 없습니다");
  const markup = renderToStaticMarkup(busy.element);

  await t.test("유형 5종이 약자로 함께 표시된다", () => {
    ["개인 수업", "듀엣 수업", "그룹 수업", "상담 수업", "휴무 수업"].forEach((label) => {
      assert.ok(markup.includes(`aria-label="${label}"`), `${label} 약자가 없습니다`);
    });
  });

  /* 카드에 실제로 찍힌 기구 줄만 본다 — 전체 목록은 title 툴팁에만 있다 */
  const equipRows = [...markup.matchAll(/class="pt-week-equip[^"]*">.*?<span class="min-w-0 flex-1 truncate"[^>]*>([^<]*)</g)].map((match) => match[1]);
  const equipLines = equipRows.filter((line) => line.trim());

  await t.test("기구 1개는 그대로, 2개는 가운뎃점, 3개 이상은 축약한다", () => {
    assert.ok(equipLines.includes("리포머"), "기구 1개 표시가 없습니다");
    assert.ok(equipLines.includes("리포머 · 체어"), "기구 2개 표시가 없습니다");
    assert.ok(equipLines.includes("캐딜락 외 2"), "기구 3개 축약 표시가 없습니다");
    assert.ok(equipLines.includes("리포머 외 3"), "기구 4개 축약 표시가 없습니다");
    equipLines.forEach((line) => {
      assert.ok(line.split(" · ").length <= 2, `기구 줄이 3개 이상 나열되었습니다: ${line}`);
    });
  });

  await t.test("기구 미선택 일정은 기구 글자 없이 유형 약자만 남는다", () => {
    assert.equal(equipLines.length, 8, "기구가 있는 일정 수와 기구 표시 수가 다릅니다");
    assert.equal(equipRows.length - equipLines.length, 3, "기구 미선택 일정 수가 다릅니다");
  });

  await t.test("회원명과 그룹 인원이 첫 줄에 남는다", () => {
    ["김은숙", "박서연", "이지훈", "정하늘"].forEach((name) => {
      assert.ok(markup.includes(name), `${name} 이름이 카드에서 사라졌습니다`);
    });
    assert.ok(markup.includes("그룹 8명"), "그룹 인원 표시가 없습니다");
    assert.ok(markup.includes("참석 10/12"), "완료된 그룹의 참석 표시가 없습니다");
  });

  await t.test("equipmentIds 가 없는 옛 일정도 기구가 보인다", () => {
    assert.ok(markup.includes("리포머"), "옛 equip 문자열이 표시되지 않습니다");
  });

  await t.test("기구 줄이 카드 높이를 늘리지 않는다", () => {
    /* 카드 높이는 시간 길이에서만 계산한다 — 기구 줄은 그 안에서 두 번째 줄로만 들어간다 */
    const heights = [...markup.matchAll(/pt-week-equip/g)];
    assert.ok(heights.length >= 6, "기구 줄이 렌더되지 않았습니다");
    assert.ok(!/pt-week-equip[^>]*height:/.test(markup), "기구 줄이 자체 높이를 갖고 있습니다");
  });
});
