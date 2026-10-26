import { useMemo, useState } from "react";
import { AlertTriangle, ChevronRight, Loader2 } from "lucide-react";

import {
  HANDOVER_BLOCK_LABEL, handoverPlan, instructorsForHandover,
} from "./instructor-handover.js";

/**
 * 담당 인계 화면. **회원권 한 장이든 퇴사 강사 전부든 같은 화면이다.**
 *
 * 두 자리에서 열린다 -- 회원 상세의 "담당 변경"(한 장)과 대표 메뉴의 "퇴사
 * 인계"(그 강사 전부). 서버에서 일어나는 일이 같으므로 화면도 하나다. 둘을
 * 따로 그리면 한쪽만 고쳐지는 날이 오고, 그날 대표가 보는 숫자와 실제로
 * 넘어가는 것이 갈라진다.
 *
 * ── 이 화면이 지키는 것 ──
 * **보여 준 목록이 곧 넘어가는 목록이다.** 계획(handoverPlan)을 한 번 세우고
 * 그 객체를 그대로 실행에 넘긴다 -- 실행이 다시 세면 그 사이에 바뀐 값이
 * 들어가고, 대표는 자기가 승인한 것과 다른 일이 일어난 것을 나중에야 안다.
 * 원장은 append-only 라 그때는 되돌릴 수 없다.
 */

const won = (value) => (Number(value) || 0).toLocaleString("ko-KR");

/** 인계 후 단가 한 줄. 모르는 것은 숫자로 적지 않는다. */
function RateAfter({ row }) {
  if (row.unitPriceAfter === null) {
    /* 부원장 5:5 는 계약마다 다르다. 숫자를 지어내면 미리보기가 거짓말을 하고,
       그 화면은 다시 안 읽힌다. */
    return <span style={{ color: "var(--sub)" }}>계약에 따라 다름 (부원장 5:5)</span>;
  }
  return <span style={{ color: "var(--ink)" }}>₩{won(row.unitPriceAfter)}</span>;
}

