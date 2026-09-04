const STYLE_FIELDS = [
  "overflow", "overflowX", "overflowY", "position", "paddingTop", "paddingBottom",
  "marginTop", "transform", "clipPath", "mask", "zIndex",
];

const rounded = (value) => Math.round((Number(value) || 0) * 100) / 100;

export function layoutRect(element) {
  const rect = element?.getBoundingClientRect?.();
  if (!rect) return null;
  return {
    left: rounded(rect.left),
    top: rounded(rect.top),
    right: rounded(rect.right),
    bottom: rounded(rect.bottom),
    width: rounded(rect.width),
    height: rounded(rect.height),
  };
}

export function layoutStyle(element, getComputedStyleRef) {
  if (!element || typeof getComputedStyleRef !== "function") return null;
  const computed = getComputedStyleRef(element);
  const snapshot = {};
  STYLE_FIELDS.forEach((field) => {
    snapshot[field] = String(computed?.[field] || (field === "mask" ? computed?.maskImage : "") || "");
  });
  return snapshot;
}

const hasHiddenOverflow = (style) => [style?.overflow, style?.overflowX, style?.overflowY].some((value) => value === "hidden");
const hasClip = (style) => hasHiddenOverflow(style) || Boolean(style?.clipPath && style.clipPath !== "none") || Boolean(style?.mask && style.mask !== "none");
const hasTransform = (style) => Boolean(style?.transform && style.transform !== "none");

export function clippingAncestorChain(element, getComputedStyleRef) {
  const ancestors = [];
  let current = element;
  while (current) {
    const style = layoutStyle(current, getComputedStyleRef);
    if (hasClip(style) || hasTransform(style)) {
      ancestors.push({
        tagName: String(current.tagName || ""),
        className: String(current.className || "").slice(0, 240),
        overflow: style?.overflow || "",
        overflowX: style?.overflowX || "",
        overflowY: style?.overflowY || "",
        clipPath: style?.clipPath || "",
        mask: style?.mask || "",
        transform: style?.transform || "",
        position: style?.position || "",
      });
    }
    current = current.parentElement;
  }
  return ancestors;
}

const elementSnapshot = (element, getComputedStyleRef) => ({
  rect: layoutRect(element),
  style: layoutStyle(element, getComputedStyleRef),
});

export function createMemberLayoutSnapshot({ elements, documentRef, windowRef }) {
  const root = elements?.root || null;
  const actionBar = elements?.actionBar || null;
  const scrollContainer = elements?.scrollContainer || null;
  const firstSummary = elements?.firstSummary || null;
  const recentCard = elements?.recentCard || null;
  const getComputedStyleRef = windowRef?.getComputedStyle?.bind(windowRef);
  const actionRect = layoutRect(actionBar);
  const scrollRect = layoutRect(scrollContainer);
  const cardRect = layoutRect(recentCard);
  const x = cardRect ? cardRect.left + cardRect.width / 2 : 0;
  const y = cardRect ? cardRect.top + 4 : 0;
  const hit = cardRect ? documentRef?.elementFromPoint?.(x, y) || null : null;
  const hitIsCard = Boolean(recentCard && hit && (hit === recentCard || recentCard.contains?.(hit)));
  const hitInsideCard = Boolean(recentCard && hit && hit !== recentCard && recentCard.contains?.(hit));
  const clippingAncestors = clippingAncestorChain(scrollContainer, getComputedStyleRef);

  return {
    root: elementSnapshot(root, getComputedStyleRef),
    actionBar: elementSnapshot(actionBar, getComputedStyleRef),
    scrollContainer: elementSnapshot(scrollContainer, getComputedStyleRef),
    firstSummary: elementSnapshot(firstSummary, getComputedStyleRef),
    recentCard: elementSnapshot(recentCard, getComputedStyleRef),
    scrollTop: rounded(scrollContainer?.scrollTop),
    clientHeight: rounded(scrollContainer?.clientHeight),
    scrollHeight: rounded(scrollContainer?.scrollHeight),
    hitTagName: String(hit?.tagName || ""),
    hitClassName: String(hit?.className || "").slice(0, 240),
    hitIsCard,
    hitInsideCard,
    cardAboveContainer: Boolean(cardRect && scrollRect && cardRect.top < scrollRect.top),
    cardBelowContainer: Boolean(cardRect && scrollRect && cardRect.bottom > scrollRect.bottom),
    actionBarOverlapsContainer: Boolean(actionRect && scrollRect && actionRect.bottom > scrollRect.top),
    ancestorHasClip: clippingAncestors.some((entry) => hasClip(entry)),
    ancestorHasTransform: clippingAncestors.some((entry) => hasTransform(entry)),
    clippingAncestors,
  };
}

export function scheduleMemberLayoutSnapshots({ elements, documentRef, windowRef, onSnapshot }) {
  if (!windowRef?.requestAnimationFrame || typeof onSnapshot !== "function") return () => {};
  let firstFrame = 0;
  let settledFrame = 0;
  firstFrame = windowRef.requestAnimationFrame(() => {
    onSnapshot({ frame: "first", ...createMemberLayoutSnapshot({ elements, documentRef, windowRef }) });
    settledFrame = windowRef.requestAnimationFrame(() => {
      onSnapshot({ frame: "settled", ...createMemberLayoutSnapshot({ elements, documentRef, windowRef }) });
    });
  });
  return () => {
    if (firstFrame) windowRef.cancelAnimationFrame?.(firstFrame);
    if (settledFrame) windowRef.cancelAnimationFrame?.(settledFrame);
  };
}
