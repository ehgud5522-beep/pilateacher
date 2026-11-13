import { useEffect, useState } from "react";
import { currentMonth, GROUP_EMPTY_ROOM_RATE, groupPayrollAmount } from "../../data/repositories/payroll-repository.js";
import { fullRoomRateOf, listMemberships } from "../../data/repositories/instructor-repository.js";
import { listLocations, scopedLocationIds } from "../../data/repositories/location-repository.js";
import { fbManageGroupPayroll } from "../../lib/firebase.js";

const won = (value) => value.toLocaleString("ko-KR");
const numeric = (value) => Number(value || 0);
const validCount = (value) => /^\d{0,4}$/.test(value) && numeric(value) <= 1000;
const inputClass = "min-w-0 w-full rounded-lg border border-[var(--line)] bg-[var(--card)] px-2 py-2 text-sm";
const panelClass = "space-y-3 rounded-xl border border-[var(--line)] bg-[var(--card)] p-3";

function GroupPayrollEditor({ organizationId, month, locationId, instructors, busy, setBusy }) {
  const [record, setRecord] = useState(null);
  const [draft, setDraft] = useState({});
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [reload, setReload] = useState(0);
  const request = { organizationId, month, locationId };
  useEffect(() => {
    let active = true;
    fbManageGroupPayroll({ organizationId, month, locationId, action: "list" }).then((result) => {
      if (active) setRecord(result);
    }).catch(() => {
      if (active) setError("입력 내역을 불러오지 못했습니다.");
    });
    return () => { active = false; };
  }, [organizationId, month, locationId, reload]);

  const stored = new Map((record?.rows || []).map((row) => [row.instructorId, row]));
  const people = instructors.filter((person) => stored.has(person.userId)
    || (person.status === "active" && person.role === "instructor" && scopedLocationIds(person).includes(locationId)));
  const listed = new Set(people.map((person) => person.userId));
  for (const instructorId of stored.keys()) {
    if (!listed.has(instructorId)) people.push({ userId: instructorId });
  }
  const rows = people.map((person) => {
    const instructorId = person.userId;
    const previous = stored.get(instructorId);
    const input = draft[instructorId] || {
      fullCount: previous ? String(previous.fullCount) : "",
      emptyCount: previous ? String(previous.emptyCount) : "",
    };
    return {
      instructorId, input, name: person.displayName || instructorId,
      fullRate: previous?.fullRate || fullRoomRateOf(person) || 0,
      fullCount: numeric(input.fullCount), emptyCount: numeric(input.emptyCount),
      changed: numeric(input.fullCount) !== (previous?.fullCount || 0)
        || numeric(input.emptyCount) !== (previous?.emptyCount || 0),
    };
  });
  const edits = rows.filter((row) => row.changed).map(({ instructorId, fullCount, emptyCount }) => (
    { instructorId, fullCount, emptyCount }
  ));
  const missingRate = rows.some((row) => row.fullCount > 0 && !row.fullRate);
  const invalid = rows.some((row) => !validCount(row.input.fullCount) || !validCount(row.input.emptyCount));
  const reset = () => {
    setRecord(null);
    setDraft({});
    setError("");
    setSaved(false);
    setReload((value) => value + 1);
  };

  const save = async (event) => {
    event.preventDefault();
    if (!record || busy || missingRate || invalid || !edits.length) return;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const result = await fbManageGroupPayroll({ ...request, action: "save", edits, revision: record.revision });
      setRecord(result);
      setDraft({});
      setSaved(true);
    } catch (failure) {
      const reason = failure?.details?.reason;
      setError(reason === "group_payroll_conflict"
        ? "다른 곳에서 이 지점의 내역을 수정했어요. 입력한 횟수를 확인한 뒤 최신 내역을 다시 불러와 주세요."
        : reason === "group_payroll_rate" ? "풀방 단가가 없는 강사가 있습니다. 강사 관리에서 단가를 확인해 주세요."
          : "저장하지 못했습니다. 입력값을 확인하고 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className={panelClass}>
      {error && <p role="alert" className="text-sm">{error}</p>}
      {(!record && error || error.startsWith("다른 곳")) && (
        <button type="button" onClick={reset} className={inputClass}>최신 내역 불러오기</button>
      )}
      {!record && !error && <p className="text-sm">불러오는 중…</p>}
      {record && rows.length === 0 && <p className="text-sm">이 지점에 등록된 강사가 없습니다.</p>}
      {record && rows.map((row) => (
        <fieldset key={row.instructorId} disabled={busy} className="space-y-1 border-t border-[var(--line)] pt-2">
          <p className="text-sm font-bold">{row.name}</p>
          <div className="grid grid-cols-2 gap-2">
            {[["fullCount", "풀방", row.fullRate], ["emptyCount", "빈방", GROUP_EMPTY_ROOM_RATE]].map(([field, label, rate]) => (
              <label key={field} className="min-w-0 text-xs">
                <span>{label} · {rate ? `${won(rate)}원/회` : "단가 미설정"}</span>
                <input type="text" inputMode="numeric" aria-label={`${row.name} ${label} 횟수`}
                  placeholder="0" value={row.input[field]} className={inputClass}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (!/^\d{0,4}$/.test(value)) return;
                    setSaved(false);
                    setDraft((current) => ({ ...current, [row.instructorId]: { ...row.input, [field]: value } }));
                  }} />
              </label>
            ))}
          </div>
          <p className="text-right text-sm font-bold">
            {row.fullCount > 0 && !row.fullRate ? "풀방 단가를 먼저 설정해 주세요" : `${won(groupPayrollAmount(row))}원`}
          </p>
        </fieldset>
      ))}
      {record && rows.length > 0 && <>
        {invalid && <p role="alert" className="text-sm">횟수는 0~1,000 사이로 입력해 주세요.</p>}
        <p className="text-right text-sm font-bold">지점 합계 {missingRate || invalid ? "—" : `${won(rows.reduce((total, row) => total + groupPayrollAmount(row), 0))}원`}</p>
        <button type="submit" disabled={busy || missingRate || invalid || !edits.length}
          className="h-11 w-full rounded-lg bg-[var(--brand)] text-sm font-bold text-white disabled:opacity-40">
          {busy ? "저장 중…" : "저장하고 급여에 반영"}
        </button>
        {saved && <p role="status" className="text-sm">이 달 급여 집계에 반영했습니다.</p>}
      </>}
    </form>
  );
}

