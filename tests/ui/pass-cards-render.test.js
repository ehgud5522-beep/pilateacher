import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));

/**
 * 회원권 네 장짜리 회원의 상세를 **실제로 렌더한다.**
 *
 * 배포 563 이 여기서 죽었다. 카드가 만료일로 Date 를 화면에 넘겼는데 ymd() 는
 * 문자열을 받아 slice 하므로 TypeError 가 났고, 회원 상세가 통째로 에러 화면이
 * 됐다. 만료일이 있는 회원권을 가진 **소속 회원 전원**이 그랬다.
 *
 * 순수 함수 테스트는 15개가 전부 통과했다. 렌더 테스트도 있었지만 "회원 상세 ·
 * 소속" 케이스가 passCards 를 넘기지 않아 레거시 분기만 그렸다 -- 새 코드가 한
 * 줄도 돌지 않는 테스트였다. 그래서 이 파일은 **카드를 실제로 그리는 케이스**를
 * 붙잡는다.
 */
test("회원권 네 장짜리 상세가 렌더된다 -- 한 장도 터지지 않고", async (t) => {
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
  const screen = createAppScreenSmokeCases().find((item) => item.name === "회원 상세 · 회원권 네 장");
  assert.ok(screen, "회원권 네 장 fixture 화면이 없습니다");

  /* 던지면 여기서 끝난다. 이 한 줄이 563 을 잡는다. */
  const markup = renderToStaticMarkup(screen.element);

  /* 에러 경계가 대신 그린 자리가 없어야 한다. 한 장만 실패해도 나머지는
     보이므로, 문구를 보지 않으면 "렌더는 됐다" 로 지나간다. */
  assert.equal(markup.includes("표시하지 못했습니다"), false, "카드가 에러 경계로 떨어졌다");
  assert.equal(markup.includes("일시적인 문제"), false);

  // 네 장이 각각 섰다. 합계가 아니라 장별이다.
  for (const name of ["1:1 PT 50회", "1:1 PT 100회", "2:1 PT 33-&gt;100 세션업", "2:1 PT 70회"]) {
    assert.ok(markup.includes(name), `카드가 없다: ${name}`);
  }

  // 만료일이 날짜로 읽힌다 -- Date 를 그대로 넘기면 여기가 비거나 터진다.
  assert.ok(markup.includes("2026. 11. 09"), "만료일이 그려지지 않았다");
  assert.ok(markup.includes("2027. 12. 31"));

  // 다음 차감은 lesson-settlement 가 고른 것을 그대로 가리킨다.
  assert.ok(markup.includes("1:1 수업 시 차감"));
  assert.ok(markup.includes("2:1 수업 시 차감"));

  // 2:1 은 짝의 이름을 단다. 두 사람 화면에 같은 카드가 선다.
  assert.ok(markup.includes("박서연님과 함께"));

  // 합계는 사라졌다. 이 줄이 돌아오면 563 이전 화면이다.
  assert.equal(markup.includes("누적 등록 횟수"), false, "합산 칸이 남아 있다");

  /* 요약은 종류별로만. 1:1 과 2:1 은 다른 수업에서 쓰이므로 더해도 쓸 데가 없다. */
  assert.ok(markup.includes("사용 중 4장"), "요약 줄이 종류별이 아니다");
});

test("칸이 빈 이관 회원권도 카드를 그린다", async (t) => {
  /* csv_ 이관분은 상품명도 만료일도 급여카테고리도 없을 수 있다. 없는 칸을
     읽다 터지면 그 회원의 상세가 통째로 닫힌다. */
  const vite = await createServer({
    root: projectRoot, configFile: false, plugins: [react()], appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true },
    ssr: { noExternal: ["@capgo/camera-preview"] }, logLevel: "silent",
  });
  t.after(() => vite.close());

  const { createAppScreenSmokeCases } = await vite.ssrLoadModule("/src/App.jsx");
  const screen = createAppScreenSmokeCases().find((item) => item.name === "회원 상세 · 회원권 네 장");
  const markup = renderToStaticMarkup(screen.element);

  /* 칸이 전부 비어도 부를 이름이 있다. passTitle 이 종류와 횟수로 만들고,
     그마저 없으면 "회원권" 이다 -- **id 는 어느 경우에도 제목이 되지 않는다.** */
  assert.ok(markup.includes("회원권"), "빈 이관 회원권이 그려지지 않았다");
  assert.equal(markup.includes("smoke-csv-bare"), false, "식별자가 화면에 샜다");
  assert.ok(markup.includes("미설정"), "만료일 없는 카드가 그려지지 않았다");
  // 잔여 0 이라 종료 묶음으로 접힌다.
  assert.ok(markup.includes("종료된 회원권"), "끝난 회원권이 접히지 않았다");
  assert.ok(markup.includes("모두 사용"));
});
