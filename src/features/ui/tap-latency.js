/**
 * 누름 반응 시간 재기 (2026-11-21 대표: "눌렀을 때 뭔가 반응이 0.5초 느림").
 *
 * 견본 화면에서는 메뉴를 누르고 화면이 바뀌기까지 0.01~0.02초였다 -- 화면 코드 자체는 빠르다. 그래서 실제 기기 ·
 * 실제 데이터에서 어디가 늦는지를 숫자로 남긴다. 두 구간을 따로 잰다 (CLAUDE.md 1 -- 하나로 뭉개지 않는다):
 *   tapDelayMs  손을 뗀 뒤(pointerup) 누름(click)이 오기까지 -- 폰 웹뷰의 두 번 누르기 확대 대기 같은 것
 *   renderMs    누름(click) 뒤 다음 화면이 그려지기까지 -- 계산 · 그리기가 무거운 것
 * 느린 것(합이 기준 이상)만 남기고, 한 번 켠 앱에서 최대 20건 · 10초에 한 건.
 *
 * 개인정보: 누른 것의 글자(회원 이름일 수 있다)는 남기지 않는다. 화면이 붙여 둔 data-* 열쇠(메뉴 항목 key 등)만.
 */

export const TAP_SLOW_MS = 200;
export const TAP_REPORT_MAX = 20;
export const TAP_REPORT_GAP_MS = 10000;

/* 남겨도 되는 열쇠. 회원 id · 이름이 들어가는 속성은 넣지 않는다. */
const SAFE_KEYS = ["data-wide-nav-item", "data-wide-hub-card", "data-stage-tab", "data-branch-tab", "data-tab", "data-nav"];

/** 누른 것의 이름표. 글자는 쓰지 않는다. */
export function tapTargetKey(target) {
  const element = target && typeof target.closest === "function" ? target.closest("button, a, [role='tab'], [role='button']") : null;
  if (!element) return "other";
  for (const key of SAFE_KEYS) {
    const value = element.getAttribute(key);
    if (value) return `${key.replace(/^data-/, "")}:${String(value).slice(0, 40)}`;
  }
  return String(element.tagName || "other").toLowerCase();
}

/** 이번 것을 남길까. state = { count, lastAt } */
export function shouldReportTap({ tapDelayMs, renderMs }, state, now) {
  const total = (Number(tapDelayMs) || 0) + (Number(renderMs) || 0);
  if (total < TAP_SLOW_MS) return false;
  if (state.count >= TAP_REPORT_MAX) return false;
  if (state.lastAt && now - state.lastAt < TAP_REPORT_GAP_MS) return false;
  return true;
}

/**
 * 앱 전체에 한 번 건다. report({ target, tapDelayMs, renderMs }) 는 느린 것만 받는다. 떼는 함수를 돌려준다.
 * @param {{ report: (fields: any) => void, win?: any }} options
 */
export function installTapLatencyProbe({ report, win = typeof window !== "undefined" ? window : null }) {
  if (!win || typeof win.addEventListener !== "function" || typeof win.requestAnimationFrame !== "function") return () => {};
  const clock = () => (win.performance && typeof win.performance.now === "function" ? win.performance.now() : Date.now());
  const state = { count: 0, lastAt: 0 };
  let lastUp = 0;
  const onUp = () => { lastUp = clock(); };
  const onClick = (event) => {
    const clickAt = clock();
    const tapDelayMs = lastUp && clickAt - lastUp < 1000 ? Math.round(clickAt - lastUp) : 0;
    const target = tapTargetKey(event.target);
    /* 두 번의 프레임 뒤 = 이 누름으로 바뀐 화면이 실제로 그려진 뒤. */
    win.requestAnimationFrame(() => win.requestAnimationFrame(() => {
      const renderMs = Math.round(clock() - clickAt);
      const fields = { target, tapDelayMs, renderMs };
      const now = clock();
      if (!shouldReportTap(fields, state, now)) return;
      state.count += 1;
      state.lastAt = now;
      try { report(fields); } catch (_ignored) { /* 재기가 앱을 깨뜨리면 안 된다. */ }
    }));
  };
  win.addEventListener("pointerup", onUp, true);
  win.addEventListener("click", onClick, true);
  return () => {
    win.removeEventListener("pointerup", onUp, true);
    win.removeEventListener("click", onClick, true);
  };
}
