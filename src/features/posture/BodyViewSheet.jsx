import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  BODY_VIEW_ALIGNMENT, POSTURE_VIEW_KEYS, bodyViewDragCommits, bodyViewDragFrame,
  bodyViewDragProgress, bodyViewMetrics,
  bodyViewMarkerFraction, bodyViewMaskId, bodyViewPhotoId, clampLabelWithin, composeBodyViewAlignment,
  containPhotoRect, normalizePostureView, postureMetricChangeText, postureMetricDisplayValue,
  postureViewLabel, reachableBodyViews, stepBodyView,
} from "./posture-model.js";
import { closeBodySegmenter, composePersonCutout, personMaskPng } from "./body-segmenter.js";
import { isFullyManualAfterAiMiss } from "./result-presentation.js";

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
/* 알약을 안으로 밀어 넣을 때 쓸 대략의 크기. 글자를 재지 않고 글자 수로
   가늠한다 -- 몇 px 어긋나도 밀어 넣는 자리가 조금 달라질 뿐이고, 점은 잰
   자리에 그대로 있다. */
const MARKER_LABEL_CHAR_PX = 7;
const MARKER_LABEL_PAD_PX = 20;
const MARKER_LABEL_HEIGHT_PX = 24;

const DRAG_AXIS_MIN_PX = 8;
/* 손을 뗀 뒤 제자리를 찾아가는 시간. 끌던 손을 놓았을 때 뚝 끊기지 않을
   만큼만 짧게 -- 여기서 더 길어지면 기다림이 된다. */
const DRAG_SETTLE_MS = 190;

const UNALIGNED_NOTE = "촬영 위치 차이로 자동 정렬이 적용되지 않았어요";
const MEASURED_FROM_NOTE = "전면·좌측면·후면·우측면 사진에서 측정한 값입니다";
const NO_PHOTO_NOTE = "이 기록에는 방향별 사진이 없어요";
const NOT_A_MODEL_NOTE = "360° 바디뷰는 촬영한 사진을 방향별로 보여주는 기능이며 실제 3D 신체 모델을 생성하지 않습니다";
const UNSHOT_NOTE = "촬영하면 이 방향도 확인할 수 있어요";

/* 그릴 것이 있는 곳에서만 레이아웃 단계에 붙는다. 문자열로 찍어 내는
   곳에는 붙일 DOM 이 없고, 그때 useLayoutEffect 는 경고만 남긴다. */
const useAfterPaint = typeof window === "undefined" ? useEffect : useLayoutEffect;

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


