import { useEffect, useState } from "react";

/* 기록을 저장한 직후, 그 내용이 다음 수업에 어떻게 뜨는지 한 번 보여 준다.

   강사는 자기가 말한 것이 어디로 가는지 본 적이 없다. 저장은 토스트 한 줄로
   끝났고, 그 다음은 다음 수업 화면을 열어야만 알 수 있었다.

   보여 주는 것은 이미 저장된 값뿐이다. 빈 칸은 빈 칸으로 두고 그 경우의 레이아웃을
   쓴다 -- 비어 있는 칸을 채워 넣으면 강사가 말하지 않은 것을 말한 것처럼 만든다.

   onNextPending 과 pendingCount 는 아직 넘어오지 않는다. 오늘 미기록 수업으로 바로
   넘어가는 경로가 없기 때문이고, 그 배선은 다음 작업이다. 자리만 비워 둔다. */

/* 카드가 먼저 서고, 잠깐 멈춘 뒤, 내용이 그 위에 얹힌다.

   순서가 목적이다. 저장한 기록이 다음 수업 카드로 옮겨 가는 것을 보여 주려는
   것이므로, 카드와 글이 함께 나타나면 아무것도 말하지 않는 셈이 된다.

   합쳐서 1.1초 -- 저장할 때마다 지나가는 화면이라 이보다 길면 기다림이 된다. */
const CARD_ENTER_MS = 300;
const HOLD_MS = 400;
const TEXT_ENTER_MS = 400;

/* 움직임을 줄이라고 설정한 기기에서는 연출 없이 최종 상태를 바로 보여 준다.
   연출은 덤이고, 내용은 덤이 아니다. */
function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => {
    try { return Boolean(globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches); }
    catch (_error) { return false; }
  });
  useEffect(() => {
    let media = null;
    try { media = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)") || null; }
    catch (_error) { media = null; }
    if (!media) return undefined;
    const onChange = (event) => setReduced(Boolean(event.matches));
    media.addEventListener?.("change", onChange);
    return () => media.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}

export default function NextLessonReflection({
  reflection,
  onConfirm,
  onNextPending = null,
  pendingCount = 0,
}) {
  const reduced = usePrefersReducedMotion();
  const [stage, setStage] = useState("hidden");

  /* 훅은 reflection 이 없을 때도 같은 순서로 불려야 한다. 화면을 안 그리는 판단은
     그 아래에서 한다. */
  useEffect(() => {
    if (!reflection) { setStage("hidden"); return undefined; }
    if (reduced) { setStage("settled"); return undefined; }
    setStage("card");
    const timer = globalThis.setTimeout?.(() => setStage("settled"), CARD_ENTER_MS + HOLD_MS);
    return () => globalThis.clearTimeout?.(timer);
  }, [reflection, reduced]);

  if (!reflection) return null;
  const showNext = Boolean(onNextPending) && Number(pendingCount) > 0;

  const cardStyle = {
    opacity: stage === "hidden" ? 0 : 1,
    transform: stage === "hidden" ? "translateY(8px)" : "none",
    transition: reduced ? "none" : `opacity ${CARD_ENTER_MS}ms ease, transform ${CARD_ENTER_MS}ms ease`,
  };
  const textStyle = {
    opacity: stage === "settled" ? 1 : 0,
    transition: reduced ? "none" : `opacity ${TEXT_ENTER_MS}ms ease`,
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center px-6" role="dialog" aria-modal="true" aria-label="기록 반영 확인"
      style={{ backgroundColor: "var(--scrim)" }}>
      <div className="w-full max-w-sm">
        <p className="text-center text-sm font-extrabold" style={{ color: "var(--on-brand)" }}>✓ 기록했습니다</p>

        {reflection.layout === "C" ? (
          <div className="mt-4 rounded-2xl p-4 text-center" style={{ backgroundColor: "var(--card)", ...cardStyle }}>
            <p className="text-sm font-extrabold" style={{ color: "var(--ink)" }}>{reflection.memberName}님 기억에 저장했습니다</p>
            <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--sub)" }}>다음 수업을 잡으면 여기 내용이 뜹니다</p>
            {/* 반복 항목이 없으면 이 줄은 아예 그리지 않는다. "반복 기록 없음"을
                적어 두면 없는 것을 굳이 알리는 셈이다. */}
            {reflection.repeated && (
              <div className="mt-3 flex items-center gap-2 rounded-xl px-3 py-2 text-left" style={{ backgroundColor: "var(--canvas)", ...textStyle }}>
                <span className="shrink-0 text-[10px] font-bold" style={{ color: "var(--sub)" }}>최근 3회 반복</span>
                <span className="min-w-0 flex-1 truncate text-xs font-bold" style={{ color: "var(--ink2)" }}>{reflection.repeated}</span>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="mt-4 rounded-2xl p-4" style={{ backgroundColor: "var(--card)", ...cardStyle }}>
              <p className="truncate text-xs font-extrabold" style={{ color: "var(--brand)" }}>
                {reflection.memberName} · {reflection.lessonDate}{reflection.lessonTime ? ` ${reflection.lessonTime}` : ""}
              </p>
              {/* 카드가 먼저 서고 이 블록이 나중에 얹힌다. */}
              <div className="mt-3" style={textStyle}>
                {reflection.layout === "A" ? (
                  <>
                    <p className="text-[10px] font-bold" style={{ color: "var(--sub)" }}>오늘 확인</p>
                    <p className="mt-1 text-sm font-extrabold leading-relaxed" style={{ color: "var(--ink)" }}>{reflection.focus}</p>
                    {/* 어느 기록에서 온 문장인지 밝힌다. 출처 없는 문장은 강사가
                        확인할 방법이 없다. */}
                    <p className="mt-2 text-[10px]" style={{ color: "var(--sub)" }}>근거: {reflection.basisDate} 기록</p>
                  </>
                ) : (
                  <>
                    <p className="text-[10px] font-bold" style={{ color: "var(--sub)" }}>지난 수업</p>
                    <p className="mt-1 text-sm font-extrabold leading-relaxed" style={{ color: "var(--ink)" }}>{reflection.lastLesson || "기록 없음"}</p>
                    <p className="mt-2 text-[10px]" style={{ color: "var(--sub)" }}>근거: {reflection.basisDate} 기록</p>
                  </>
                )}
              </div>
            </div>
            <p className="mt-3 text-center text-xs font-bold" style={{ color: "var(--on-brand)" }}>다음 수업에 이 내용이 뜹니다</p>
          </>
        )}

        <div className={`mt-5 grid gap-2 ${showNext ? "grid-cols-2" : "grid-cols-1"}`}>
          {showNext && (
            <button type="button" onClick={onNextPending} className="h-12 rounded-xl text-sm font-extrabold"
              style={{ backgroundColor: "var(--card)", color: "var(--brand)" }}>다음 기록 ({pendingCount}건)</button>
          )}
          <button type="button" onClick={onConfirm} className="h-12 rounded-xl text-sm font-extrabold text-white"
            style={{ backgroundColor: "var(--brand)" }}>확인</button>
        </div>
      </div>
    </div>
  );
}
