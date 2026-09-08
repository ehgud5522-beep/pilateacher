import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  BODY_VIEW_ALIGNMENT, POSTURE_VIEW_KEYS, assessmentMediaForView, bodyViewMetrics,
  composeBodyViewAlignment, postureMetricChangeText, postureMetricDisplayValue,
  postureViewLabel,
} from "./posture-model.js";

/* 촬영한 네 방향을 한 화면에서 갈아 끼우며 본다.

   만드는 것은 없다. 찍은 사진 네 장을 방향별로 보여 주고, 그 방향에서 잰
   값만 그 사진 위에 얹는다. 몸의 모형을 세우지 않고, 찍지 않은 각도를
   그리지 않는다.

   방향마다 카메라와의 거리도 회원이 선 자리도 조금씩 다르므로, 한 방향을
   기준으로 배율과 위치만 맞춰서 보여 준다. 맞추지 못하는 방향은 원본 그대로
   둔다 -- 억지로 늘리면 없는 몸을 만드는 셈이다. */

/* 갈아 끼울 때 두 몸이 겹쳐 보이면 한 사람이 두 명으로 보인다. 그래서 겹치는
   구간을 두지 않는다: 먼저 지우고, 그 다음에 그린다. */
const FADE_OUT_MS = 110;
const FADE_IN_MS = 130;