export default function GroupPayrollAdmin({ organization, locationStore, instructorStore }) {
  const { organizationId, role } = organization;
  const [month, setMonth] = useState(() => currentMonth());
  const [locationId, setLocationId] = useState("");
  const [directory, setDirectory] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    Promise.all([
      listLocations(organizationId, { store: locationStore }),
      listMemberships(organizationId, { store: instructorStore }),
    ]).then(([locations, instructors]) => {
      if (active) setDirectory({ locations, instructors });
    }).catch(() => {
      if (active) setLoadError(true);
    });
    return () => { active = false; };
  }, [organizationId, locationStore, instructorStore, retry]);

  if (loadError) return <section className={panelClass}>
    <p role="alert">지점과 강사 목록을 불러오지 못했습니다.</p>
    <button type="button" className={inputClass} onClick={() => { setLoadError(false); setRetry((value) => value + 1); }}>다시 시도</button>
  </section>;
  if (!directory) return <p className="text-sm">지점과 강사 목록을 불러오는 중…</p>;
  const scope = scopedLocationIds(organization);
  const locations = directory.locations.filter((location) => role !== "manager" || scope.includes(location.id));
  const selected = locations.find((location) => location.id === locationId) || locations[0];
  if (!selected) return <p className="text-sm">정산을 입력할 수 있는 지점이 없습니다. 계정의 담당 지점을 확인해 주세요.</p>;

  return (
    <div className="space-y-3">
      <div className={panelClass}>
        <div className="grid grid-cols-2 gap-2">
          <label className="min-w-0 text-xs">정산 월
            <input type="month" className={inputClass} value={month} max={currentMonth()} disabled={busy}
              onChange={(event) => { if (event.target.value && event.target.value <= currentMonth()) setMonth(event.target.value); }} />
          </label>
          <label className="min-w-0 text-xs">지점
            <select className={inputClass} value={selected.id} onChange={(event) => setLocationId(event.target.value)} disabled={busy}>
              {locations.map((location) => <option key={location.id} value={location.id}>{location.name || location.id}</option>)}
            </select>
          </label>
        </div>
        <p className="text-xs">강사별 해당 월의 전체 횟수를 입력해 주세요. 같은 월과 지점을 다시 저장하면 변경한 강사의 횟수가 갱신됩니다.</p>
      </div>
      <GroupPayrollEditor key={JSON.stringify([organizationId, month, selected.id])} organizationId={organizationId}
        month={month} locationId={selected.id} instructors={directory.instructors} busy={busy} setBusy={setBusy} />
    </div>
  );
}
