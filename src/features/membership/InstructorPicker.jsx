import { useEffect, useRef, useState } from "react";

import { ALL_LOCATIONS } from "../../data/repositories/location-repository.js";
import {
  defaultPickerLocation, instructorLocationLabel, pickerInstructors,
} from "./instructor-picker.js";

/**
 * 담당 강사 고르기: 지점 칩 → 이름 검색 → 강사 칩 (소속 지점 함께).
 *
 * 회원권 발급이 쓴다. 담당 변경(HandoverSheet)은 줄마다 회원권의 지점이 정해져
 * 있어 같은 판정(instructor-picker.js)만 가져다 쓴다.
 *
 * 고른 강사가 칩이나 검색에 걸러져도 **맨 앞에 남긴다** -- 지점을 바꿨다고
 * 이미 고른 담당이 화면에서 사라지면 무엇이 저장될지 보이지 않는다.
 */
export default function InstructorPicker({
  instructors = [],
  locations = [],
  viewer = {},
  value = "",
  onSelect,
  /** 회원의 지점. 맡은 지점 중 하나면 그 칩이 먼저 눌린다. */
  preferredLocationId = "",
  initialLocationId = "",
  initialQuery = "",
}) {
  const [locationId, setLocationId] = useState(
    () => initialLocationId || defaultPickerLocation(viewer, locations, preferredLocationId),
  );
  const [query, setQuery] = useState(initialQuery);
  /* 사람이 칩을 누른 뒤에는 회원을 바꿔도 칩을 옮기지 않는다. 누른 것을
     조용히 되돌리면 방금 고른 지점이 왜 바뀌었는지 알 수 없다. */
  const touched = useRef(Boolean(initialLocationId));
  useEffect(() => {
    if (touched.current) return;
    setLocationId(defaultPickerLocation(viewer, locations, preferredLocationId));
  }, [viewer, locations, preferredLocationId]);

  const shown = pickerInstructors(instructors, { locationId, query });
  const selected = instructors.find((item) => String(item?.userId || "") === String(value || ""));
  const list = selected && !shown.includes(selected) ? [selected, ...shown] : shown;
  const chips = [{ id: ALL_LOCATIONS, name: "전체" }, ...locations];

  if (instructors.length === 0) {
    return <p style={{ fontSize: "var(--t-caption)", color: "var(--sub)" }}>등록된 강사가 없습니다.</p>;
  }

  return (
    <div data-instructor-picker className="space-y-2">
      {locations.length > 0 ? (
        <div className="flex flex-wrap gap-1.5" data-picker-locations>
          {chips.map((item) => {
            const on = locationId === item.id;
            return (
              <button key={item.id} type="button" data-location-chip={item.id} aria-pressed={on}
                onClick={() => { touched.current = true; setLocationId(item.id); }}
                className="h-8 px-2.5 font-bold" style={{
                  borderRadius: 999, fontSize: "var(--t-caption)",
                  backgroundColor: on ? "var(--ink)" : "var(--canvas)",
                  color: on ? "var(--card)" : "var(--sub)",
                }}>{item.name || item.id}</button>
            );
          })}
        </div>
      ) : null}

      <input value={query} onChange={(event) => setQuery(event.target.value)}
        data-picker-search placeholder="강사 이름 검색"
        className="h-9 w-full px-3" style={{
          borderRadius: 9, fontSize: "var(--t-caption)", color: "var(--ink)",
          backgroundColor: "var(--card)", border: "1px solid var(--line)",
        }} />

      {list.length === 0 ? (
        <p style={{ fontSize: "var(--t-caption)", color: "var(--sub)" }}>
          {query.trim() ? "이름이 맞는 강사가 없습니다." : "이 지점에 강사가 없습니다."}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {list.map((item) => {
            const on = String(value || "") === item.userId;
            return (
              <button key={item.userId} type="button" data-instructor-chip={item.userId} aria-pressed={on}
                onClick={() => onSelect?.(item.userId)}
                className="flex h-9 items-center gap-1 px-3 font-bold" style={{
                  borderRadius: 999, fontSize: "var(--t-caption)",
                  backgroundColor: on ? "var(--tint)" : "var(--canvas)",
                  color: on ? "var(--brand-d)" : "var(--sub)",
                }}>
                <span>{item.displayName || item.userId}</span>
                <span className="font-semibold" style={{ opacity: 0.7 }}>· {instructorLocationLabel(item, locations)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
