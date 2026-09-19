/**
 * App 자체를 한 번 렌더한다.
 *
 * ── 왜 화면 스모크로는 잡히지 않았나 ──
 * screen-render-smoke 는 createAppScreenSmokeCases() 가 만든 *컴포넌트*를 손으로
 * 만든 props 와 함께 그린다. ScheduleManager, ReferenceMemberList, PayrollSummary
 * … 116개가 전부 통과했지만 App 함수의 본문은 한 번도 실행되지 않았다.
 *
 * 선언 순서와 훅 순서는 그 본문에 있다. useMemo 의 의존성 배열은 선언 시점에 바로
 * 평가되므로, [db.members] 한 줄이 db 선언보다 앞서면 App 이 통째로 렌더되지
 * 못하고 화면이 하얗게 남는다. 화면 스모크는 그 App 을 부르지 않으니 116개가 모두
 * 초록불인 채로 앱이 아예 뜨지 않았다.
 *
 * ── 왜 SSR 로 충분한가 ──
 * renderToStaticMarkup 은 함수 본문을 실행하고 useEffect 는 실행하지 않는다.
 * 잡고 싶은 것이 정확히 본문에서 터지는 실패다 -- TDZ, 훅 순서, 렌더 중에 읽는
 * 없는 값. 효과 안의 네트워크와 저장소는 건드리지 않으므로 이 테스트는 기기도
 * 에뮬레이터도 필요 없다.
 *
 * 이 파일이 초록불이면 "앱이 뜬다"까지는 보장된다. 그 뒤의 동작은 여전히 화면
 * 스모크와 단위 테스트의 몫이다.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));

test("the app shell renders, so a white screen cannot ship green", async (t) => {
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

  const module = await vite.ssrLoadModule("/src/App.jsx");
  const App = module.default;
  assert.equal(typeof App, "function", "App 의 default export 가 사라졌다");

  let markup = "";
  /* 여기서 터지는 것이 실제로 브라우저에서 보는 하얀 화면이다. 오류를 그대로
     올려 보낸다 -- 코드와 줄이 보이지 않으면 고칠 수 없다. */
  markup = renderToStaticMarkup(React.createElement(App));

  assert.ok(markup.length > 0, "App 이 빈 마크업을 돌려줬다");
  /* 껍데기 한 겹만 확인한다. 안의 내용은 로그인 여부와 저장 데이터에 따라 달라지고,
     그것을 여기서 고정하면 화면을 고칠 때마다 이 파일이 깨진다. */
  assert.match(markup, /class="app-root"/, "앱 루트가 그려지지 않았다");
});
