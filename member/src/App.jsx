/**
 * 회원 앱. 문서 하나를 그리는 일이다.
 *
 * ── 흐름 ──
 *   번호 입력 → 문자 인증 → linkMemberAccount() → 결과별 화면 → 홈
 *
 * 로그인해 있으면 인증을 건너뛰고 바로 읽는다. 다만 마지막 확인이 90일을
 * 넘었으면 다시 묻는다 (확정 5번, session.js).
 *
 * 로그아웃하면 onAuthStateChanged 가 null 을 주고, 아래 App 이 로그인 화면으로
 * 돌린다. 회원 화면은 user 가 있을 때만 그려지므로 로그아웃한 채로 들어갈
 * 길이 없다.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TYPE } from "../../src/features/ui/type-scale.js";
import { CENTRE_NAME, CENTRE_TAGLINE } from "./brand.js";
import { classifyPhoneAuthError } from "./auth-errors.js";
import {
  linkMemberAccount, resetRecaptcha, sendCode, signOutMember, watchAuth, db,
} from "./firebase.js";
import { LINK_RESULT, linkResultScreen } from "./link-result.js";
import { readMemberLink, readMemberViews } from "./member-data.js";
import {
  readCodeSentAt, resendSecondsLeft, sendButtonLabel, writeCodeSentAt,
} from "./resend.js";
import {
  clearMemberStorage, needsReverification, readVerifiedAt, writeVerifiedAt,
} from "./session.js";
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
const DEV = Boolean(import.meta.env?.DEV);

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

function Shell({ children, footer, onSignOut }) {
  return (
    <div className="shell">
      {/* 작고 얇게 위에만. 화면의 주인공은 남은 횟수다 -- 이름 쪽만 로즈로
          도드라지고 앞말은 물러나 있다. 로그아웃도 같은 줄에 물러나 있다 --
          어느 탭에서든 보이되 주인공을 가리지 않게. */}
      <header className="head">
        <span>{CENTRE_TAGLINE} <b>{CENTRE_NAME}</b></span>
        {onSignOut ? (
          <button type="button" className="signout" onClick={onSignOut}>로그아웃</button>
        ) : null}
      </header>
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
  /* 무엇을 하는 중인가 -- "send" · "confirm" · null. 보내는 중에 "확인" 이
     "보내는 중…" 이라고 말하지 않게 둘을 가른다. */
  const [busy, setBusy] = useState(null);
  const [failure, setFailure] = useState(null);
  /* 요청 중 두 번 누르기를 막는 것은 state 가 아니라 ref 다. setBusy 가 화면에
     반영되기 전에 두 번째 탭이 들어오면 disabled 는 아직 false 다. */
  const inFlight = useRef(false);

  // 마지막 발송 시각. 새로고침해도 기다림이 이어지도록 기기에서 읽어 온다.
  const [sentAt, setSentAt] = useState(() => readCodeSentAt());
  const [now, setNow] = useState(() => Date.now());
  const secondsLeft = resendSecondsLeft(sentAt, now);
  const waiting = secondsLeft > 0;
  useEffect(() => {
    if (!waiting) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [waiting]);

  /* 실패는 원본 코드를 남기고 종류별로 말한다 (auth-errors.js). 번호는 남기지
     않는다 -- 진단에 전화번호를 적지 않는다. */
  const fail = (stage, error) => {
    const result = classifyPhoneAuthError(error, { dev: DEV });
    console.error("[member/phone_auth]", {
      feature: "member_phone_auth", stage, errorDomain: "firebase_auth",
      errorCode: result.code, kind: result.kind, message: text(error?.message),
    });
    /* 한 번 실패한 reCAPTCHA 로 다시 보내면 같은 이유로 진다. 걷어 두면
       다음 "인증번호 받기" 가 새로 만든다. */
    if (result.resetRecaptcha) resetRecaptcha();
    if (result.restart) { setPending(null); setCode(""); }
    setFailure(result);
  };

  const send = async () => {
    if (inFlight.current || resendSecondsLeft(sentAt, Date.now()) > 0) return;
    inFlight.current = true;
    setBusy("send");
    setFailure(null);
    try {
      /* 다시 받기다. 앞의 발송에 쓴 reCAPTCHA 토큰은 이미 소모됐으므로 새로
         만든다 -- 같은 것으로 보내면 captcha 검증에서 진다. */
      if (pending) resetRecaptcha();
      const result = await sendCode(phone);
      const at = Date.now();
      writeCodeSentAt(at);
      setSentAt(at);
      setNow(at);
      setCode("");
      setPending(result);
    } catch (error) {
      fail("send_code", error);
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  };

  const confirm = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy("confirm");
    setFailure(null);
    try {
      await pending.confirm(code);
      // 확인한 시각을 남긴다. 여기서부터 90일이다.
      writeVerifiedAt(new Date());
      /* 새로고침으로 다시 들어간다. 인증 직후의 토큰에 phone_number 가 실려야
         서버가 그것을 믿을 수 있고, 새로 읽는 편이 확실하다. */
      window.location.reload();
    } catch (error) {
      fail("confirm_code", error);
    } finally {
      inFlight.current = false;
      setBusy(null);
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
            <button type="button" className="btn primary mt"
              disabled={Boolean(busy) || !phone || waiting}
              onClick={send}>{sendButtonLabel({ busy: busy === "send", secondsLeft })}</button>
          </>
        ) : (
          <>
            <input className="field mt" inputMode="numeric" autoComplete="one-time-code"
              placeholder="인증번호 6자리" value={code}
              onChange={(event) => setCode(event.target.value)} />
            <button type="button" className="btn primary mt" disabled={Boolean(busy) || !code}
              onClick={confirm}>{busy === "confirm" ? "확인하는 중…" : "확인"}</button>
            {/* 문자가 안 왔을 때. 60초 동안은 남은 초만 보인다. */}
            <button type="button" className="btn mt" disabled={Boolean(busy) || waiting}
              onClick={send}>
              {sendButtonLabel({ busy: busy === "send", secondsLeft, resend: true })}
            </button>
            {/* 번호를 잘못 넣었을 때 돌아갈 길. */}
            <button type="button" className="btn mt" disabled={Boolean(busy)}
              onClick={() => { setPending(null); setCode(""); setFailure(null); }}>
              번호 다시 입력
            </button>
          </>
        )}

        {/* 코드를 함께 보여준다. 코드 없는 "오류가 발생했습니다" 는 회원도
            센터도 아무것도 할 수 없게 만든다. */}
        {failure ? (
          <p className="note mt" role="alert" style={{ fontSize: TYPE.caption }}>
            {failure.text}
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

  /* 로그아웃 → onAuthStateChanged 가 null → App 이 로그인 화면을 그린다.
     여기서 화면을 직접 옮기지 않는다 -- 상태가 하나여야 어긋나지 않는다. */
  const signOutNow = async () => {
    if (!window.confirm("로그아웃할까요?")) return;
    try {
      await signOutMember();
      clearMemberStorage();
    } catch (error) {
      const code = text(error?.code) || "unknown";
      console.error("[member/sign_out]", {
        feature: "member_sign_out", stage: "sign_out", errorDomain: "firebase_auth",
        errorCode: code, message: text(error?.message),
      });
      window.alert(`로그아웃하지 못했어요. 잠시 후 다시 시도해 주세요. (코드 ${code})`);
    }
  };

  /* 불러오지 못했거나 연결이 안 된 화면에서도 로그아웃은 보인다. 다른 번호로
     들어가야 하는 사람이 갇히지 않게. */
  if (state.stage === "loading") return <Shell onSignOut={signOutNow}><Loading /></Shell>;
  if (state.stage === "failed") {
    return <Shell onSignOut={signOutNow}><LoadFailed code={state.code} onRetry={load} /></Shell>;
  }
  if (state.stage === "notice") {
    return <Shell onSignOut={signOutNow}><LinkNotice screen={state.screen} onRetry={load} /></Shell>;
  }

  const places = Array.isArray(state.places) ? state.places : [];
  const current = places[Math.min(place, Math.max(0, places.length - 1))] || null;

  let body;
  if (!current) body = <NotMigrated />;
  /* ── permission-denied 는 "없다" 는 뜻이다 ────────────────────────────
     memberViews 의 get 규칙이 resource.data.userId 를 읽는다. 문서가 없으면
     resource 가 null 이라 그 한 줄이 규칙을 넘어뜨리고, 서버는 "없음" 이 아니라
     **거부**로 답한다. 아래 Preparing 이 그리려던 바로 그 상태인데 여기서
     "불러오지 못했어요" 로 갈라졌다.

     이 앱이 읽는 clientId 는 자기 링크 문서에서 온 것뿐이라, 남의 투영을
     요청할 길이 없다 -- 거부가 나는 경우는 문서가 없을 때 하나다.

     근본 고침은 규칙에 있다 (resource == null 을 먼저 가르는 것). 그때까지
     화면이라도 정상 상태를 고장으로 말하지 않게 한다. */
  else if (current.errorCode === "permission-denied") body = <Preparing onRetry={load} />;
  else if (current.errorCode) body = <LoadFailed code={current.errorCode} onRetry={load} />;
  /* 연결은 됐는데 투영이 아직 없다 -- 트리거가 도는 몇 초다. "조회 실패" 로
     말하면 정상 상태를 고장으로 말하는 것이 된다. */
  else if (!current.view) body = <Preparing onRetry={load} />;
  else if (tab === "passes") body = <Passes view={current.view} />;
  else if (tab === "history") body = <History view={current.view} />;
  else if (tab === "more") body = <More view={current.view} />;
  else body = <Home view={current.view} />;

  return (
    <Shell footer={<Tabs tab={tab} onPick={setTab} />} onSignOut={signOutNow}>
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
