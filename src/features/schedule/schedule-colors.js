/* 일정 유형별 카드 색 — 프리셋과 사용자 선택값을 컴포넌트 밖에서 관리한다.
   카드 안에 색을 직접 적지 않고, 항상 이 레이어가 계산한 tone 을 받아 쓴다.

   surface = 옅은 배경(카드 전체), edge = 왼쪽 띠와 유형 약자, ink = 배경 위 글자.
   형광색과 원색은 쓰지 않는다 — 브랜드 보라(#4C4399) 톤에 맞춘 저채도만 담는다. */

import { LESSON_TYPE_KEYS } from "./lesson-types.js";

export const SCHEDULE_COLOR_PRESETS = Object.freeze([
  Object.freeze({
    id: "violet", label: "보라",
    light: Object.freeze({ surface: "#EFEDFA", edge: "#5B4FB0", ink: "#3E3781", border: "#DDD9F2" }),
    dark: Object.freeze({ surface: "#2A2650", edge: "#9A8FF0", ink: "#C7C0F7", border: "#3A3470" }),
  }),
  Object.freeze({
    id: "indigo", label: "남보라",
    light: Object.freeze({ surface: "#EAEEF9", edge: "#40559E", ink: "#33447E", border: "#D6DDF1" }),
    dark: Object.freeze({ surface: "#222944", edge: "#8397E8", ink: "#B3BFF2", border: "#313A5C" }),
  }),
  Object.freeze({
    id: "blue", label: "파랑",
    light: Object.freeze({ surface: "#E8F1FA", edge: "#2F6FA8", ink: "#275C8C", border: "#D2E4F3" }),
    dark: Object.freeze({ surface: "#1B2A3A", edge: "#6FA9DE", ink: "#A8CBEC", border: "#2A3B50" }),
  }),
  Object.freeze({
    id: "teal", label: "민트",
    light: Object.freeze({ surface: "#E5F2EE", edge: "#2C7D69", ink: "#256958", border: "#CDE7E0" }),
    dark: Object.freeze({ surface: "#17322D", edge: "#5CC29F", ink: "#9EDCC5", border: "#22463E" }),
  }),
  Object.freeze({
    id: "green", label: "초록",
    light: Object.freeze({ surface: "#EBF2E5", edge: "#4F7C36", ink: "#41682C", border: "#D8E7CD" }),
    dark: Object.freeze({ surface: "#1E2E1B", edge: "#8FC275", ink: "#BBDBA9", border: "#2C4127" }),
  }),
  Object.freeze({
    id: "amber", label: "주황",
    light: Object.freeze({ surface: "#FAF0E0", edge: "#A96A16", ink: "#8A5610", border: "#F0DFC2" }),
    dark: Object.freeze({ surface: "#372B18", edge: "#DDA757", ink: "#EFCB93", border: "#4A3A22" }),
  }),
  Object.freeze({
    id: "rose", label: "로즈",
    light: Object.freeze({ surface: "#F9EAEA", edge: "#A9484B", ink: "#8C3B3E", border: "#F0D5D6" }),
    dark: Object.freeze({ surface: "#3A2223", edge: "#E1888B", ink: "#EFB6B8", border: "#4E2E2F" }),
  }),
  Object.freeze({
    id: "slate", label: "회색",
    light: Object.freeze({ surface: "#EDEFF3", edge: "#697386", ink: "#525B6C", border: "#DDE1E9" }),
    dark: Object.freeze({ surface: "#262C39", edge: "#8B94A6", ink: "#B4BBC9", border: "#333B4B" }),
  }),
]);

export const SCHEDULE_COLOR_PRESET_IDS = Object.freeze(SCHEDULE_COLOR_PRESETS.map((item) => item.id));

const BY_ID = new Map(SCHEDULE_COLOR_PRESETS.map((item) => [item.id, item]));

export const DEFAULT_SCHEDULE_COLORS = Object.freeze({
  private: "violet",
  duet: "blue",
  group: "teal",
  consult: "amber",
  off: "slate",
});

export const scheduleColorPreset = (id) => BY_ID.get(String(id ?? "").trim()) || null;

/* 저장값에 없는 유형·모르는 프리셋 id 는 기본값으로 되돌린다 — 화면이 색 없이 뜨는 일은 없어야 한다. */
export function normalizeScheduleColors(value) {
  const source = value && typeof value === "object" ? value : {};
  const out = {};
  LESSON_TYPE_KEYS.forEach((key) => {
    const candidate = String(source[key] ?? "").trim();
    out[key] = BY_ID.has(candidate) ? candidate : DEFAULT_SCHEDULE_COLORS[key];
  });
  return out;
}

export const isDefaultScheduleColors = (value) => {
  const current = normalizeScheduleColors(value);
  return LESSON_TYPE_KEYS.every((key) => current[key] === DEFAULT_SCHEDULE_COLORS[key]);
};

export function setScheduleTypeColor(value, typeKey, presetId) {
  const current = normalizeScheduleColors(value);
  if (!LESSON_TYPE_KEYS.includes(typeKey) || !BY_ID.has(presetId)) return current;
  return { ...current, [typeKey]: presetId };
}

export function resolveScheduleTypeTone(typeKey, colors, theme = "light") {
  const presetId = normalizeScheduleColors(colors)[typeKey] || DEFAULT_SCHEDULE_COLORS.private;
  const preset = scheduleColorPreset(presetId) || SCHEDULE_COLOR_PRESETS[0];
  return { presetId: preset.id, ...(theme === "dark" ? preset.dark : preset.light) };
}

export function scheduleTypeTones(colors, theme = "light") {
  const out = {};
  LESSON_TYPE_KEYS.forEach((key) => { out[key] = resolveScheduleTypeTone(key, colors, theme); });
  return out;
}
