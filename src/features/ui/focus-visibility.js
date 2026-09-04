const FOCUSABLE_SELECTOR = 'input, textarea, select, [contenteditable="true"]';
const EXCLUDED_INPUT_TYPES = new Set(["range", "file", "checkbox"]);

export function visibleViewportBounds(viewport, fallbackHeight) {
  const top = Number(viewport?.offsetTop) || 0;
  const height = Number(viewport?.height) || Number(fallbackHeight) || 0;
  return { top, bottom: top + height };
}

export function isOutsideVisibleViewport(rect, bounds, margin = 16) {
  if (!rect || !bounds) return false;
  return rect.top < bounds.top + margin || rect.bottom > bounds.bottom - margin;
}

export function installFocusVisibilityGuard({ documentRef, windowRef, delay = 320 }) {
  const doc = documentRef;
  const win = windowRef;
  if (!doc?.addEventListener || !win) return () => {};

  const viewport = win.visualViewport;
  let focusTimer = null;

  const updateKeyboardInset = () => {
    const bounds = visibleViewportBounds(viewport, win.innerHeight);
    const inset = viewport ? Math.max(0, Number(win.innerHeight || 0) - bounds.bottom) : 0;
    doc.documentElement?.style?.setProperty("--pt-keyboard-inset", `${inset}px`);
  };

  const onFocusIn = (event) => {
    const element = event.target;
    if (!element?.matches?.(FOCUSABLE_SELECTOR)) return;
    if (element.tagName === "INPUT" && EXCLUDED_INPUT_TYPES.has(String(element.type || "").toLowerCase())) return;
    if (focusTimer) win.clearTimeout(focusTimer);
    focusTimer = win.setTimeout(() => {
      const bounds = visibleViewportBounds(viewport, win.innerHeight);
      if (!isOutsideVisibleViewport(element.getBoundingClientRect?.(), bounds)) return;
      try { element.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (error) {}
    }, delay);
  };

  updateKeyboardInset();
  doc.addEventListener("focusin", onFocusIn);
  viewport?.addEventListener?.("resize", updateKeyboardInset);
  viewport?.addEventListener?.("scroll", updateKeyboardInset);
  win.addEventListener?.("resize", updateKeyboardInset);

  return () => {
    if (focusTimer) win.clearTimeout(focusTimer);
    doc.removeEventListener("focusin", onFocusIn);
    viewport?.removeEventListener?.("resize", updateKeyboardInset);
    viewport?.removeEventListener?.("scroll", updateKeyboardInset);
    win.removeEventListener?.("resize", updateKeyboardInset);
    doc.documentElement?.style?.removeProperty("--pt-keyboard-inset");
  };
}
