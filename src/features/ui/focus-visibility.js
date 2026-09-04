const FOCUSABLE_SELECTOR = 'input, textarea, select, [contenteditable="true"]';
const EXCLUDED_INPUT_TYPES = new Set(["range", "file", "checkbox"]);

export function visibleFrameBounds(clientHeight) {
  return { top: 0, bottom: Math.max(0, Number(clientHeight) || 0) };
}

export function isOutsideVisibleViewport(rect, bounds, margin = 16) {
  if (!rect || !bounds) return false;
  return rect.top < bounds.top + margin || rect.bottom > bounds.bottom - margin;
}

export function installFocusVisibilityGuard({ documentRef, windowRef, delay = 320 }) {
  const doc = documentRef;
  const win = windowRef;
  if (!doc?.addEventListener || !win) return () => {};

  let focusTimer = null;

  const onFocusIn = (event) => {
    const element = event.target;
    if (!element?.matches?.(FOCUSABLE_SELECTOR)) return;
    if (element.tagName === "INPUT" && EXCLUDED_INPUT_TYPES.has(String(element.type || "").toLowerCase())) return;
    if (focusTimer) win.clearTimeout(focusTimer);
    focusTimer = win.setTimeout(() => {
      const bounds = visibleFrameBounds(doc.documentElement?.clientHeight);
      if (!isOutsideVisibleViewport(element.getBoundingClientRect?.(), bounds)) return;
      try { element.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (error) {}
    }, delay);
  };

  doc.addEventListener("focusin", onFocusIn);

  return () => {
    if (focusTimer) win.clearTimeout(focusTimer);
    doc.removeEventListener("focusin", onFocusIn);
  };
}
