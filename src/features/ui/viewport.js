/**
 * 화면이 좁은가. **폰과 PC 가 같은 화면을 쓰는 자리를 가르는 데 쓴다.**
 *
 * 이 앱은 폰(Capacitor)과 PC 웹에서 같은 코드를 쓴다. 대부분은 그대로 되지만,
 * 표처럼 가로 폭을 전제하는 화면은 폰에서 읽을 수 없게 된다 -- 상품 표는
 * 열이 다섯이면 폰에서 가로 스크롤 없이는 한 칸도 못 본다.
 *
 * ── SSR 에서 터지지 않는다 ──
 * 스모크 테스트가 이 화면들을 서버에서 그린다. `window` 가 없으면 **넓은
 * 쪽**으로 답한다 -- 좁은 쪽을 기본으로 두면 PC 에서 첫 그림이 목록으로
 * 떴다가 표로 바뀌고, 그 깜빡임은 고장처럼 보인다.
 *
 * ── matchMedia 가 없으면 ──
 * 옛 WebView 에는 addEventListener 가 없는 MediaQueryList 가 있다. 그때는
 * 한 번 읽고 그대로 둔다 -- 회전에 따라오지 못할 뿐, 화면은 선다.
 */

import { useEffect, useState } from "react";

/** 표를 목록으로 바꾸는 경계. 폰 가로(≈390~430px)와 작은 태블릿을 가른다. */
export const NARROW_MAX_WIDTH = 600;

/** 지금 이 폭이 좁은가. window 가 없으면 false -- 넓은 쪽이 기본이다. */
export function isNarrowWidth(width) {
  const value = Number(width);
  return Number.isFinite(value) && value > 0 && value < NARROW_MAX_WIDTH;
}

const query = `(max-width: ${NARROW_MAX_WIDTH - 1}px)`;

function readNarrow() {
  if (typeof window === "undefined") return false;
  try {
    if (window.matchMedia) return window.matchMedia(query).matches === true;
  } catch { /* 옛 WebView. 아래 innerWidth 로 떨어진다. */ }
  return isNarrowWidth(window.innerWidth);
}

/**
 * 폭이 좁아지면 다시 그린다.
 *
 * @param {boolean} [initial] 테스트가 폭을 못 박을 때 쓴다 -- SSR 에서는
 *   window 가 없어 언제나 넓은 쪽이 되므로, 좁은 화면을 그려 보려면 값을
 *   넣어 주는 길이 있어야 한다.
 */
export function useNarrowViewport(initial = undefined) {
  const [narrow, setNarrow] = useState(
    () => (typeof initial === "boolean" ? initial : readNarrow()),
  );

  useEffect(() => {
    // 못 박은 값은 따라 움직이지 않는다. 테스트가 그린 화면이 그대로 서야 한다.
    if (typeof initial === "boolean") return undefined;
    if (typeof window === "undefined") return undefined;
    let media = null;
    try { media = window.matchMedia ? window.matchMedia(query) : null; } catch { media = null; }
    const apply = () => setNarrow(readNarrow());
    apply();
    if (!media) {
      window.addEventListener("resize", apply);
      return () => window.removeEventListener("resize", apply);
    }
    /* 옛 WebView 의 MediaQueryList 에는 addEventListener 가 없다. 거기서는
       한 번 읽은 값으로 둔다 -- 회전에 따라오지 못할 뿐 화면은 선다. */
    if (typeof media.addEventListener !== "function") return undefined;
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [initial]);

  return narrow;
}
