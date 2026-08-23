import { useEffect, useState } from "react";
import {
  ArrowDown, ArrowRight, CalendarClock, Check, ChevronLeft,
  Mic, PencilLine, Repeat2, Sparkles, TrendingUp,
} from "lucide-react";

const PAGE_COUNT = 3;

const MEMORY_LINES = [
  { date: "8.13", role: "최근 변화", text: "브릿지 안정감 개선", kind: "change", ai: true },
  { date: "8.17", role: "반복 관찰", text: "오른쪽 고관절 반복 확인", kind: "repeat", ai: true },
  { date: "8.20", role: "강사 메모", text: "선생님 메모: 호흡 순서 유지", kind: "teacher", ai: false },
];

const SUMMARY_CARDS = [
  { label: "오늘 수업", value: "브릿지" },
  { label: "변화", value: "오른쪽 고관절 움직임" },
  { label: "회원 반응", value: "브릿지 안정감 좋아짐" },
  { label: "다음 확인", value: "오른쪽 고관절 다시 보기", next: true },
];

const ONBOARDING_STYLES = `
  @keyframes pt-ob-fade-up {
    from { opacity: 0; transform: translate3d(0, 12px, 0); }
    to { opacity: 1; transform: translate3d(0, 0, 0); }
  }
  @keyframes pt-ob-mic-ring {
    0%, 2% { opacity: 0; transform: scale(.72); }
    7% { opacity: .42; transform: scale(.86); }
    18% { opacity: 0; transform: scale(1.42); }
    19%, 100% { opacity: 0; transform: scale(1.42); }
  }
  @keyframes pt-ob-mic-beat {
    0%, 2% { opacity: .72; transform: scale(.94); }
    7% { opacity: 1; transform: scale(1.07); }
    13%, 100% { opacity: 1; transform: scale(1); }
  }
  @keyframes pt-ob-speech-1 {
    0%, 12% { opacity: 0; transform: translate3d(0, 7px, 0); }
    16%, 100% { opacity: 1; transform: translate3d(0, 0, 0); }
  }
  @keyframes pt-ob-speech-2 {
    0%, 17% { opacity: 0; transform: translate3d(0, 7px, 0); }
    21%, 100% { opacity: 1; transform: translate3d(0, 0, 0); }
  }
  @keyframes pt-ob-speech-3 {
    0%, 22% { opacity: 0; transform: translate3d(0, 7px, 0); }
    26%, 100% { opacity: 1; transform: translate3d(0, 0, 0); }
  }
  @keyframes pt-ob-cue {
    0%, 28% { opacity: 0; transform: translate3d(0, -6px, 0); }
    33%, 100% { opacity: 1; transform: translate3d(0, 0, 0); }
  }
  @keyframes pt-ob-card-1 {
    0%, 67% { opacity: 0; transform: scale(.94); }
    72%, 100% { opacity: 1; transform: scale(1); }
  }
  @keyframes pt-ob-card-2 {
    0%, 71.3% { opacity: 0; transform: scale(.94); }
    76.3%, 100% { opacity: 1; transform: scale(1); }
  }
  @keyframes pt-ob-card-3 {
    0%, 75.6% { opacity: 0; transform: scale(.94); }
    80.6%, 100% { opacity: 1; transform: scale(1); }
  }
  @keyframes pt-ob-card-4 {
    0%, 79.9% { opacity: 0; transform: scale(.94); }
    84.9%, 100% { opacity: 1; transform: scale(1); }
  }
  .pt-ob-page-enter { animation: pt-ob-fade-up .36s ease-out both; }
  .pt-ob-chip { animation: pt-ob-fade-up .48s ease-out both; }
  .pt-ob-return-line { animation: pt-ob-fade-up .42s ease-out both; }
  .pt-ob-mic-ring { animation: pt-ob-mic-ring 7s ease-out infinite; }
  .pt-ob-mic-beat { animation: pt-ob-mic-beat 7s ease-out infinite; }
  .pt-ob-speech-1 { animation: pt-ob-speech-1 7s ease-out infinite; }
  .pt-ob-speech-2 { animation: pt-ob-speech-2 7s ease-out infinite; }
  .pt-ob-speech-3 { animation: pt-ob-speech-3 7s ease-out infinite; }
  .pt-ob-cue { animation: pt-ob-cue 7s ease-out infinite; }
  .pt-ob-card-1 { animation: pt-ob-card-1 7s ease-out infinite; }
  .pt-ob-card-2 { animation: pt-ob-card-2 7s ease-out infinite; }
  .pt-ob-card-3 { animation: pt-ob-card-3 7s ease-out infinite; }
  .pt-ob-card-4 { animation: pt-ob-card-4 7s ease-out infinite; }
  .pt-ob-paused .pt-ob-animated { animation-play-state: paused !important; }
  @media (prefers-reduced-motion: reduce) {
    .pt-ob-animated {
      animation: none !important;
      opacity: 1 !important;
      transform: none !important;
    }
  }
`;

function DemoBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-extrabold"
      style={{ backgroundColor: "var(--tint)", color: "var(--brand)" }}>
      <Sparkles size={12} /> 데모 화면 · 실제 회원 데이터가 아닙니다
    </span>
  );
}

function MemoryIcon({ kind, size = 14 }) {
  if (kind === "teacher") return <PencilLine size={size} />;
  if (kind === "repeat") return <Repeat2 size={size} />;
  return <TrendingUp size={size} />;
}

function MemoryChip({ item, delay }) {
  const teacher = item.kind === "teacher";
  return (
    <div className="pt-ob-chip pt-ob-animated flex items-center gap-3 rounded-xl px-3 py-2.5 text-left"
      style={{ animationDelay: `${delay}s`, backgroundColor: teacher ? "var(--warn-s)" : "var(--card)", border: `1px solid ${teacher ? "var(--warn)" : "var(--line)"}` }}>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
        style={{ backgroundColor: teacher ? "var(--card)" : "var(--tint)", color: teacher ? "var(--warn)" : "var(--brand)" }}>
        <MemoryIcon kind={item.kind} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] font-extrabold" style={{ color: teacher ? "var(--warn)" : "var(--sub)" }}>{item.role}</span>
        <span className="mt-0.5 block text-[12px] font-bold leading-relaxed" style={{ color: "var(--ink2)" }}>{item.date} · {item.text}</span>
      </span>
    </div>
  );
}

function SummaryCard({ item, index }) {
  return (
    <div className={`pt-ob-card-${index + 1} pt-ob-animated rounded-xl p-2.5`}
      style={{ backgroundColor: item.next ? "var(--tint)" : "var(--canvas)", border: "1px solid var(--line)" }}>
      <p className="text-[10px] font-extrabold" style={{ color: item.next ? "var(--brand)" : "var(--sub)" }}>{item.label}</p>
      <p className="mt-1 text-[12px] font-bold leading-relaxed" style={{ color: "var(--ink)" }}>{item.value}</p>
    </div>
  );
}

