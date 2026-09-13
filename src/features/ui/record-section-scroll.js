export function scrollRecordSectionIntoView(element) {
  if (!element || typeof element.scrollIntoView !== "function") return false;
  element.scrollIntoView({ behavior: "smooth", block: "nearest" });
  return true;
}
