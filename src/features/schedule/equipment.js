/* 수업 기구 registry — 표시명은 여기서만 관리한다.
   일정에는 표시명이 아니라 stable id 배열(equipmentIds)만 저장한다.
   스프링보드·소도구 등이 늘어나도 이 배열에 한 줄 추가하면 카드·저장·설정이 함께 따라온다. */

export const EQUIPMENT_REGISTRY = Object.freeze([
  Object.freeze({ id: "reformer", label: "리포머" }),
  Object.freeze({ id: "cadillac", label: "캐딜락" }),
  Object.freeze({ id: "chair", label: "체어" }),
  Object.freeze({ id: "barrel", label: "바렐" }),
  Object.freeze({ id: "mat", label: "매트" }),
]);

export const EQUIPMENT_IDS = Object.freeze(EQUIPMENT_REGISTRY.map((item) => item.id));

const BY_ID = new Map(EQUIPMENT_REGISTRY.map((item) => [item.id, item]));
const BY_LABEL = new Map(EQUIPMENT_REGISTRY.map((item) => [item.label, item]));
const ORDER = new Map(EQUIPMENT_REGISTRY.map((item, index) => [item.id, index]));

/* id 도 표시명도 모두 받아준다 — 예전 일정은 표시명 하나만 문자열로 갖고 있다.
   등록되지 않은 값("그룹" 같은 옛 기본값)은 기구가 아니므로 조용히 버린다. */
const resolveEquipmentId = (value) => {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (BY_ID.has(text)) return text;
  return BY_LABEL.get(text)?.id || "";
};

export function equipmentLabel(id) {
  return BY_ID.get(String(id ?? "").trim())?.label || "";
}

export function normalizeEquipmentIds(value) {
  const source = Array.isArray(value) ? value : value == null || value === "" ? [] : [value];
  const out = [];
  source.forEach((item) => {
    const id = resolveEquipmentId(item);
    if (id && !out.includes(id)) out.push(id);
  });
  return out.sort((a, b) => ORDER.get(a) - ORDER.get(b));
}

export function toggleEquipmentId(ids, id) {
  const current = normalizeEquipmentIds(ids);
  const target = resolveEquipmentId(id);
  if (!target) return current;
  return current.includes(target)
    ? current.filter((item) => item !== target)
    : normalizeEquipmentIds([...current, target]);
}

export function equipmentLabels(ids) {
  return normalizeEquipmentIds(ids).map((id) => equipmentLabel(id));
}

/* 일정표 표시 규칙 — 1개는 그대로, 2개는 가운뎃점, 3개 이상은 "첫 기구 외 N". */
export function formatEquipmentSummary(ids) {
  const labels = equipmentLabels(ids);
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} · ${labels[1]}`;
  return `${labels[0]} 외 ${labels.length - 1}`;
}

/* 좁은 카드가 아닌 상세 화면에서는 축약하지 않고 전부 보여준다. */
export function formatEquipmentList(ids) {
  return equipmentLabels(ids).join(" · ");
}

/* 예전 일정에는 equipmentIds 가 없다 — 강제 migration 없이 읽는 쪽에서만 옛 필드를 함께 본다. */
export function equipmentIdsOf(lesson) {
  if (Array.isArray(lesson?.equipmentIds)) return normalizeEquipmentIds(lesson.equipmentIds);
  return normalizeEquipmentIds(lesson?.equip);
}

/* 옛 코드 경로(그룹 일정 판별·목록 요약)가 아직 문자열 equip 을 읽는다.
   선택한 첫 기구 표시명을 거울로 남기고, 미선택이면 옛 기본값을 유지한다. */
export function legacyEquipLabel(ids, fallback = "그룹") {
  return equipmentLabels(ids)[0] || fallback;
}
