/**
 * 수업 전 브리핑 (설계 문서 3단계). 수업 관리 시트 위쪽, 출석 · 차감 위에 크게 선다.
 * 내용은 briefing-view.js 가 고른다 -- 이 파일은 그리기만.
 *
 * 2026-11-17 대표 개편: 카드 안 카드를 걷었다. 흰 바탕에 구분선 하나씩, 위에서 아래로
 * 꼭 기억할 것 → 지난 수업(회원 반응 포함) → 최근 흐름.
 * 문장을 누르면 그 근거 날짜의 기록이 바로 아래에 펼쳐진다 (시트를 떠나지 않는다).
 * 화면 문구에 "AI" 를 쓰지 않는다 -- 강사가 읽는 것은 기록이다.
 */
import { daySpanLabel } from "../../../functions/shared/day-span.mjs";
import { useState } from "react";
import { BRAND_D, CANVAS, INK, INK2, LINE, SUB, WARN, WARN_S } from "../../design-system/theme/themes.js";
import { TYPE } from "../ui/type-scale.js";
import { sessionsOnDate } from "../lesson-record/briefing-view.js";

const shortDate = (value) => {
  const match = String(value || "").match(/^\d{4}-(\d{2})-(\d{2})/);
  return match ? `${Number(match[1])}.${Number(match[2])}` : "";
};

export function SourceRecords({ sessions, dates }) {
  const shown = [...new Set(dates)].flatMap((date) => sessionsOnDate(sessions, date));
  if (!shown.length) return <p data-briefing-source-missing style={{ fontSize: TYPE.caption, color: SUB }}>이 기기에서 그날 기록을 찾지 못했어요.</p>;
  return shown.map((session) => (
    <div key={session.key} data-briefing-source={session.date} className="app-motion-feedback mt-1 rounded-lg px-2.5 py-2" style={{ backgroundColor: CANVAS }}>
      <p className="font-bold tabular-nums" style={{ fontSize: TYPE.caption, color: SUB }}>{shortDate(session.date)} 기록</p>
      {[["한 것", session.today], ["관찰", session.change], ["반응", session.reaction], ["다음에 확인할 것", session.next]]
        .filter(([, value]) => value && value !== "기록 없음")
        .map(([label, value]) => <p key={label} style={{ fontSize: TYPE.caption, lineHeight: 1.5, color: INK2 }}><span className="font-bold">{label}</span> · {value}</p>)}
    </div>
  ));
}

export function Sentence({ item, id, open, onToggle, sessions }) {
  const dates = (item.sources || []).map((source) => source.date);
  const tappable = dates.length > 0;
  return (
    <li>
      <button type="button" disabled={!tappable} onClick={() => onToggle(id)} aria-expanded={tappable ? open : undefined}
        className="w-full text-left" style={{ fontSize: TYPE.body, lineHeight: 1.5, color: INK }}>
        {item.origin === "caution" ? <span className="mr-1 rounded px-1 font-bold" style={{ fontSize: TYPE.caption, color: WARN, backgroundColor: WARN_S }}>주의</span> : null}
        {item.text}
        {tappable ? <span className="ml-1 tabular-nums" style={{ fontSize: TYPE.caption, color: SUB }}>{[...new Set(dates)].map(shortDate).join(", ")}</span> : null}
      </button>
      {open ? <SourceRecords sessions={sessions} dates={dates} /> : null}
    </li>
  );
}

function Block({ title, children, empty, testId, first = false }) {
  return (
    <section data-briefing-block={testId} className="min-w-0" style={{ padding: first ? "0 0 14px" : "14px 0", borderTop: first ? 0 : `1px solid ${LINE}` }}>
      <h3 className="mb-0.5" style={{ fontSize: TYPE.caption, fontWeight: 600, color: SUB }}>{title}</h3>
      {empty ? <p data-briefing-empty style={{ fontSize: TYPE.body, color: SUB }}>기록 없음</p> : children}
    </section>
  );
}

