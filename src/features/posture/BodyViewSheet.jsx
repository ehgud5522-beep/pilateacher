import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  BODY_VIEW_ALIGNMENT, POSTURE_VIEW_KEYS, bodyViewDragCommits, bodyViewMetrics,
  bodyViewPhotoId, composeBodyViewAlignment, containPhotoRect, postureMetricChangeText,
  postureMetricDisplayValue, postureViewLabel, reachableBodyViews, stepBodyView,
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

/* 처음 한 번, 결과가 놓이는 순서를 보여 준다: 사진이 서고, 잠깐 멈추고,
   수치가 하나씩 얹힌다. 다 합쳐 1초를 넘기지 않는다 -- 그 이상은 연출이
   아니라 기다림이다. 방향을 바꿀 때마다 되풀이하지 않는다. */
const PHOTO_FADE_MS = 300;
const INTRO_HOLD_MS = 200;
const MARKER_STEP_MS = 80;
const MARKER_TOTAL_MAX_MS = 400;

/* 손가락이 이만큼은 움직여야 방향을 바꾸려는 것으로 본다. 그 전에는 세로로
   가는지 가로로 가는지도 알 수 없다. */
const DRAG_AXIS_MIN_PX = 8;
/* 끝에서 더 밀면 따라오기는 하되 거의 움직이지 않는다. 넘어갈 곳이 없다는
   것을 손으로 알려 주는 것이지, 넘어가라는 뜻이 아니다. */
const DRAG_EDGE_RESISTANCE = 0.22;

