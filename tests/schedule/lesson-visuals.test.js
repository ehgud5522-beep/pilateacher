import test from "node:test";
import assert from "node:assert/strict";
import {
  EQUIPMENT_IDS, equipmentIdsOf, formatEquipmentList, formatEquipmentSummary,
  legacyEquipLabel, normalizeEquipmentIds, toggleEquipmentId,
} from "../../src/features/schedule/equipment.js";
import {
  DEFAULT_GROUP_COUNT, GROUP_COUNT_MAX, LESSON_TYPE_KEYS,
  clampGroupCount, lessonTypeKeyOf,
} from "../../src/features/schedule/lesson-types.js";
import {
  DEFAULT_SCHEDULE_COLORS, SCHEDULE_COLOR_PRESET_IDS, isDefaultScheduleColors,
  normalizeScheduleColors, resolveScheduleTypeTone, setScheduleTypeColor,
} from "../../src/features/schedule/schedule-colors.js";

test("기구 목록은 registry 5종만 갖는다", () => {
  assert.deepEqual(EQUIPMENT_IDS, ["reformer", "cadillac", "chair", "barrel", "mat"]);
});

test("기구 값은 id·표시명 모두 받고 등록되지 않은 값은 버린다", () => {
  assert.deepEqual(normalizeEquipmentIds(["reformer", "체어"]), ["reformer", "chair"]);
  assert.deepEqual(normalizeEquipmentIds("리포머"), ["reformer"]);
  assert.deepEqual(normalizeEquipmentIds("그룹"), []);
  assert.deepEqual(normalizeEquipmentIds(null), []);
  assert.deepEqual(normalizeEquipmentIds(["mat", "mat", "reformer"]), ["reformer", "mat"]);
});

test("기구 선택은 토글이고 registry 순서를 지킨다", () => {
  let ids = toggleEquipmentId([], "chair");
  ids = toggleEquipmentId(ids, "reformer");
  assert.deepEqual(ids, ["reformer", "chair"]);
  assert.deepEqual(toggleEquipmentId(ids, "chair"), ["reformer"]);
  assert.deepEqual(toggleEquipmentId(ids, "스프링보드"), ids);
});

test("일정표 표시 규칙 — 0개·1개·2개·3개 이상", () => {
  assert.equal(formatEquipmentSummary([]), "");
  assert.equal(formatEquipmentSummary(["reformer"]), "리포머");
  assert.equal(formatEquipmentSummary(["reformer", "chair"]), "리포머 · 체어");
  assert.equal(formatEquipmentSummary(["cadillac", "barrel", "mat"]), "캐딜락 외 2");
  assert.equal(formatEquipmentSummary(["reformer", "cadillac", "chair", "mat"]), "리포머 외 3");
  assert.equal(formatEquipmentList(["cadillac", "barrel", "mat"]), "캐딜락 · 바렐 · 매트");
});

test("옛 일정은 강제 migration 없이 문자열 equip 을 읽어 표시한다", () => {
  assert.deepEqual(equipmentIdsOf({ equip: "리포머" }), ["reformer"]);
  assert.deepEqual(equipmentIdsOf({ equip: "그룹" }), []);
  assert.deepEqual(equipmentIdsOf({ equipmentIds: [], equip: "리포머" }), [], "새 필드가 있으면 그 값이 사실이다");
  assert.deepEqual(equipmentIdsOf({}), []);
});

test("옛 코드가 읽는 equip 거울값은 첫 기구, 미선택이면 기존 기본값", () => {
  assert.equal(legacyEquipLabel(["chair", "reformer"]), "리포머");
  assert.equal(legacyEquipLabel([]), "그룹");
});

