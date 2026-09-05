import { useEffect, useRef, useState } from "react";
import { ArrowRight, ChevronLeft, Sparkles, UserPlus } from "lucide-react";
import LessonHistorySessionRow from "../lesson-record/LessonHistorySessionRow.jsx";
import { ONBOARD_SAMPLE_SESSION } from "./onboarding-sample.js";

export const ONBOARDING_PAGE_COUNT = 4;
export const PERMISSION_GUIDE_ITEMS = Object.freeze([
  { icon: "🎤", title: "마이크", body: "수업 내용을 말로 기록할 때 사용", key: "microphone" },
  { icon: "📷", title: "카메라", body: "체형 사진을 직접 촬영할 때 사용", key: "camera" },
  { icon: "🖼", title: "사진 선택", body: "기기에 있는 사진을 직접 선택해 불러올 때 사용", key: "photos" },
  { icon: "🔔", title: "알림", body: "다음 수업이나 남은 기록을 알려줄 때 사용", key: "notifications" },
]);

export function PermissionGuide({ statuses = null }) {
  return <div className="min-w-0 space-y-2" data-permission-guide>
    <div className="rounded-xl p-3" style={{ backgroundColor: "var(--canvas)" }}><p className="text-xs font-extrabold" style={{ color: "var(--ink)" }}>선택 접근</p><p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--sub)" }}>허용하지 않아도 앱의 기본 기능을 사용할 수 있습니다</p></div>
    {PERMISSION_GUIDE_ITEMS.map((item) => <div key={item.key} className="flex min-w-0 items-start gap-3 rounded-xl p-3" style={{ backgroundColor: "var(--card)", border: "1px solid var(--line)" }}><span className="shrink-0 text-xl" aria-hidden="true">{item.icon}</span><span className="min-w-0 flex-1"><span className="block text-sm font-extrabold" style={{ color: "var(--ink)" }}>{item.title}</span><span className="mt-0.5 block text-xs leading-relaxed" style={{ color: "var(--sub)" }}>{item.body}</span></span>{statuses?.[item.key] && <span className="shrink-0 rounded-full px-2 py-1 text-[10px] font-bold" style={{ backgroundColor: "var(--tint)", color: "var(--brand)" }}>{statuses[item.key]}</span>}</div>)}
    <p className="pt-1 text-xs font-extrabold" style={{ color: "var(--brand)" }}>필수 권한 없음</p><p className="text-[11px] leading-relaxed" style={{ color: "var(--sub)" }}>권한은 해당 기능을 처음 사용할 때 요청합니다.<br />설정에서 언제든 변경할 수 있습니다.</p>
  </div>;
}

const steps = [["①", "수업 등록", "시간표 빈 칸을 눌러 넣기"], ["②", "수업 후 10초", "말하면 AI가 정리"], ["③", "다음 수업 전", "정리된 내용 확인"]];