const UNALIGNED_NOTE = "촬영 위치 차이로 자동 정렬이 적용되지 않았어요";
const MEASURED_FROM_NOTE = "정면·좌측면·후면·우측면 사진에서 측정한 값입니다";
const NOT_A_MODEL_NOTE = "360° 바디뷰는 촬영한 사진을 방향별로 보여주는 기능이며 실제 3D 신체 모델을 생성하지 않습니다";
const UNSHOT_NOTE = "촬영하면 이 방향도 확인할 수 있어요";

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => {
    try { return Boolean(globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches); }
    catch (_error) { return false; }
  });
  useEffect(() => {
    let query;
    try { query = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)"); } catch (_error) { return undefined; }
    if (!query) return undefined;
    const onChange = (event) => setReduced(Boolean(event.matches));
    query.addEventListener?.("change", onChange);
    return () => query.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}

/* 마커가 화면 어디에 찍히는가. 사진에 건 것과 똑같은 배율·이동을 좌표에도
   걸어야 몸에서 떨어지지 않는다. 글자 크기까지 함께 커지면 읽기 어려우므로
   사진을 늘리는 대신 좌표만 옮긴다. */
function placeOnFrame(point, transform) {
  const scale = Number(transform?.scale) || 1;
  const offsetX = Number(transform?.offsetX) || 0;
  const offsetY = Number(transform?.offsetY) || 0;
  return {
    left: `${(0.5 + scale * (point.x - 0.5) + offsetX) * 100}%`,
    top: `${(0.5 + scale * (point.y - 0.5) + offsetY) * 100}%`,
  };
}

function MetricDetail({ metric, onClose }) {
  const unit = metric.unit || "";
  const change = metric.difference === null ? null : postureMetricChangeText(metric.difference, unit);
  return (
    <div className="absolute inset-x-3 bottom-3 rounded-2xl p-3" style={{ backgroundColor: "var(--card)", boxShadow: "var(--shadow)" }}>
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-extrabold" style={{ color: "var(--ink)" }}>{metric.label}</span>
        <button type="button" onClick={onClose} className="shrink-0 px-2 text-xs font-bold" style={{ color: "var(--sub)" }}>닫기</button>
      </div>
      <dl className="mt-2 space-y-1.5">
        <div className="flex items-baseline gap-2">
          <dt className="w-16 shrink-0 text-[11px] font-bold" style={{ color: "var(--sub)" }}>이번 측정</dt>
          <dd className="text-sm font-extrabold tabular-nums" style={{ color: "var(--ink)" }}>{postureMetricDisplayValue(metric.value, unit)}{unit}</dd>
        </div>
        {/* 이전 회차가 없는 회원에게는 이 줄 자체를 만들지 않는다. 빈 칸을
            남겨 두면 값이 사라진 것처럼 읽힌다. */}
        {metric.previousValue !== null && (
          <div className="flex items-baseline gap-2">
            <dt className="w-16 shrink-0 text-[11px] font-bold" style={{ color: "var(--sub)" }}>이전 측정</dt>
            <dd className="text-sm font-extrabold tabular-nums" style={{ color: "var(--ink2)" }}>{postureMetricDisplayValue(metric.previousValue, unit)}{unit}</dd>
          </div>
        )}
        {change && (
          <div className="flex items-baseline gap-2">
            <dt className="w-16 shrink-0 text-[11px] font-bold" style={{ color: "var(--sub)" }}>변화</dt>
            <dd className="text-xs font-bold" style={{ color: "var(--ink2)" }}>{change}</dd>
          </div>
        )}
        {metric.measuredAt && (
          <div className="flex items-baseline gap-2">
            <dt className="w-16 shrink-0 text-[11px] font-bold" style={{ color: "var(--sub)" }}>측정일</dt>
            <dd className="text-xs font-bold tabular-nums" style={{ color: "var(--ink2)" }}>{String(metric.measuredAt).slice(0, 10)}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

export default function BodyViewSheet({ assessment, previousAssessment = null, resolvePhotoUrl, onClose }) {
  const reduced = usePrefersReducedMotion();
  const alignment = useMemo(() => composeBodyViewAlignment(assessment), [assessment]);
  /* 부위 촬영은 방향이 아니다. 네 방향만 다룬다. */
  const entries = alignment.views;
  const shot = useMemo(() => entries.filter((entry) => entry.hasPhoto), [entries]);
  const firstView = alignment.baseView || shot[0]?.view || null;

  const [activeView, setActiveView] = useState(firstView);
  const [shownView, setShownView] = useState(firstView);
  const [phase, setPhase] = useState("idle");
  const [openMetricId, setOpenMetricId] = useState(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [urls, setUrls] = useState({});
  const timers = useRef([]);

  useEffect(() => () => { timers.current.forEach(clearTimeout); timers.current = []; }, []);

  /* 다시 열었을 때 지난번 방향이 남아 있으면, 그 방향이 이번 기록에 없을 수
     있다. 기록이 바뀌면 기준 방향에서 다시 시작한다. */
  useEffect(() => {
    setActiveView(firstView);
    setShownView(firstView);
    setPhase("idle");
    setOpenMetricId(null);
  }, [assessment?.id, firstView]);

  /* 네 장을 한꺼번에 들고 있지 않는다. 지금 보는 것과 그 양옆까지만 준비하고,
     화면에 거는 것은 지금 보는 한 장뿐이다. */
  useEffect(() => {
    if (!activeView || typeof resolvePhotoUrl !== "function") return undefined;
    let alive = true;
    const order = POSTURE_VIEW_KEYS;
    const at = order.indexOf(activeView);
    const wanted = [order[at], order[(at + 1) % order.length], order[(at - 1 + order.length) % order.length]]
      .filter((view) => shot.some((entry) => entry.view === view));
    (async () => {
      for (const view of wanted) {
        const media = assessmentMediaForView(assessment, view);
        /* cleanBlobId 는 분석에 쓴 760px 사진이다. 원본은 이 화면이 감당할
           크기가 아니라 쓰지 않는다. */
        const blobId = media?.cleanBlobId;
        if (!blobId) continue;
        const url = await resolvePhotoUrl(blobId);
        if (!alive || !url) continue;
        setUrls((previous) => (previous[view] === url ? previous : { ...previous, [view]: url }));
      }
    })();
    return () => { alive = false; };
  }, [assessment, activeView, shot, resolvePhotoUrl]);

  const switchTo = useCallback((view) => {
    if (!view || view === activeView) return;
    setOpenMetricId(null);
    setActiveView(view);
    if (reduced) { setShownView(view); setPhase("idle"); return; }
    setPhase("out");
    timers.current.forEach(clearTimeout);
    timers.current = [
      setTimeout(() => { setShownView(view); setPhase("in"); }, FADE_OUT_MS),
      setTimeout(() => setPhase("idle"), FADE_OUT_MS + FADE_IN_MS),
    ];
  }, [activeView, reduced]);

  const shownEntry = entries.find((entry) => entry.view === shownView) || null;
  const metrics = useMemo(
    () => (shownView ? bodyViewMetrics(assessment, shownView, { previousAssessment }) : []),
    [assessment, shownView, previousAssessment],
  );
  const openMetric = metrics.find((metric) => metric.id === openMetricId) || null;
  /* 방향이 완전히 서 있을 때만 마커를 얹는다. 넘어가는 도중에 얹으면 아직
     지워지지 않은 몸 위에 다음 방향의 수치가 찍힌다. */
  const markersVisible = phase === "idle" && !!shownEntry;

  if (!firstView) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ backgroundColor: "var(--page)" }}>
      <div className="flex items-center gap-2 px-3 pt-3">
        <button type="button" onClick={onClose} aria-label="닫기" className="h-11 px-3 text-xs font-bold" style={{ color: "var(--sub)" }}>뒤로</button>
        <span className="min-w-0 flex-1 text-center text-sm font-extrabold" style={{ color: "var(--ink)" }}>360° 바디뷰</span>
        <button type="button" onClick={() => setHelpOpen((open) => !open)} aria-label="바디뷰 설명" aria-expanded={helpOpen} className="h-11 w-11 text-sm font-extrabold" style={{ color: "var(--sub)" }}>?</button>
      </div>

      {helpOpen && (
        <p className="mx-3 mt-1 rounded-xl px-3 py-2 text-[11px] leading-relaxed" style={{ backgroundColor: "var(--canvas)", color: "var(--ink2)" }}>{NOT_A_MODEL_NOTE}</p>
      )}

      <div className="relative mx-3 mt-2 min-h-0 flex-1 overflow-hidden rounded-2xl" style={{ backgroundColor: "var(--photo)" }}>
        {urls[shownView] ? (
          <img
            src={urls[shownView]}
            alt=""
            className="absolute inset-0 h-full w-full object-contain"
            style={{
              opacity: phase === "out" ? 0 : 1,
              transition: reduced ? "none" : `opacity ${phase === "out" ? FADE_OUT_MS : FADE_IN_MS}ms linear`,
              transform: shownEntry?.transform
                ? `translate(${shownEntry.transform.offsetX * 100}%, ${shownEntry.transform.offsetY * 100}%) scale(${shownEntry.transform.scale})`
                : "none",
            }}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
            <p className="text-xs font-bold" style={{ color: "var(--faint)" }}>사진을 불러오는 중</p>
          </div>
        )}

        {markersVisible && metrics.map((metric) => (
          <button
            key={metric.id}
            type="button"
            onClick={() => setOpenMetricId((current) => (current === metric.id ? null : metric.id))}
            aria-label={`${metric.label} 자세히`}
            className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full px-2 py-1 text-[10px] font-extrabold tabular-nums"
            style={{ ...placeOnFrame(metric.at, shownEntry?.transform), backgroundColor: "var(--card)", color: "var(--ink)", boxShadow: "var(--shadow)", opacity: openMetricId && openMetricId !== metric.id ? 0.45 : 1 }}
          >
            {postureMetricDisplayValue(metric.value, metric.unit)}{metric.unit}
          </button>
        ))}

        {openMetric && <MetricDetail metric={openMetric} onClose={() => setOpenMetricId(null)} />}
      </div>

      {/* 정렬이 안 된 방향에도 사진은 멀쩡히 떠 있다. 고장이 아니므로 크게
          경고하지 않고, 크기가 왜 다른지만 한 줄로 말한다. */}
      {shownEntry && shownEntry.hasPose && shownEntry.status !== BODY_VIEW_ALIGNMENT.aligned && (
        <p className="mx-3 mt-2 text-[11px]" style={{ color: "var(--sub)" }}>{UNALIGNED_NOTE}</p>
      )}

      <div className="px-3 pb-3 pt-2">
        <div className="grid grid-cols-4 gap-1.5">
          {entries.map((entry) => {
            const on = entry.view === activeView;
            return (
              <button
                key={entry.view}
                type="button"
                disabled={!entry.hasPhoto}
                aria-pressed={on}
                onClick={() => switchTo(entry.view)}
                className="h-10 text-xs font-bold"
                style={{
                  borderRadius: 10,
                  backgroundColor: on ? "var(--tint)" : "var(--canvas)",
                  color: entry.hasPhoto ? (on ? "var(--brand)" : "var(--ink2)") : "var(--faint)",
                }}
              >
                {postureViewLabel(entry.view)}
              </button>
            );
          })}
        </div>
        {entries.some((entry) => !entry.hasPhoto) && (
          <p className="mt-2 text-[11px]" style={{ color: "var(--sub)" }}>{UNSHOT_NOTE}</p>
        )}
        <p className="mt-2 text-[11px]" style={{ color: "var(--sub)" }}>{MEASURED_FROM_NOTE}</p>
      </div>
    </div>
  );
}