test("일정 유형은 7종으로 갈린다", () => {
  /* 2026-10-05 에 관리 A·B 가 늘었다 (디오사). 개인과 모양이 같아 보이지만
     차감하는 회원권이 다르다 -- 적힌 종류가 그대로 답이어야 하고, 사람 수로
     맞히면 PT 회원권에서 빠진다. */
  assert.deepEqual(LESSON_TYPE_KEYS, ["private", "duet", "care_a", "care_b", "group", "consult", "off"]);
  assert.equal(lessonTypeKeyOf({ type: "관리A", attendees: [{ memberId: "a" }] }), "care_a");
  assert.equal(lessonTypeKeyOf({ type: "관리B", attendees: [{ memberId: "a" }] }), "care_b");
  // 종류가 사람 수를 이긴다. 관리 수업에 둘이 적혀 있어도 듀엣이 아니다.
  assert.equal(lessonTypeKeyOf({ type: "관리A", attendees: [{ memberId: "a" }, { memberId: "b" }] }), "care_a");
  assert.equal(lessonTypeKeyOf({ personal: true, title: "상담" }), "consult");
  assert.equal(lessonTypeKeyOf({ personal: true, title: "휴무" }), "off");
  assert.equal(lessonTypeKeyOf({ type: "그룹", attendees: [] }), "group");
  assert.equal(lessonTypeKeyOf({ type: "듀엣", attendees: [{ memberId: "a" }, { memberId: "b" }] }), "duet");
  assert.equal(lessonTypeKeyOf({ type: "듀엣", attendees: [{ memberId: "a" }] }), "duet");
  assert.equal(lessonTypeKeyOf({ type: "개인레슨", attendees: [{ memberId: "a" }] }), "private");
  assert.equal(lessonTypeKeyOf({ memberId: "a" }), "private", "옛 단일 memberId 일정");
});

test("그룹 인원은 기본 8명, 1~20명으로 묶인다", () => {
  assert.equal(clampGroupCount(""), DEFAULT_GROUP_COUNT);
  assert.equal(clampGroupCount(0), DEFAULT_GROUP_COUNT);
  assert.equal(clampGroupCount(1), 1);
  assert.equal(clampGroupCount(25), GROUP_COUNT_MAX);
  assert.equal(clampGroupCount(-3, 1), 1);
  assert.equal(clampGroupCount(12), 12);
});

test("색 설정은 모르는 값을 기본값으로 되돌린다", () => {
  assert.deepEqual(normalizeScheduleColors(null), { ...DEFAULT_SCHEDULE_COLORS });
  // 유형이 늘면 색도 함께 늘어야 한다. 빠지면 그 유형이 색 없이 뜬다.
  assert.deepEqual(Object.keys(DEFAULT_SCHEDULE_COLORS).sort(), [...LESSON_TYPE_KEYS].sort());
  assert.deepEqual(normalizeScheduleColors({ private: "없는색" }), { ...DEFAULT_SCHEDULE_COLORS });
  assert.equal(normalizeScheduleColors({ private: "rose" }).private, "rose");
  assert.equal(isDefaultScheduleColors(null), true);
  assert.equal(isDefaultScheduleColors({ ...DEFAULT_SCHEDULE_COLORS, group: "rose" }), false);
});

test("유형 색 변경은 해당 유형만 바꾼다", () => {
  const next = setScheduleTypeColor(null, "group", "rose");
  assert.equal(next.group, "rose");
  assert.equal(next.private, DEFAULT_SCHEDULE_COLORS.private);
  assert.deepEqual(setScheduleTypeColor(null, "group", "없는색"), { ...DEFAULT_SCHEDULE_COLORS });
  assert.deepEqual(setScheduleTypeColor(null, "없는유형", "rose"), { ...DEFAULT_SCHEDULE_COLORS });
});

test("모든 프리셋은 라이트·다크 값을 갖고 배경과 띠 색이 다르다", () => {
  assert.ok(SCHEDULE_COLOR_PRESET_IDS.length >= 6 && SCHEDULE_COLOR_PRESET_IDS.length <= 8);
  LESSON_TYPE_KEYS.forEach((key) => {
    SCHEDULE_COLOR_PRESET_IDS.forEach((presetId) => {
      const colors = setScheduleTypeColor(null, key, presetId);
      ["light", "dark"].forEach((theme) => {
        const tone = resolveScheduleTypeTone(key, colors, theme);
        assert.equal(tone.presetId, presetId);
        [tone.surface, tone.edge, tone.ink, tone.border].forEach((value) => assert.match(value, /^#[0-9A-F]{6}$/i));
        assert.notEqual(tone.surface, tone.edge);
        assert.notEqual(tone.surface, tone.ink);
      });
      assert.notEqual(
        resolveScheduleTypeTone(key, colors, "light").surface,
        resolveScheduleTypeTone(key, colors, "dark").surface,
        "라이트·다크가 같은 배경을 쓰면 대비가 깨진다",
      );
    });
  });
});