export default function Onboarding({ onSkip, onRegisterMember, onExploreSample, onLater, replay = false }) {
  const [page, setPage] = useState(0);
  const touchStart = useRef(null);
  const pageRef = useRef(page);
  pageRef.current = page;
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const token = `onboarding-${Date.now()}`;
    try { window.history.pushState({ ptkOnboarding: token }, ""); } catch (_error) {}
    const onPop = () => { if (pageRef.current > 0) setPage((value) => Math.max(0, value - 1)); try { window.history.pushState({ ptkOnboarding: token }, ""); } catch (_error) {} };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const advance = () => setPage((value) => Math.min(ONBOARDING_PAGE_COUNT - 1, value + 1));
  const onTouchEnd = (event) => { if (touchStart.current === null) return; const delta = event.changedTouches?.[0]?.clientX - touchStart.current; touchStart.current = null; if (Math.abs(delta) < 45) return; if (delta < 0) advance(); else setPage((value) => Math.max(0, value - 1)); };

  return <div className="fixed inset-0 z-[90] flex justify-center overflow-x-hidden" role="dialog" aria-modal="true" aria-label={replay ? "사용법 다시 보기" : "PilaTeacher 시작 안내"} style={{ backgroundColor: "var(--page)" }}>
    <div className="flex h-[100dvh] w-full max-w-[420px] min-w-0 flex-col overflow-x-hidden px-5 pb-[max(env(safe-area-inset-bottom),20px)] pt-[max(env(safe-area-inset-top),16px)]" onTouchStart={(event) => { touchStart.current = event.touches?.[0]?.clientX ?? null; }} onTouchEnd={onTouchEnd}>
      <header className="flex h-12 shrink-0 items-center justify-between">{page > 0 ? <button type="button" onClick={() => setPage((value) => value - 1)} className="flex h-11 w-11 items-center justify-center rounded-full" aria-label="이전 안내" style={{ color: "var(--ink)", backgroundColor: "var(--canvas)" }}><ChevronLeft size={22} /></button> : <span className="h-11 w-11" />}{page === 0 && <button type="button" onClick={onSkip} className="h-11 px-2 text-sm font-bold" style={{ color: "var(--sub)" }}>건너뛰기</button>}</header>
      <main key={page} className="pt-scroll min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden py-3" aria-live="polite">
        {page === 0 && <section className="flex min-h-full flex-col items-center justify-center text-center"><div className="flex h-20 w-20 items-center justify-center rounded-[24px]" style={{ background: "var(--grad)", color: "var(--on-brand)", boxShadow: "var(--shadow)" }}><Sparkles size={36} /></div><h1 className="mt-7 text-[28px] font-black tracking-[-0.04em]" style={{ color: "var(--ink)" }}>수업을 기억하는 앱</h1><p className="mt-4 whitespace-pre-line text-[15px] font-semibold leading-relaxed" style={{ color: "var(--sub)" }}>{"수업 끝나고 10초만 말하면\nAI가 정리해서 다음 수업 때 꺼내줍니다"}</p></section>}
        {page === 1 && <section className="min-w-0"><h1 className="text-[26px] font-black tracking-[-0.035em]" style={{ color: "var(--ink)" }}>이렇게 씁니다</h1><div className="mt-4 space-y-2">{steps.map(([number, title, body]) => <div key={number} className="flex min-w-0 items-center gap-3 rounded-xl p-3" style={{ backgroundColor: "var(--card)", border: "1px solid var(--line)" }}><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-black" style={{ backgroundColor: "var(--tint)", color: "var(--brand)" }}>{number}</span><span className="min-w-0"><span className="block text-sm font-extrabold" style={{ color: "var(--ink)" }}>{title}</span><span className="block text-xs" style={{ color: "var(--sub)" }}>{body}</span></span></div>)}</div><p className="mb-2 mt-5 text-xs font-extrabold" style={{ color: "var(--sub)" }}>이렇게 정리됩니다</p><LessonHistorySessionRow session={ONBOARD_SAMPLE_SESSION} variant="preview" /></section>}
        {page === 2 && <section className="min-w-0"><h1 className="mb-4 text-[24px] font-black tracking-[-0.035em]" style={{ color: "var(--ink)" }}>필라티쳐가 사용하는 접근권한</h1><PermissionGuide /></section>}
        {page === 3 && <section className="flex min-h-full flex-col justify-center text-center"><div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl" style={{ backgroundColor: "var(--tint)", color: "var(--brand)" }}><UserPlus size={30} /></div><h1 className="mt-6 text-[26px] font-black tracking-[-0.035em]" style={{ color: "var(--ink)" }}>첫 회원을 등록해볼까요</h1><p className="mt-3 whitespace-pre-line text-sm font-semibold leading-relaxed" style={{ color: "var(--sub)" }}>{"회원 한 명만 등록하면\n나머지는 쓰면서 익혀집니다"}</p></section>}
      </main>
      <footer className="shrink-0 pt-3"><div className="mb-4 flex justify-center gap-2" aria-label={`${page + 1} / ${ONBOARDING_PAGE_COUNT} 페이지`}>{Array.from({ length: ONBOARDING_PAGE_COUNT }, (_, index) => <span key={index} className="h-2 rounded-full" style={{ width: index === page ? 24 : 8, backgroundColor: index === page ? "var(--brand)" : "var(--line)" }} />)}</div>{page < 3 ? <button type="button" onClick={advance} className="flex min-h-14 w-full items-center justify-center gap-2 rounded-xl text-[15px] font-extrabold" style={{ color: "var(--on-brand)", background: "var(--grad)", boxShadow: "var(--shadow)" }}>{page === 0 ? "시작하기" : page === 1 ? "다음" : "확인"}<ArrowRight size={18} /></button> : <div className="space-y-1"><button type="button" onClick={onRegisterMember} className="min-h-14 w-full rounded-xl text-[15px] font-extrabold" style={{ color: "var(--on-brand)", background: "var(--grad)", boxShadow: "var(--shadow)" }}>회원 등록하기</button><button type="button" onClick={onExploreSample} className="min-h-11 w-full text-sm font-extrabold" style={{ color: "var(--brand)" }}>예시로 먼저 둘러보기</button><button type="button" onClick={onLater} className="min-h-11 w-full text-sm font-bold" style={{ color: "var(--sub)" }}>나중에 하기</button></div>}</footer>
    </div>
  </div>;
}