/**
 * @param {{ view: ReturnType<typeof import("../lesson-record/briefing-view.js").selectLessonBriefing>, sessions: any[], footer?: any, fallback?: { title: string, text: string } | null }} props
 *   fallback 지난 수업 기록이 없을 때 대신 보여 줄 옛 기록 한 줄 (비포애프터 참고 · 이전 메모). 지난 수업 칸이 빈 회원도 읽을 것이 남는다.
 */
export default function LessonBriefing({ view, sessions, footer = null, fallback = null }) {
  const [open, setOpen] = useState("");
  const toggle = (id) => setOpen((current) => (current === id ? "" : id));
  if (!view) return null;
  const { mustRemember, lastLesson, recentTrend } = view;
  const progress = [
    `${recentTrend.sessionNumber}회차`,
    recentTrend.daysSinceLast === null ? "첫 출석" : recentTrend.daysSinceLast === 0 ? "같은 날 지난 수업" : `지난 수업 뒤 ${daySpanLabel(recentTrend.daysSinceLast)}`,
  ].join(" · ");
  return (
    <section data-lesson-briefing-v2 aria-label="수업 전 브리핑" className="min-w-0">
      <Block first title="꼭 기억할 것" testId="must-remember" empty={!mustRemember.items.length}>
        <ul className="space-y-1">
          {mustRemember.items.map((item, index) => <Sentence key={`m${index}`} id={`m${index}`} item={item} open={open === `m${index}`} onToggle={toggle} sessions={sessions} />)}
        </ul>
      </Block>
      <Block title={lastLesson ? `지난 수업 · ${shortDate(lastLesson.date)}${lastLesson.type ? ` ${lastLesson.type}` : ""}` : fallback?.text ? fallback.title : "지난 수업"} testId="last-lesson"
        empty={(!lastLesson || !lastLesson.rows.length) && !fallback?.text}>
        {lastLesson && lastLesson.rows.length ? (
          <div className="space-y-1">
            {lastLesson.rows.map((row) => (
              <div key={row.key} data-briefing-row={row.key}>
                {/* 한 것은 그대로, 회원 반응 · 다음에 확인할 것은 라벨을 붙여 한 칸 안에 (지시서: 회원 반응은 지난 수업 안에). */}
                {row.key === "today" ? <p style={{ fontSize: TYPE.body, lineHeight: 1.5, color: INK }}>한 것: {row.text}</p> : (
                  <p style={{ fontSize: row.key === "next" ? TYPE.body : TYPE.caption, lineHeight: 1.5, color: row.key === "next" ? BRAND_D : INK2, fontWeight: row.key === "next" ? 700 : 400 }}>
                    <span className="font-bold">{row.key === "reaction" ? "회원 반응" : row.label}: </span>{row.text}
                  </p>
                )}
              </div>
            ))}
          </div>
        ) : <p data-briefing-fallback className="line-clamp-3 break-words" style={{ fontSize: TYPE.body, lineHeight: 1.5, color: INK2 }}>{fallback?.text}</p>}
      </Block>
      <Block title="최근 흐름" testId="recent-trend">
        <p className="tabular-nums" style={{ fontSize: TYPE.body, color: INK }} data-briefing-progress>{progress}</p>
        {recentTrend.items.length || recentTrend.openQuestions.length ? (
          <>
            <ul className="mt-1 space-y-1">
              {recentTrend.items.map((item, index) => <Sentence key={`t${index}`} id={`t${index}`} item={item} open={open === `t${index}`} onToggle={toggle} sessions={sessions} />)}
            </ul>
            {recentTrend.openQuestions.length ? (
              <>
                <p className="mt-2 font-bold" style={{ fontSize: TYPE.caption, color: SUB }}>계속 확인 중</p>
                <ul className="space-y-1">
                  {recentTrend.openQuestions.map((item, index) => <Sentence key={`q${index}`} id={`q${index}`} item={item} open={open === `q${index}`} onToggle={toggle} sessions={sessions} />)}
                </ul>
              </>
            ) : null}
          </>
        ) : null}
      </Block>
      {footer}
    </section>
  );
}