function ReturnLine({ item, index }) {
  const teacher = item.kind === "teacher";
  return (
    <div className="pt-ob-return-line pt-ob-animated flex items-start gap-2.5" style={{ animationDelay: `${0.18 + index * 0.3}s` }}>
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg"
        style={{ backgroundColor: teacher ? "var(--warn-s)" : "var(--tint)", color: teacher ? "var(--warn)" : "var(--brand)" }}>
        {teacher ? <MemoryIcon kind="teacher" size={12} /> : <Check size={11} strokeWidth={3} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          {item.ai && <span className="text-[9px] font-extrabold" style={{ color: "var(--brand)" }}>[AI]</span>}
          <span className="tabular-nums text-[11px] font-bold" style={{ color: "var(--sub)" }}>{item.date}</span>
        </span>
        <span className="mt-0.5 block text-[13px] font-semibold leading-relaxed" style={{ color: teacher ? "var(--ink)" : "var(--ink2)" }}>{item.text}</span>
      </span>
    </div>
  );
}

export default function Onboarding({ onFinish, onSkip }) {
  const [page, setPage] = useState(0);
  const [pageVisible, setPageVisible] = useState(() => typeof document === "undefined" || document.visibilityState !== "hidden");
  const finish = () => onFinish?.();
  const skip = () => (onSkip || onFinish)?.();

  useEffect(() => {
    const onVisibility = () => setPageVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  return (
    <div className={`fixed inset-0 z-[90] flex justify-center overflow-hidden ${pageVisible ? "" : "pt-ob-paused"}`} role="dialog" aria-modal="true" aria-label="PilaTeacher 시작 안내" style={{ background: "var(--page)" }}>
      <style>{ONBOARDING_STYLES}</style>
      <div className="flex h-[100dvh] w-full max-w-[420px] flex-col px-5 pb-[max(env(safe-area-inset-bottom),20px)] pt-[max(env(safe-area-inset-top),20px)]" style={{ backgroundColor: "var(--page)" }}>
        <header className="flex h-12 shrink-0 items-center justify-between">
          {page > 0 ? (
            <button type="button" onClick={() => setPage((value) => value - 1)} className="flex h-11 w-11 items-center justify-center rounded-full" aria-label="이전 안내" style={{ color: "var(--ink)", backgroundColor: "var(--canvas)" }}>
              <ChevronLeft size={22} />
            </button>
          ) : <span className="h-11 w-11" />}
          <button type="button" onClick={skip} className="h-11 rounded-full px-3 text-sm font-bold" style={{ color: "var(--sub)" }}>건너뛰기</button>
        </header>

        <main key={page} className="flex min-h-0 flex-1 flex-col justify-center overflow-y-auto py-4" aria-live="polite">
          {page === 0 && (
            <section className="pt-ob-page-enter pt-ob-animated text-center">
              <DemoBadge />
              <div className="mx-auto mt-5 flex h-16 w-16 items-center justify-center rounded-[20px]" style={{ color: "var(--on-brand)", background: "var(--grad)", boxShadow: "var(--shadow)" }}>
                <Sparkles size={31} strokeWidth={2.2} />
              </div>
              <h1 className="mt-5 text-[27px] font-black leading-[1.25] tracking-[-0.045em]" style={{ color: "var(--ink)" }}>수업은 선생님이.<br />기억은 PilaTeacher가.</h1>
              <p className="mt-3 whitespace-pre-line text-[14px] font-semibold leading-relaxed" style={{ color: "var(--sub)" }}>{"지난 수업을 기억하고\n다음 수업 전에 필요한 기록을 보여드려요."}</p>
              <div className="mt-5 space-y-2">
                {MEMORY_LINES.map((item, index) => <MemoryChip key={item.date} item={item} delay={0.16 + index * 0.4} />)}
              </div>
            </section>
          )}

          {page === 1 && (
            <section className="pt-ob-page-enter pt-ob-animated">
              <DemoBadge />
              <h1 className="mt-4 text-[25px] font-black leading-tight tracking-[-0.035em]" style={{ color: "var(--ink)" }}>수업 끝나고<br />10초만 말하세요.</h1>
              <div className="mt-4 rounded-2xl p-3.5" style={{ backgroundColor: "var(--card)", border: "1px solid var(--line)", boxShadow: "var(--shadow)" }}>
                <div className="flex items-start gap-3">
                  <span className="relative flex h-10 w-10 shrink-0 items-center justify-center">
                    <span className="pt-ob-mic-ring pt-ob-animated absolute inset-0 rounded-full" style={{ backgroundColor: "var(--brand)" }} />
                    <span className="pt-ob-mic-beat pt-ob-animated relative flex h-9 w-9 items-center justify-center rounded-full" style={{ color: "var(--on-brand)", backgroundColor: "var(--brand)" }}><Mic size={18} /></span>
                  </span>
                  <p className="min-w-0 flex-1 text-[13px] font-semibold leading-relaxed" style={{ color: "var(--ink2)" }}>
                    <span className="pt-ob-speech-1 pt-ob-animated block">“제이님 오늘 브릿지 안정감이 좋아졌고</span>
                    <span className="pt-ob-speech-2 pt-ob-animated block">오른쪽 고관절은 다음 시간에</span>
                    <span className="pt-ob-speech-3 pt-ob-animated block">다시 볼게요.”</span>
                  </p>
                </div>
              </div>
              <div className="pt-ob-cue pt-ob-animated my-2 flex items-center justify-center gap-1 text-[11px] font-extrabold" style={{ color: "var(--brand)" }}><ArrowDown size={17} /> 말한 내용이 네 칸으로 정리돼요</div>
              <div className="grid grid-cols-2 gap-2">
                {SUMMARY_CARDS.map((item, index) => <SummaryCard key={item.label} item={item} index={index} />)}
              </div>
            </section>
          )}

          {page === 2 && (
            <section className="pt-ob-page-enter pt-ob-animated">
              <DemoBadge />
              <h1 className="mt-5 text-[26px] font-black leading-tight tracking-[-0.035em]" style={{ color: "var(--ink)" }}>그리고 다음 수업 전에<br />다시 기억해드려요.</h1>
              <div className="mt-5 rounded-2xl p-4" style={{ backgroundColor: "var(--card)", border: "1px solid var(--line)", boxShadow: "var(--shadow)" }}>
                <div className="flex items-center gap-2 border-b pb-3" style={{ borderColor: "var(--line)" }}>
                  <CalendarClock size={18} style={{ color: "var(--brand)" }} />
                  <p className="text-[15px] font-extrabold" style={{ color: "var(--ink)" }}>제이님 · 다음 수업</p>
                </div>
                <div className="mt-3 space-y-3">
                  {MEMORY_LINES.map((item, index) => <ReturnLine key={item.date} item={item} index={index} />)}
                </div>
              </div>
              <p className="mt-6 text-center text-[16px] font-extrabold" style={{ color: "var(--brand)" }}>기록하고 → 기억하고 → 다음 수업으로</p>
            </section>
          )}
        </main>

        <footer className="shrink-0 pt-3">
          <div className="mb-4 flex justify-center gap-2" aria-label={`${page + 1} / ${PAGE_COUNT} 페이지`}>
            {Array.from({ length: PAGE_COUNT }, (_, index) => <span key={index} className="h-2 rounded-full" style={{ width: index === page ? 24 : 8, backgroundColor: index === page ? "var(--brand)" : "var(--line)" }} />)}
          </div>
          <button type="button" onClick={() => page === PAGE_COUNT - 1 ? finish() : setPage((value) => value + 1)} className="flex h-14 w-full items-center justify-center gap-2 rounded-xl text-[15px] font-extrabold" style={{ color: "var(--on-brand)", background: "var(--grad)", boxShadow: "var(--shadow)" }}>
            {page === PAGE_COUNT - 1 ? "PilaTeacher 시작하기" : "다음"}
            {page < PAGE_COUNT - 1 && <ArrowRight size={18} />}
          </button>
        </footer>
      </div>
    </div>
  );
}
