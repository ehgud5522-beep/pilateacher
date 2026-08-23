import { useState } from "react";
import { ArrowRight, CalendarClock, Check, ChevronLeft, MessageSquareText, Sparkles } from "lucide-react";

const PAGE_COUNT = 3;

function DemoBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-extrabold"
      style={{ backgroundColor: "var(--tint)", color: "var(--brand)" }}>
      <Sparkles size={12} /> 데모 화면 · 실제 회원 데이터가 아닙니다
    </span>
  );
}

function ValueCard({ title, children }) {
  return (
    <div className="rounded-xl p-3" style={{ backgroundColor: "var(--canvas)", border: "1px solid var(--line)" }}>
      <p className="text-[11px] font-extrabold" style={{ color: "var(--brand)" }}>{title}</p>
      <p className="mt-1 text-[13px] font-bold leading-relaxed" style={{ color: "var(--ink)" }}>{children}</p>
    </div>
  );
}

export default function Onboarding({ onFinish, onSkip }) {
  const [page, setPage] = useState(0);
  const finish = () => onFinish?.();
  const skip = () => (onSkip || onFinish)?.();

  return (
    <div className="fixed inset-0 z-[90] flex justify-center overflow-hidden" role="dialog" aria-modal="true" aria-label="PilaTeacher 시작 안내"
      style={{ background: "var(--page)" }}>
      <div className="flex h-[100dvh] w-full max-w-[420px] flex-col px-5 pb-[max(env(safe-area-inset-bottom),20px)] pt-[max(env(safe-area-inset-top),20px)]"
        style={{ backgroundColor: "var(--page)" }}>
        <header className="flex h-12 shrink-0 items-center justify-between">
          {page > 0 ? (
            <button type="button" onClick={() => setPage((value) => value - 1)} className="flex h-11 w-11 items-center justify-center rounded-full"
              aria-label="이전 안내" style={{ color: "var(--ink)", backgroundColor: "var(--canvas)" }}>
              <ChevronLeft size={22} />
            </button>
          ) : <span className="h-11 w-11" />}
          <button type="button" onClick={skip} className="h-11 rounded-full px-3 text-sm font-bold" style={{ color: "var(--sub)" }}>
            건너뛰기
          </button>
        </header>

        <main className="flex min-h-0 flex-1 flex-col justify-center overflow-y-auto py-4" aria-live="polite">
          {page === 0 && (
            <section className="text-center">
              <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-[24px]"
                style={{ color: "var(--on-brand)", background: "var(--grad)", boxShadow: "var(--shadow)" }}>
                <Sparkles size={38} strokeWidth={2.2} />
              </div>
              <p className="mt-8 text-[30px] font-black leading-[1.25] tracking-[-0.045em]" style={{ color: "var(--ink)" }}>
                수업은 선생님이.<br />기억은 PilaTeacher가.
              </p>
              <p className="mt-5 whitespace-pre-line text-[16px] font-semibold leading-relaxed" style={{ color: "var(--sub)" }}>
                {"지난 수업을 기억하고\n다음 수업 전에 필요한 기록을 보여드려요."}
              </p>
            </section>
          )}

          {page === 1 && (
            <section>
              <DemoBadge />
              <h1 className="mt-5 text-[26px] font-black leading-tight tracking-[-0.035em]" style={{ color: "var(--ink)" }}>
                수업 끝나고<br />10초만 말하세요.
              </h1>
              <div className="mt-5 rounded-2xl p-4" style={{ backgroundColor: "var(--card)", border: "1px solid var(--line)", boxShadow: "var(--shadow)" }}>
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ color: "var(--on-brand)", backgroundColor: "var(--brand)" }}>
                    <MessageSquareText size={18} />
                  </span>
                  <p className="text-[14px] font-semibold leading-relaxed" style={{ color: "var(--ink2)" }}>
                    “제이님 오늘 브릿지 안정감이 좋아졌고 오른쪽 고관절은 다음 시간에 다시 볼게요.”
                  </p>
                </div>
              </div>
              <div className="my-3 flex justify-center" style={{ color: "var(--brand)" }}><ArrowRight className="rotate-90" size={20} /></div>
              <div className="grid grid-cols-2 gap-2.5">
                <ValueCard title="오늘 진행">브릿지</ValueCard>
                <ValueCard title="변화">브릿지 안정감 개선 기록</ValueCard>
                <ValueCard title="관찰">오른쪽 고관절</ValueCard>
                <ValueCard title="다음 확인">오른쪽 고관절</ValueCard>
              </div>
            </section>
          )}

          {page === 2 && (
            <section>
              <DemoBadge />
              <h1 className="mt-5 text-[26px] font-black leading-tight tracking-[-0.035em]" style={{ color: "var(--ink)" }}>
                그리고 다음 수업 전에<br />다시 기억해드려요.
              </h1>
              <div className="mt-5 rounded-2xl p-4" style={{ backgroundColor: "var(--card)", border: "1px solid var(--line)", boxShadow: "var(--shadow)" }}>
                <div className="flex items-center gap-2 border-b pb-3" style={{ borderColor: "var(--line)" }}>
                  <CalendarClock size={18} style={{ color: "var(--brand)" }} />
                  <p className="text-[15px] font-extrabold" style={{ color: "var(--ink)" }}>제이님 · 오늘 19:00</p>
                </div>
                <div className="mt-3 space-y-3">
                  {["브릿지 안정감 개선 기록", "오른쪽 고관절 관련 기록", "선생님 메모: 다음에 다시 확인"].map((text) => (
                    <div key={text} className="flex items-start gap-2.5">
                      <span className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: "var(--tint)", color: "var(--brand)" }}><Check size={10} strokeWidth={3} /></span>
                      <p className="text-[13px] font-semibold leading-relaxed" style={{ color: "var(--ink2)" }}><span className="mr-1.5 text-[11px]" style={{ color: "var(--sub)" }}>[예시 날짜]</span>{text}</p>
                    </div>
                  ))}
                </div>
              </div>
              <p className="mt-6 text-center text-[16px] font-extrabold" style={{ color: "var(--brand)" }}>기록하고 → 기억하고 → 다음 수업으로</p>
            </section>
          )}
        </main>

        <footer className="shrink-0 pt-3">
          <div className="mb-4 flex justify-center gap-2" aria-label={`${page + 1} / ${PAGE_COUNT} 페이지`}>
            {Array.from({ length: PAGE_COUNT }, (_, index) => (
              <span key={index} className="h-2 rounded-full transition-all" style={{ width: index === page ? 24 : 8, backgroundColor: index === page ? "var(--brand)" : "var(--line)" }} />
            ))}
          </div>
          <button type="button" onClick={() => page === PAGE_COUNT - 1 ? finish() : setPage((value) => value + 1)}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-xl text-[15px] font-extrabold"
            style={{ color: "var(--on-brand)", background: "var(--grad)", boxShadow: "var(--shadow)" }}>
            {page === PAGE_COUNT - 1 ? "PilaTeacher 시작하기" : "다음"}
            {page < PAGE_COUNT - 1 && <ArrowRight size={18} />}
          </button>
        </footer>
      </div>
    </div>
  );
}
