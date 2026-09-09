import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

import { lessonTypeDef } from "../../src/features/schedule/lesson-types.js";

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

  /* 카드에서 유형 글자를 뺐다. 40px 남짓한 폭을 이름에 내주기 위해서인데,
     색만 남기면 색으로만 구분하는 화면이 되므로 도형이 그 자리를 대신한다.
     읽어 주는 쪽에는 도형이 소용없으므로 버튼 이름에 유형을 말로 남긴다. */
  await t.test("유형 5종이 도형으로 구분된다", () => {
    for (const key of ["private", "duet", "group", "consult", "off"]) {
      const shape = lessonTypeDef(key).shape;
      assert.ok(shape, `${key} 에 도형이 없습니다`);
      assert.ok(markup.includes(`>${shape}</span>`), `${key} 도형이 카드에 없습니다`);
    }
    const shapes = ["private", "duet", "group", "consult", "off"].map((key) => lessonTypeDef(key).shape);
    assert.equal(new Set(shapes).size, shapes.length, "도형이 겹치면 구분이 되지 않습니다");
  });

  await t.test("유형 글자는 화면에서 빠지고 읽어 주는 이름에만 남는다", () => {
    for (const label of ["개인", "듀엣", "그룹", "상담", "휴무"]) {
      assert.ok(markup.includes(`aria-label="${label} ·`) || markup.includes(`aria-label="${label}"`),
        `${label} 이 버튼 이름에 없습니다 -- 화면에서 뺐으므로 여기가 유일한 경로입니다`);
    }
    const typeCells = [...markup.matchAll(/class="pt-week-type[^"]*"[^>]*>([^<]*)</g)].map((match) => match[1]);
    assert.ok(typeCells.length > 0, "유형 자리가 사라졌습니다");
    for (const cell of typeCells) {
      assert.equal(/[가-힣]/.test(cell), false, `카드에 유형 글자가 남아 있습니다: ${cell}`);
    }
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

  await t.test("기구가 없으면 두 번째 줄 자체가 없다", () => {
    /* 예전에는 기구가 없어도 유형 약자를 담으려고 빈 줄이 섰다. 약자가
       빠진 지금 그 줄에 적을 것이 없으므로 줄을 만들지 않는다 -- 카드가
       한 줄이 되고, 그만큼 격자가 낮아진다. */
    assert.equal(equipLines.length, 8, "기구가 있는 일정 수와 기구 표시 수가 다릅니다");
    assert.equal(equipRows.length, equipLines.length, "적을 것이 없는데 줄이 서 있습니다");
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