export default function HandoverSheet({
  passes = [],
  instructors = [],
  fromInstructorId = "",
  fromName = "",
  clientNameOf,
  sessionsOf,
  unsettled = [],
  onRun,
  onClose,
  busy = false,
  errorCode = "",
  /** 퇴사 인계에서만 보인다. 넘긴 뒤 그 강사의 로그인을 닫을 것인가. */
  offerRevoke = false,
  initialAssignments = null,
  /* 시계를 주입받는다. 만료 여부가 "지금" 에 달려 있어, 고정하지 않으면
     스모크가 날짜마다 다른 화면을 그린다 -- 픽스처의 날짜를 옮기는 것은
     답이 아니다 (또 다른 날에 터진다). */
  now = null,
}) {
  const [assignments, setAssignments] = useState(() => initialAssignments || {});
  const [revoke, setRevoke] = useState(offerRevoke);

  const plan = useMemo(() => handoverPlan({
    passes, assignments, fromInstructorId,
    clientNameOf, sessionsOf,
    now: now instanceof Date ? now : new Date(),
    instructorOf: (id) => instructors.find((item) => String(item?.userId || "") === String(id)) || null,
  }), [passes, assignments, fromInstructorId, instructors, clientNameOf, sessionsOf, now]);

  /* 받을 수 있는 강사는 **그 회원권의 지점** 기준이다. 퇴사 인계에서 지점이
     섞여 있으면 줄마다 목록이 달라지는 것이 맞다 -- 한 목록으로 묶으면 다른
     지점 강사가 보이고, 고르면 그 줄이 막힌다. */
  const choicesFor = (locationId) => instructorsForHandover(instructors, {
    locationId, excludeUserId: fromInstructorId,
  });

  const assignAll = (userId) => {
    const next = {};
    for (const row of plan.rows) next[row.passId] = userId;
    setAssignments(next);
  };

  const allChoices = instructorsForHandover(instructors, { excludeUserId: fromInstructorId });

  return (
    <div className="space-y-3">
      {/* ── 먼저 처리할 것 ────────────────────────────────────────────────
          담당이 바뀐 뒤에 확정하면 그 회차가 **새 강사의 급여**로 들어간다 --
          수업한 사람은 전 강사인데. 원장은 append-only 라 되돌릴 수 없다. */}
      {unsettled.length > 0 ? (
        <div className="rounded-xl px-3 py-2.5" style={{ backgroundColor: "var(--warn-s)", border: "1px solid var(--warn)" }}>
          <p className="flex items-center gap-1.5 text-xs font-extrabold" style={{ color: "var(--warn)" }}>
            <AlertTriangle size={13} /> 확정하지 않은 수업 {unsettled.length}건
          </p>
          <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--ink2)" }}>
            먼저 확정해 주세요. 담당을 바꾼 뒤에 확정하면 그 회차가 <b>새 강사의 급여</b>로 들어갑니다 — 수업한 사람은 {fromName || "전 강사"}인데요.
            {/* 확정 여부는 그 폰이 들고 있다. 대표 화면에서는 안 보일 수 있다. */}
            {" "}이 목록은 이 기기가 아는 것만입니다.
          </p>
        </div>
      ) : null}

      {plan.rows.length === 0 ? (
        <p className="text-xs" style={{ color: "var(--sub)" }}>
          넘길 회원권이 없습니다. 잔여가 남아 있고 만료되지 않은 것만 넘깁니다 — 끝난 회원권의 지난 수업료는 그대로 {fromName || "전 강사"}의 급여로 남습니다.
        </p>
      ) : (
        <>
          {/* 전부 한 사람에게. 퇴사 인계에서 가장 자주 쓰는 길이라 맨 위에 둔다. */}
          {plan.rows.length > 1 && allChoices.length > 0 ? (
            <div className="rounded-xl p-3" style={{ backgroundColor: "var(--canvas)" }}>
              <p className="text-xs font-extrabold" style={{ color: "var(--ink)" }}>전부 한 강사에게</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {allChoices.map((item) => (
                  <button type="button" key={item.userId} onClick={() => assignAll(item.userId)}
                    className="h-8 px-2.5 font-bold" style={{
                      borderRadius: 999, fontSize: "var(--t-caption)",
                      backgroundColor: "var(--card)", color: "var(--ink2)", border: "1px solid var(--line)",
                    }}>{item.displayName || item.userId.slice(0, 6)}</button>
                ))}
              </div>
              <p className="mt-2 text-caption" style={{ color: "var(--sub)" }}>
                누른 뒤 아래에서 회원별로 바꿀 수 있습니다.
              </p>
            </div>
          ) : null}

          <div className="space-y-1.5">
            {plan.rows.map((row) => {
              const choices = choicesFor(row.locationId);
              const blocked = row.blocks.length > 0;
              return (
                <div key={row.passId} className="rounded-xl p-3" style={{
                  backgroundColor: "var(--card)",
                  border: `1px solid ${blocked ? "var(--bad)" : "var(--line)"}`,
                }}>
                  <div className="flex items-baseline gap-2">
                    <p className="min-w-0 flex-1 truncate text-sm font-extrabold" style={{ color: "var(--ink)" }}>
                      {row.clientNames.length ? row.clientNames.join(" · ") : row.passId}
                      {row.isDuet ? <span className="font-bold" style={{ fontSize: "var(--t-caption)", color: "var(--sub)" }}> (2:1)</span> : null}
                    </p>
                    <p className="shrink-0 tabular-nums" style={{ fontSize: "var(--t-caption)", color: "var(--sub)" }}>잔여 {row.remaining}회</p>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {choices.length === 0 ? (
                      <p className="text-xs" style={{ color: "var(--bad)" }}>이 지점에 받을 수 있는 강사가 없습니다.</p>
                    ) : choices.map((item) => {
                      const on = row.toInstructorId === item.userId;
                      return (
                        <button type="button" key={item.userId}
                          onClick={() => setAssignments((value) => ({ ...value, [row.passId]: item.userId }))}
                          className="h-8 px-2.5 font-bold" style={{
                            borderRadius: 999, fontSize: "var(--t-caption)",
                            backgroundColor: on ? "var(--tint)" : "var(--canvas)",
                            color: on ? "var(--brand-d)" : "var(--sub)",
                          }}>{item.displayName || item.userId.slice(0, 6)}</button>
                      );
                    })}
                  </div>

                  {/* 인계 후 단가. **판정 2 라 정확히 말할 수 있다** -- 누적과
                      무관하게 남은 회차 전부가 신규 단가다. 그래서 이 줄이
                      값어치가 있다. */}
                  {row.toInstructorId && !blocked ? (
                    <p className="mt-2 flex items-center gap-1.5 tabular-nums" style={{ fontSize: "var(--t-caption)", color: "var(--sub)" }}>
                      인계 후 <ChevronRight size={11} /> <RateAfter row={row} />
                      <span>· 남은 {row.remaining}회 전부</span>
                    </p>
                  ) : null}

                  {blocked ? (
                    <p className="mt-2 text-xs font-bold" style={{ color: "var(--bad)" }}>
                      {row.blocks.map((code) => HANDOVER_BLOCK_LABEL[code] || code).join(" ")}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>

          {/* 누적은 따라가지 않는다는 것을 말한다 (2026-10-23 대표 결정).
              말하지 않으면 대표는 전처럼 합산되는 줄 알고, 새 강사의 첫
              재등록 단가가 왜 신규인지 설명하지 못한다. */}
          {plan.ready.length > 0 ? (
            <p className="text-caption leading-relaxed" style={{ color: "var(--sub)" }}>
              넘겨받은 회원권은 끝까지 신규 단가입니다. {fromName || "전 강사"}의 누적 수업 횟수는 <b>함께 넘어가지 않습니다</b> —
              새 강사의 누적은 새 강사가 실제로 한 수업만 셉니다.
            </p>
          ) : null}

          {offerRevoke ? (
            <label className="flex items-start gap-2 rounded-xl p-3" style={{ backgroundColor: "var(--canvas)" }}>
              <input type="checkbox" checked={revoke} onChange={(event) => setRevoke(event.target.checked)} className="mt-0.5" />
              <span>
                <span className="block text-xs font-extrabold" style={{ color: "var(--ink)" }}>넘긴 뒤 {fromName || "이 강사"}를 퇴사 처리</span>
                {/* 지우는 것이 아니다. 원장은 append-only 이고 각 항목이 그때의
                    instructorId 를 들고 있어 과거 급여는 그대로 남는다. */}
                <span className="mt-0.5 block text-caption leading-relaxed" style={{ color: "var(--sub)" }}>
                  로그인이 막힙니다. 지난 수업과 급여 기록은 그대로 남고, 대표 화면에서 마지막 달 급여를 조회할 수 있습니다.
                </span>
              </span>
            </label>
          ) : null}
        </>
      )}

      {errorCode ? (
        <p className="text-xs font-bold" style={{ color: "var(--bad)" }}>넘기지 못했어요 (코드 {errorCode})</p>
      ) : null}

      <div className="flex gap-2">
        <button type="button" onClick={onClose} disabled={busy}
          className="h-11 flex-1 font-bold disabled:opacity-40" style={{
            borderRadius: 9, backgroundColor: "var(--canvas)", color: "var(--sub)", fontSize: "var(--t-caption)",
          }}>닫기</button>
        <button type="button" disabled={!plan.canRun || busy || unsettled.length > 0}
          onClick={() => onRun?.({ plan, revoke: offerRevoke && revoke })}
          className="flex h-11 flex-[1.4] items-center justify-center gap-1.5 font-extrabold disabled:opacity-40" style={{
            borderRadius: 9, backgroundColor: "var(--brand)", color: "#fff", fontSize: "var(--t-caption)",
          }}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : null}
          {busy ? "넘기는 중" : `${plan.ready.length}장 넘기기`}
        </button>
      </div>
    </div>
  );
}
