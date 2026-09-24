/**
 * 회원 앱. 문서 하나를 그리는 일이다.
 *
 * ── 흐름 ──
 *   번호 입력 → 문자 인증 → linkMemberAccount() → 결과별 화면 → 홈
 *
 * 로그인해 있으면 인증을 건너뛰고 바로 읽는다. 다만 마지막 확인이 90일을
 * 넘었으면 다시 묻는다 (확정 5번, session.js).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { TYPE } from "../../src/features/ui/type-scale.js";
import { CENTRE_NAME, CENTRE_TAGLINE } from "./brand.js";
import { linkMemberAccount, sendCode, watchAuth, db } from "./firebase.js";
import { LINK_RESULT, linkResultScreen } from "./link-result.js";
import { readMemberLink, readMemberViews } from "./member-data.js";
import { needsReverification, readVerifiedAt, writeVerifiedAt } from "./session.js";
import {
  History, Home, LinkNotice, LoadFailed, Loading, More, NotMigrated, Passes, Preparing,
} from "./screens.jsx";

/* 아이콘은 인라인 SVG 다. 아이콘 묶음을 하나 들이면 번들이 늘고, 이 앱이
   쓰는 것은 넷뿐이다. */
const TABS = [
  { key: "home", label: "홈", path: "M3 10.5 12 3l9 7.5M5.5 9.5V20h13V9.5" },
  { key: "passes", label: "회원권", path: "M3 9a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3zM3 11h18" },
  { key: "history", label: "수업", path: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M12 7v5l3 2" },
  { key: "more", label: "더보기", path: "M5 12h.01M12 12h.01M19 12h.01" },
];

const text = (value) => String(value ?? "").trim();

export default function App() {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  useEffect(() => watchAuth((found) => { setUser(found); setAuthReady(true); }), []);

  /* 로그인해 있어도 90일이 지났으면 다시 묻는다. 폰을 잃어버렸거나 번호가
     바뀐 사람이 영영 남의 잔여를 보고 있지 않게 하는 장치다 -- 서버가 막아
     주는 것이 아니라 앱이 스스로 닫는 것이다 (session.js). */
  const stale = useMemo(() => needsReverification(readVerifiedAt()), [user]);

  if (!authReady) return <Shell><Loading /></Shell>;
  if (!user || stale) return <SignIn signedIn={Boolean(user)} />;
  return <Member userId={user.uid} />;
}

function Shell({ children, footer }) {
  return (
    <div className="shell">
      {/* 작고 얇게 위에만. 화면의 주인공은 남은 횟수다 -- 이름 쪽만 로즈로
          도드라지고 앞말은 물러나 있다. */}
      <header className="head">{CENTRE_TAGLINE} <b>{CENTRE_NAME}</b></header>
      <main className="main">{children}</main>
      {footer}
      <div id="recaptcha" />
    </div>
  );
}

/* ── 번호 인증 ───────────────────────────────────────────────────────── */

function SignIn({ signedIn }) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");

  const send = async () => {
    setBusy(true);
    setFailure("");
    try {
      setPending(await sendCode(phone));
    } catch (error) {
      setFailure(text(error?.code) || "unknown");
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    setFailure("");
    try {
      await pending.confirm(code);
      // 확인한 시각을 남긴다. 여기서부터 90일이다.
      writeVerifiedAt(new Date());
      /* 새로고침으로 다시 들어간다. 인증 직후의 토큰에 phone_number 가 실려야
         서버가 그것을 믿을 수 있고, 새로 읽는 편이 확실하다. */
      window.location.reload();
    } catch (error) {
      setFailure(text(error?.code) || "unknown");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell>
      <section className="card">
        <p className="serif" style={{ fontSize: TYPE.heading, lineHeight: 1.5 }}>
          {signedIn
            ? <>오랜만이에요.<br />번호를 한 번 더 확인할게요.</>
            : <>휴대폰 번호로<br />시작해요</>}
        </p>
        <p className="muted mt" style={{ fontSize: TYPE.caption }}>
          센터에 등록된 번호를 입력해 주세요.
        </p>

        {!pending ? (
          <>
            <input className="field mt" inputMode="tel" autoComplete="tel"
              placeholder="010-0000-0000" value={phone}
              onChange={(event) => setPhone(event.target.value)} />
            <button type="button" className="btn primary mt" disabled={busy || !phone}
              onClick={send}>{busy ? "보내는 중…" : "인증번호 받기"}</button>
          </>
        ) : (
          <>
            <input className="field mt" inputMode="numeric" autoComplete="one-time-code"
              placeholder="인증번호 6자리" value={code}
              onChange={(event) => setCode(event.target.value)} />
            <button type="button" className="btn primary mt" disabled={busy || !code}
              onClick={confirm}>{busy ? "확인하는 중…" : "확인"}</button>
          </>
        )}

        {/* 코드를 함께 보여준다. 코드 없는 "오류가 발생했습니다" 는 회원도
            센터도 아무것도 할 수 없게 만든다. */}
        {failure ? (
          <p className="note mt" style={{ fontSize: TYPE.caption }}>
            {failure === "auth/invalid-verification-code"
              ? "인증번호가 맞지 않아요. 다시 입력해 주세요."
              : failure === "auth/too-many-requests"
                ? "잠시 뒤에 다시 시도해 주세요."
                : `지금 확인하지 못했어요. (코드 ${failure})`}
          </p>
        ) : null}
      </section>
    </Shell>
  );
}

/* ── 회원 화면 ───────────────────────────────────────────────────────── */

function Member({ userId }) {
  const [state, setState] = useState({ stage: "loading" });
  const [tab, setTab] = useState("home");
  const [place, setPlace] = useState(0);

  const load = useCallback(async () => {
    setState({ stage: "loading" });
    try {
      let link = await readMemberLink(db, userId);
      /* 링크 문서가 없으면 아직 이어지지 않은 계정이다. 이 순간이 첫 로그인이고,
         여기서 서버가 명부에서 이 번호를 찾는다. */
      if (!link) {
        const result = await linkMemberAccount();
        link = { status: text(result?.status), links: result?.links || [] };
      }
      const screen = linkResultScreen(link.status);
      if (!screen.opensHome) {
        setState({ stage: "notice", screen });
        return;
      }
      const found = await readMemberViews(db, link.links);
      setState({ stage: "ready", status: link.status, places: found });
    } catch (error) {
      setState({ stage: "failed", code: text(error?.code) || "unknown" });
    }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  if (state.stage === "loading") return <Shell><Loading /></Shell>;
  if (state.stage === "failed") return <Shell><LoadFailed code={state.code} onRetry={load} /></Shell>;
  if (state.stage === "notice") {
    return <Shell><LinkNotice screen={state.screen} onRetry={load} /></Shell>;
  }

  const places = Array.isArray(state.places) ? state.places : [];
  const current = places[Math.min(place, Math.max(0, places.length - 1))] || null;

  let body;
  if (!current) body = <NotMigrated />;
  else if (current.errorCode) body = <LoadFailed code={current.errorCode} onRetry={load} />;
  /* 연결은 됐는데 투영이 아직 없다 -- 트리거가 도는 몇 초다. "조회 실패" 로
     말하면 정상 상태를 고장으로 말하는 것이 된다. */
  else if (!current.view) body = <Preparing onRetry={load} />;
  else if (tab === "passes") body = <Passes view={current.view} />;
  else if (tab === "history") body = <History view={current.view} />;
  else if (tab === "more") body = <More view={current.view} />;
  else body = <Home view={current.view} />;

  return (
    <Shell footer={<Tabs tab={tab} onPick={setTab} />}>
      {/* 여러 지점에 등록된 회원은 지점마다 잔여가 따로다 (확정 7번). */}
      {places.length > 1 ? (
        <div className="chips">
          {places.map((item, index) => (
            <button key={`${item.link.organizationId}/${item.link.clientId}`} type="button"
              className={`chip${index === place ? " on" : ""}`}
              onClick={() => setPlace(index)}>
              {text(item.view?.locationName) || "지점"}
            </button>
          ))}
        </div>
      ) : null}
      {body}
    </Shell>
  );
}

function Tabs({ tab, onPick }) {
  return (
    <nav className="tabs">
      {TABS.map((item) => (
        <button key={item.key} type="button"
          className={`tab${tab === item.key ? " on" : ""}`}
          aria-current={tab === item.key ? "page" : undefined}
          onClick={() => onPick(item.key)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={item.path} />
          </svg>
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

export { LINK_RESULT, Member, SignIn, Tabs };