/* 마스크를 씌우려면 사진과 마스크가 둘 다 픽셀로 있어야 한다. */
function decodeImage(src) {
  return new Promise((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
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

export default function BodyViewSheet({ assessment, previousAssessment = null, resolvePhotoUrl, onSaveMask, onSegmenterEvent, onClose }) {
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
  /* 방향별로 사람만 남긴 그림: 만드는 중 / 됐음 / 안 됨. */
  const [cutouts, setCutouts] = useState({});
  const cutoutRuns = useRef({});
  /* 화면이 아직 붙어 있는가. 이 하나만 본다 -- 실행마다 플래그를 두면
     의존성이 바뀔 때마다 정리 함수가 돌아 멀쩡한 결과를 버린다. */
  const onScreen = useRef(true);
  const [dragging, setDragging] = useState(false);
  /* 손가락을 따라가는 동안 화면에 함께 놓이는 다음 방향. 방향이 바뀔 때만
     -- 한 손짓에 많아야 한두 번 -- 다시 그린다. */
  const [dragTarget, setDragTarget] = useState(null);
  const timers = useRef([]);
  const introTimers = useRef([]);
  const introStarted = useRef(false);
  const drag = useRef({ id: null, x0: 0, y0: 0, axis: null, dx: 0 });
  const frame = useRef(null);
  const placedCount = useRef(0);
  /* 미는 동안 매 프레임 건드리는 것은 transform 과 opacity 뿐이다. 이것을
     state 로 두면 프레임마다 컴포넌트가 통째로 다시 그려지고, 정렬도 마커
     자리도 다시 셈하게 된다 -- 값싼 기기에서 그대로 끊긴다. */
  const stage = useRef(null);
  const incoming = useRef(null);
  const dots = useRef({});
  const progress = useRef(0);
  const painting = useRef(0);
  const settling = useRef(0);
  const aim = useRef(null);

  useEffect(() => {
    /* 처음 값에만 기대지 않는다. StrictMode 는 같은 인스턴스를 한 번
       떼었다 붙이므로, ref 는 살아남고 플래그만 꺼진 채로 남는다. */
    onScreen.current = true;
    return () => {
      timers.current.forEach(clearTimeout); timers.current = [];
      introTimers.current.forEach(clearTimeout); introTimers.current = [];
      if (painting.current) cancelAnimationFrame(painting.current);
      if (settling.current) cancelAnimationFrame(settling.current);
      painting.current = 0; settling.current = 0;
      onScreen.current = false;
      /* 모델은 화면과 함께 놓아준다. */
      closeBodySegmenter();
    };
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

  /* 손가락이 있는 자리를 화면에 그대로 옮긴다. 진행도 하나를 읽어 두 겹의
     transform 과 opacity, 그리고 자리 표시 점만 고쳐 쓴다 -- React 를
     거치지 않으므로 프레임마다 다시 그려지는 것이 없다. */
  const paint = useCallback(() => {
    painting.current = 0;
    const width = frame.current?.clientWidth || 0;
    const { shift, squeeze, showTarget } = bodyViewDragFrame(progress.current);
    /* 뒤에 세울 몸이 실제로 있을 때만 앞의 몸을 감춘다. 사진을 아직 못
       읽은 방향으로 넘어가는 중이면 감출 것이 아니라 그대로 두어야 한다
       -- 아니면 도는 도중에 빈 화면이 지나간다. */
    const turned = showTarget && aim.current && incoming.current ? aim.current : null;
    const css = `translateX(${shift * width}px) scaleX(${squeeze})`;
    if (stage.current) {
      stage.current.style.transform = css;
      stage.current.style.opacity = turned ? "0" : "1";
    }
    if (incoming.current) {
      incoming.current.style.transform = css;
      incoming.current.style.opacity = turned ? "1" : "0";
    }
    /* 점도 몸과 같은 순간에 넘어간다. 눈에는 다음 방향이 서 있는데 점은
       아직 이전 방향이면, 둘 중 어느 쪽이 맞는지 알 수 없다. */
    const eye = turned || shownView;
    for (const view of POSTURE_VIEW_KEYS) {
      const node = dots.current[view];
      if (node) node.style.backgroundColor = view === eye ? "var(--brand)" : "transparent";
    }
  }, [shownView]);

  /* React 가 다시 그리면 인라인 스타일도 함께 되돌아간다. 그린 직후에 다시
     얹어 두어야 손가락 자리와 화면이 어긋나지 않는다. */
  useAfterPaint(() => { paint(); });

  const askForFrame = useCallback(() => {
    if (painting.current) return;
    painting.current = requestAnimationFrame(paint);
  }, [paint]);

  /* 손을 떼면 가까운 쪽으로 붙는다. 넘어가는 쪽이면 진행도를 끝까지 밀어
     두고 -- 끝에서는 다음 방향이 제자리에 똑바로 서 있다 -- 바로 그 자리에서
     방향을 갈아 끼운다. 그래서 갈아 끼우는 순간에 화면이 튀지 않는다. */
  const settle = useCallback((target, sign) => {
    const from = progress.current;
    const to = target ? sign : 0;
    const land = () => {
      settling.current = 0;
      progress.current = 0;
      aim.current = null;
      setDragTarget(null);
      setDragging(false);
      if (target) {
        setOpenMetricId(null);
        setActiveView(target);
        setShownView(target);
        setPhase("idle");
      }
      paint();
    };
    if (reduced || from === to) { land(); return; }
    const started = Date.now();
    const step = () => {
      const t = Math.min(1, (Date.now() - started) / DRAG_SETTLE_MS);
      /* 끝으로 갈수록 느려진다. 일정한 속도로 붙으면 자석처럼 끊긴다. */
      progress.current = from + (to - from) * (1 - (1 - t) * (1 - t));
      paint();
      if (t < 1) { settling.current = requestAnimationFrame(step); return; }
      land();
    };
    settling.current = requestAnimationFrame(step);
  }, [paint, reduced]);

  const onPointerDown = useCallback((event) => {
    if (drag.current.id !== null) return;
    /* 붙어 가던 중이라도 손이 다시 닿으면 손이 이긴다. 그대로 두면 두
       가지가 같은 값을 서로 밀어 화면이 떤다. */
    if (settling.current) { cancelAnimationFrame(settling.current); settling.current = 0; }
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
        /* 마커를 감추는 것은 몸이 움직이기 때문이다. 움직이지 않기로 한
           기기에서는 감출 이유도 없다 -- 감췄다 켜는 것 자체가 움직임이다. */
        if (!reduced) setDragging(true);
        try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch (_error) { /* 없어도 up 은 온다 */ }
      }
    }
    if (drag.current.axis !== "x") return;
    drag.current.dx = dx;
    const target = stepFrom(shownView, dx < 0 ? 1 : -1);
    /* 갈 곳이 없는 쪽이면 저항만 준다. 아무리 밀어도 절반에 닿지 않으므로
       다음 방향의 몸이 서는 일도, 넘어가는 일도 없다. */
    if (reduced) return;
    if (target !== aim.current) { aim.current = target; setDragTarget(target); }
    progress.current = bodyViewDragProgress(dx, frame.current?.clientWidth || 0, { blocked: !target });
    askForFrame();
  }, [askForFrame, finishIntro, reduced, shownView, stepFrom]);

  const endDrag = useCallback(() => {
    const { axis, dx } = drag.current;
    drag.current = { id: null, x0: 0, y0: 0, axis: null, dx: 0 };
    if (axis !== "x") { setDragging(false); return; }
    const target = stepFrom(shownView, dx < 0 ? 1 : -1);
    /* 절반에 못 미치면 원래 방향으로 돌아간다. */
    const commits = Boolean(target) && bodyViewDragCommits(dx, frame.current?.clientWidth || 0);
    settle(commits ? target : null, dx < 0 ? -1 : 1);
  }, [settle, shownView, stepFrom]);

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
  const shownCutout = cutouts[shownView] || null;
  /* 손가락을 따라 들어오는 방향. 사람만 남긴 그림이 이미 있으면 그것을
     쓴다 -- 들어올 때 배경이 있다가 자리를 잡고 나서 사라지면, 넘어간
     것이 아니라 화면이 한 번 더 바뀐 것처럼 보인다. */
  const aimEntry = dragTarget ? entries.find((entry) => entry.view === dragTarget) || null : null;
  const aimPhoto = dragTarget ? photos[dragTarget] || null : null;
  const aimCutout = dragTarget ? cutouts[dragTarget] || null : null;
  /* 결과 화면이 쓰는 그 판정을 그대로 읽는다. 새로 매기지 않는다 -- 두 화면이
     같은 기록을 두고 다른 말을 하면 어느 쪽을 믿을지 알 수 없다.
     화면이 한 방향씩 보여 주므로 그 방향의 pose 에 대고 묻는다. */
  const shownIsManualOnly = isFullyManualAfterAiMiss((assessment?.poses || [])
    .find((pose) => normalizePostureView(pose?.view) === shownView) || null);
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



  /* 사람만 남긴 그림을 만든다. 지금 보는 방향 하나만 -- 네 장을 한꺼번에
     돌리면 값싼 기기가 멈춘다.

     이미 만들어 둔 마스크가 있으면 읽고, 없으면 여기서 만들어 pose 에
     붙인다. 다음에 열 때는 읽기만 한다. 과거 기록도 예외가 아니다 --
     마스크가 없다는 사실 하나로 같은 길을 탄다.

     원본은 이미 화면에 떠 있다. 다 되면 갈아 끼우고, 되지 않으면 그대로
     둔다. 이 기능이 실패해도 바디뷰는 계속 쓸 수 있어야 한다. */
  useEffect(() => {
    if (!shownView || shownPhoto?.status !== "ready") return undefined;
    /* 이미 손댄 방향인지는 ref 로 기억한다. state 로 기억하면 그 state 가
       이 효과의 의존성이라, 시작하자마자 스스로를 다시 돌리고 그 과정에서
       방금 시작한 작업의 정리 함수가 불려 결과가 버려진다. */
    const runKey = `${assessment?.id || "none"}:${shownView}`;
    if (cutoutRuns.current[runKey]) return undefined;
    cutoutRuns.current[runKey] = true;
    const mark = (status, url = null) => {
      if (!onScreen.current) return;
      setCutouts((previous) => ({ ...previous, [shownView]: { status, url } }));
      onSegmenterEvent?.("segmenter_cutout", { state: status, view: shownView });
    };
    mark("working");
    (async () => {
      try {
        const photo = await decodeImage(shownPhoto.url);
        const savedMaskId = bodyViewMaskId(assessment, shownView);
        let maskUrl = savedMaskId ? await resolvePhotoUrl?.(savedMaskId) : null;
        if (!maskUrl) {
          const made = await personMaskPng(photo, { log: onSegmenterEvent });
          if (!made?.blob) { mark("none"); return; }
          const storedId = await onSaveMask?.(assessment?.id, shownView, made.blob);
          maskUrl = storedId ? await resolvePhotoUrl?.(storedId) : URL.createObjectURL(made.blob);
        }
        if (!maskUrl) { mark("none"); return; }
        const mask = await decodeImage(maskUrl);
        const cutout = await composePersonCutout(photo, mask);
        if (!cutout) { mark("none"); return; }
        mark("ready", URL.createObjectURL(cutout));
      } catch (_error) {
        mark("none");
      }
    })();
    return undefined;
  }, [assessment, shownView, shownPhoto, resolvePhotoUrl, onSaveMask, onSegmenterEvent]);

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
          /* 미는 동안 움직이는 것은 이 사각형 하나다. 사진도 마커도 그 안에
             함께 실려 가므로 마커 좌표를 따로 옮길 일이 없다. 압축도 사진의
             한가운데를 기준으로 걸린다. */
          <div
            ref={stage}
            className="absolute"
            style={photoRect
              ? { left: photoRect.left, top: photoRect.top, width: photoRect.width, height: photoRect.height, willChange: dragging ? "transform, opacity" : "auto" }
              : { inset: 0, willChange: dragging ? "transform, opacity" : "auto" }}
          >
            <img
              src={shownCutout?.status === "ready" ? shownCutout.url : shownPhoto.url}
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
                /* 정렬이 준 배율·위치만 여기에 있다. 손가락이 만드는 이동과
                   압축은 이 사진을 담은 사각형에 걸리므로, 정렬 결과는
                   미는 동안에도 그대로다. */
                transform: shownEntry?.transform
                  ? `translate(${shownEntry.transform.offsetX * 100}%, ${shownEntry.transform.offsetY * 100}%) scale(${shownEntry.transform.scale})`
                  : "none",
              }}
            />

            {photoMarkersVisible && (() => {
              /* 점은 잰 자리에, 알약은 읽히는 자리에. 둘이 어긋난 것만 선으로 잇는다. */
              const pins = placed.map((metric, index) => {
                const fraction = bodyViewMarkerFraction(metric.at, shownEntry?.transform);
                if (!fraction) return null;
                const dot = { x: fraction.x * photoRect.width, y: fraction.y * photoRect.height };
                const text = `${postureMetricDisplayValue(metric.value, metric.unit)}${metric.unit}`;
                const label = clampLabelWithin(dot, photoRect, {
                  width: text.length * MARKER_LABEL_CHAR_PX + MARKER_LABEL_PAD_PX,
                  height: MARKER_LABEL_HEIGHT_PX,
                });
                const moved = Math.abs(label.x - dot.x) > 0.5 || Math.abs(label.y - dot.y) > 0.5;
                return { metric, index, dot, label, text, moved };
              }).filter(Boolean).filter((pin) => pin.index < revealed);
              return (
                <>
                  <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${photoRect.width} ${photoRect.height}`} aria-hidden="true">
                    {pins.map((pin) => (
                      <g key={pin.metric.id} opacity={openMetricId && openMetricId !== pin.metric.id ? 0.45 : 1}>
                        {pin.moved && <line x1={pin.dot.x} y1={pin.dot.y} x2={pin.label.x} y2={pin.label.y} stroke="var(--card)" strokeWidth="2" />}
                        <circle cx={pin.dot.x} cy={pin.dot.y} r="3.5" fill="var(--card)" stroke="var(--ink)" strokeWidth="1.5" />
                      </g>
                    ))}
                  </svg>
                  {pins.map((pin) => (
                    <button
                      key={pin.metric.id}
                      type="button"
                      onClick={() => setOpenMetricId((current) => (current === pin.metric.id ? null : pin.metric.id))}
                      aria-label={`${pin.metric.label} 자세히`}
                      className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full px-2 py-1 text-[10px] font-extrabold tabular-nums"
                      style={{ left: pin.label.x, top: pin.label.y, backgroundColor: "var(--card)", color: "var(--ink)", boxShadow: "var(--shadow)", opacity: openMetricId && openMetricId !== pin.metric.id ? 0.45 : 1 }}
                    >
                      {pin.text}
                    </button>
                  ))}
                </>
              );
            })()}
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
            <p className="text-xs font-bold" style={{ color: "var(--faint)" }}>{shownPhoto?.status === "missing" ? NO_PHOTO_NOTE : "사진을 불러오는 중"}</p>
          </div>
        )}

        {/* 넘어가는 도중에만 놓인다. 가장 좁아지는 그 순간에 둘이 자리를
            바꾸므로 두 사람이 한꺼번에 보이지는 않는다. 마커는 얹지 않는다
            -- 아직 서지 않은 몸에 수치를 찍는 셈이다. */}
        {dragTarget && aimPhoto?.status === "ready" && (
          <div
            ref={incoming}
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{ opacity: 0, willChange: "transform, opacity" }}
          >
            <img
              src={aimCutout?.status === "ready" ? aimCutout.url : aimPhoto.url}
              alt=""
              className="absolute inset-0 h-full w-full object-contain"
              style={{
                transform: aimEntry?.transform
                  ? `translate(${aimEntry.transform.offsetX * 100}%, ${aimEntry.transform.offsetY * 100}%) scale(${aimEntry.transform.scale})`
                  : "none",
              }}
            />
          </div>
        )}

        {openMetric && <MetricDetail metric={openMetric} onClose={() => setOpenMetricId(null)} />}
      </div>

      {/* 지금 어디인가. 네 자리를 모두 두어 이 기록이 어느 방향까지 찍혔는지
          함께 보이게 하고, 찍지 않은 자리는 흐리게 둔다. 아래 버튼이 같은
          것을 이미 말하므로 읽어 주지는 않는다. */}
      <div className="mt-2 flex items-center justify-center gap-2 px-3" aria-hidden="true">
        <span className="text-[10px] font-bold" style={{ color: "var(--faint)" }}>{postureViewLabel(POSTURE_VIEW_KEYS[0])}</span>
        <span className="flex items-center gap-1.5">
          {POSTURE_VIEW_KEYS.map((view) => {
            const shotHere = entries.some((entry) => entry.view === view && entry.hasPhoto);
            return (
              <span
                key={view}
                ref={(node) => { dots.current[view] = node; }}
                className="h-1.5 w-1.5 rounded-full"
                style={{
                  backgroundColor: view === shownView ? "var(--brand)" : "transparent",
                  boxShadow: shotHere ? "inset 0 0 0 1px var(--sub)" : "inset 0 0 0 1px var(--faint)",
                  opacity: shotHere ? 1 : 0.45,
                }}
              />
            );
          })}
        </span>
        <span className="text-[10px] font-bold" style={{ color: "var(--faint)" }}>{postureViewLabel(POSTURE_VIEW_KEYS[POSTURE_VIEW_KEYS.length - 1])}</span>
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
        {/* 정직성 문구와 나란히 둔다. 둘 다 이 숫자가 어디서 왔는지를 말하는
            문장이고, 미정렬 안내와 같은 톤으로 조용히 적는다. */}
        {shownIsManualOnly && <p className="mt-2 text-[11px]" style={{ color: "var(--sub)" }}>관절을 직접 지정한 기록입니다</p>}
        <p className="mt-2 text-[11px]" style={{ color: "var(--sub)" }}>{MEASURED_FROM_NOTE}</p>
      </div>
    </div>
  );
}