const UNALIGNED_NOTE = "촬영 위치 차이로 자동 정렬이 적용되지 않았어요";
const MEASURED_FROM_NOTE = "전면·좌측면·후면·우측면 사진에서 측정한 값입니다";
const NO_PHOTO_NOTE = "이 기록에는 방향별 사진이 없어요";
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
  /* 방향마다 사진이 어떻게 됐는지: 아직 모름 / 떴음 / 없음. 없음을 따로 두지
     않으면 옛 기록에서 "불러오는 중"이 영원히 걸려 있는다. */
  const [photos, setPhotos] = useState({});
  /* 0 사진도 아직 / 1 사진이 뜨는 중 / 2 마커가 하나씩 / 3 다 놓임 */
  const [introStage, setIntroStage] = useState(reduced ? 3 : 0);
  const [revealed, setRevealed] = useState(0);
  /* 사진마다 가로세로가 다르다. 마커를 앉힐 사각형을 세우려면 그 비율이
     필요하고, 그것은 사진이 실제로 뜬 뒤에야 알 수 있다. */
  const [natural, setNatural] = useState({});
  const [frameSize, setFrameSize] = useState(null);
  const [dragDx, setDragDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const timers = useRef([]);
  const introTimers = useRef([]);
  const introStarted = useRef(false);
  const drag = useRef({ id: null, x0: 0, y0: 0, axis: null, dx: 0 });
  const frame = useRef(null);
  const placedCount = useRef(0);

  useEffect(() => () => {
    timers.current.forEach(clearTimeout); timers.current = [];
    introTimers.current.forEach(clearTimeout); introTimers.current = [];
  }, []);

  /* 틀의 크기는 기기와 회전에 따라 달라진다. 마커 자리를 그 안에서 구하므로
     크기가 바뀌면 다시 재야 한다. */
  useEffect(() => {
    const node = frame.current;
    if (!node) return undefined;
    const read = () => setFrameSize({ width: node.clientWidth, height: node.clientHeight });
    read();
    if (typeof ResizeObserver !== "function") return undefined;
    const observer = new ResizeObserver(read);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  /* 조작이 들어오면 연출은 거기서 끝난다. 보여 주려던 것보다 하려던 것이
     먼저다 -- 연출이 손을 막으면 그것은 고장으로 느껴진다. */
  const finishIntro = useCallback(() => {
    introTimers.current.forEach(clearTimeout);
    introTimers.current = [];
    introStarted.current = true;
    setIntroStage(3);
    setRevealed(Number.MAX_SAFE_INTEGER);
  }, []);

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
        /* 뼈대 없는 760px 사본만 쓴다. 원본은 뼈대가 구워진 큰 이미지라 이
           화면에서 쓰지 않는다 -- 사본이 없으면 없는 것으로 끝낸다. */
        const photoId = bodyViewPhotoId(assessment, view);
        const url = photoId ? await resolvePhotoUrl(photoId) : null;
        if (!alive) return;
        const next = url ? { status: "ready", url } : { status: "missing" };
        setPhotos((previous) => (previous[view]?.url === next.url && previous[view]?.status === next.status
          ? previous
          : { ...previous, [view]: next }));
      }
    })();
    return () => { alive = false; };
  }, [assessment, activeView, shot, resolvePhotoUrl]);

  const switchTo = useCallback((view) => {
    if (!view || view === activeView) return;
    finishIntro();
    setOpenMetricId(null);
    setActiveView(view);
    if (reduced) { setShownView(view); setPhase("idle"); return; }
    setPhase("out");
    timers.current.forEach(clearTimeout);
    timers.current = [
      setTimeout(() => { setShownView(view); setPhase("in"); }, FADE_OUT_MS),
      setTimeout(() => setPhase("idle"), FADE_OUT_MS + FADE_IN_MS),
    ];
  }, [activeView, reduced, finishIntro]);


  /* 드래그로 갈 수 있는 방향. 찍지 않은 방향과 사진이 없는 방향은 뛰어넘는다
     -- 손가락으로 밀어서 빈 화면에 도착하면 밀다 만 것처럼 느껴진다.

     버튼은 그대로 둔다. 버튼은 "저기로 가겠다"는 지목이고 드래그는 몸을 따라
     도는 동작이라, 같은 자리를 두 조작이 다르게 다뤄도 어색하지 않다. */
  const reachable = useMemo(() => reachableBodyViews(assessment, {
    unreadable: Object.keys(photos).filter((view) => photos[view]?.status === "missing"),
  }), [assessment, photos]);

  const stepFrom = useCallback((view, direction) => stepBodyView(reachable, view, direction), [reachable]);

  const onPointerDown = useCallback((event) => {
    if (drag.current.id !== null) return;
    drag.current = { id: event.pointerId, x0: event.clientX, y0: event.clientY, axis: null, dx: 0 };
  }, []);

  const onPointerMove = useCallback((event) => {
    if (drag.current.id !== event.pointerId) return;
    const dx = event.clientX - drag.current.x0;
    const dy = event.clientY - drag.current.y0;
    if (!drag.current.axis) {
      if (Math.abs(dx) < DRAG_AXIS_MIN_PX && Math.abs(dy) < DRAG_AXIS_MIN_PX) return;
      /* 세로가 이기면 이 손짓은 화면을 굴리려는 것이다. 그대로 놓아 준다. */
      drag.current.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (drag.current.axis === "x") {
        finishIntro();
        setDragging(true);
        try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch (_error) { /* 없어도 up 은 온다 */ }
      }
    }
    if (drag.current.axis !== "x") return;
    drag.current.dx = dx;
    /* 갈 곳이 없는 쪽으로는 거의 따라가지 않는다. */
    const blocked = !stepFrom(shownView, dx < 0 ? 1 : -1);
    if (!reduced) setDragDx(blocked ? dx * DRAG_EDGE_RESISTANCE : dx);
  }, [finishIntro, reduced, shownView, stepFrom]);

  const endDrag = useCallback(() => {
    const { axis, dx } = drag.current;
    drag.current = { id: null, x0: 0, y0: 0, axis: null, dx: 0 };
    setDragging(false);
    setDragDx(0);
    if (axis !== "x") return;
    /* 임계에 못 미치면 아무 일도 없었던 것으로 돌아간다. */
    if (!bodyViewDragCommits(dx, frame.current?.clientWidth || 0)) return;
    const target = stepFrom(shownView, dx < 0 ? 1 : -1);
    if (target) switchTo(target);
  }, [shownView, stepFrom, switchTo]);

  const shownEntry = entries.find((entry) => entry.view === shownView) || null;
  const metrics = useMemo(
    () => (shownView ? bodyViewMetrics(assessment, shownView, { previousAssessment }) : []),
    [assessment, shownView, previousAssessment],
  );
  /* 사진 위에 앉을 수 있는 값과 그럴 수 없는 값. 뒤쪽은 목록으로만 보여 준다. */
  const placed = metrics.filter((metric) => metric.at);
  const unplaced = metrics.filter((metric) => !metric.at);
  const openMetric = metrics.find((metric) => metric.id === openMetricId) || null;
  const shownPhoto = photos[shownView] || null;
  const naturalSize = natural[shownView] || null;
  const photoRect = containPhotoRect(frameSize, naturalSize);
  placedCount.current = placed.length;
  /* 방향이 완전히 서 있을 때만 마커를 얹는다. 넘어가는 도중에도, 손가락에
     끌려가는 동안에도 얹지 않는다 -- 아직 지워지지 않은 몸 위에 다음 방향의
     수치가 찍히기 때문이다. */
  const markersVisible = phase === "idle" && !dragging && introStage >= 2 && !!shownEntry;
  /* 마커는 사진 위의 한 자리를 가리킨다. 사진이 없으면 가리킬 자리도 없어서,
     검은 바탕에 뜬 숫자가 되고 없다는 안내마저 가린다. 목록은 그대로 낸다. */
  const photoMarkersVisible = markersVisible && shownPhoto?.status === "ready" && !!photoRect;

  /* 사진이 처음 뜬 그 순간부터 한 번만. 시트를 닫으면 이 컴포넌트가 사라지므로
     다시 열면 처음이 맞다. */
  useEffect(() => {
    if (introStarted.current) return undefined;
    const settled = photos[shownView]?.status;
    if (settled !== "ready" && settled !== "missing") return undefined;
    introStarted.current = true;
    /* 보여 줄 사진이 없으면 놓을 순서도 없다. 목록은 기다리지 않고 내준다. */
    if (reduced || settled === "missing") { setIntroStage(3); setRevealed(Number.MAX_SAFE_INTEGER); return undefined; }
    const count = Math.max(1, placedCount.current);
    const step = Math.min(MARKER_STEP_MS, MARKER_TOTAL_MAX_MS / count);
    const queued = [setTimeout(() => setIntroStage(1), 0), setTimeout(() => setIntroStage(2), PHOTO_FADE_MS + INTRO_HOLD_MS)];
    for (let index = 1; index <= count; index += 1) {
      queued.push(setTimeout(() => setRevealed(index), PHOTO_FADE_MS + INTRO_HOLD_MS + step * index));
    }
    queued.push(setTimeout(() => setIntroStage(3), PHOTO_FADE_MS + INTRO_HOLD_MS + step * count));
    introTimers.current = queued;
    return undefined;
  }, [photos, shownView, reduced]);


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

      {/* touchAction: pan-y 로 세로는 브라우저에 맡기고 가로만 받는다. */}
      <div
        ref={frame}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="relative mx-3 mt-2 flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-2xl"
        style={{ backgroundColor: "var(--photo)", touchAction: "pan-y" }}
      >
        {shownPhoto?.status === "ready" ? (
          /* 사진은 세로로 긴 틀 안에 비율을 지켜 들어가므로 위아래에 검은 여백이
             남는다. 마커 좌표는 사진 안의 비율이지 틀 안의 비율이 아니다 -- 틀에
             그대로 대면 그 여백만큼 몸에서 떠올라 붙는다.

             사진이 실제로 차지하는 사각형을 만들어 두고 사진과 마커를 둘 다 그
             안에 넣는다. 여백을 손으로 계산하지 않아도 어긋나지 않는다. */
          <div
            className="absolute"
            style={photoRect
              ? { left: photoRect.left, top: photoRect.top, width: photoRect.width, height: photoRect.height }
              : { inset: 0 }}
          >
            <img
              src={shownPhoto.url}
              alt=""
              /* 크기는 지금 읽어 둔다. 갱신 함수는 나중에 실행되고, 그때
                 currentTarget 은 이미 비워져 있다. */
              onLoad={(event) => {
                const { naturalWidth: width, naturalHeight: height } = event.currentTarget;
                if (!width || !height) return;
                setNatural((previous) => (previous[shownView] ? previous : { ...previous, [shownView]: { width, height } }));
              }}
              className="absolute inset-0 h-full w-full object-contain"
              style={{
                opacity: phase === "out" || introStage === 0 ? 0 : 1,
                transition: reduced ? "none"
                  : introStage === 1 ? `opacity ${PHOTO_FADE_MS}ms ease-out`
                  : `opacity ${phase === "out" ? FADE_OUT_MS : FADE_IN_MS}ms linear`,
                /* 손가락만큼 옮겨 놓을 뿐 몸을 휘게 하지 않는다. 정렬이 준
                   배율·위치는 그대로 두고 그 바깥에 이동만 얹는다. */
                transform: `translateX(${dragDx}px)${shownEntry?.transform
                  ? ` translate(${shownEntry.transform.offsetX * 100}%, ${shownEntry.transform.offsetY * 100}%) scale(${shownEntry.transform.scale})`
                  : ""}`,
                willChange: dragging ? "transform" : "auto",
              }}
            />

            {photoMarkersVisible && placed.map((metric, index) => (
              <button
                key={metric.id}
                hidden={index >= revealed}
                type="button"
                onClick={() => setOpenMetricId((current) => (current === metric.id ? null : metric.id))}
                aria-label={`${metric.label} 자세히`}
                className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full px-2 py-1 text-[10px] font-extrabold tabular-nums"
                style={{ ...placeOnFrame(metric.at, shownEntry?.transform), backgroundColor: "var(--card)", color: "var(--ink)", boxShadow: "var(--shadow)", opacity: openMetricId && openMetricId !== metric.id ? 0.45 : 1 }}
              >
                {postureMetricDisplayValue(metric.value, metric.unit)}{metric.unit}
              </button>
            ))}
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
            <p className="text-xs font-bold" style={{ color: "var(--faint)" }}>{shownPhoto?.status === "missing" ? NO_PHOTO_NOTE : "사진을 불러오는 중"}</p>
          </div>
        )}

        {openMetric && <MetricDetail metric={openMetric} onClose={() => setOpenMetricId(null)} />}
      </div>

      {/* 잰 자리를 말할 수 없는 값은 사진 밖에 둔다. 수치는 그대로 남기고,
          몸의 어디라고는 말하지 않는다. */}
      {markersVisible && unplaced.length > 0 && (
        <div className="mx-3 mt-2 flex flex-wrap gap-1.5">
          {unplaced.map((metric) => (
            <button
              key={metric.id}
              type="button"
              onClick={() => setOpenMetricId((current) => (current === metric.id ? null : metric.id))}
              className="rounded-full px-2.5 py-1 text-[11px] font-bold"
              style={{ backgroundColor: "var(--canvas)", color: "var(--ink2)" }}
            >
              {metric.label} <span className="font-extrabold tabular-nums" style={{ color: "var(--ink)" }}>{postureMetricDisplayValue(metric.value, metric.unit)}{metric.unit}</span>
            </button>
          ))}
        </div>
      )}

      {/* 정렬이 안 된 방향에도 사진은 멀쩡히 떠 있다. 고장이 아니므로 크게
          경고하지 않고, 크기가 왜 다른지만 한 줄로 말한다. */}
      {shownEntry && shownEntry.hasPose && shownEntry.status !== BODY_VIEW_ALIGNMENT.aligned && (
        <p className="mx-3 mt-2 text-[11px]" style={{ color: "var(--sub)" }}>{UNALIGNED_NOTE}</p>
      )}

      <div className="safe-b px-3 pt-2">
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
