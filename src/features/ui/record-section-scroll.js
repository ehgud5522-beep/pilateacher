export function scrollRecordSectionIntoView(element) {
  if (!element || typeof element.scrollIntoView !== "function") return false;
  const reduced = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  element.scrollIntoView({ behavior: reduced ? "instant" : "smooth", block: "nearest" });
  return true;
}
