/**
 * 센터 운영 콘솔. PC 브라우저에서 /console 로 연다.
 *
 * FC매니저와 대표는 앱을 쓰지 않고 이 화면만 연다. 브라우저에 세션이 없으므로
 * 이메일·비밀번호 로그인만 둔다. 소셜 로그인도 회원가입도 없다 — 계정은 대표가
 * 만들어 나눠준다.
 *
 * App.jsx 의 인증 초기화를 복사하지 않는다. 재사용하는 것은 src/lib/firebase.js
 * 가 이미 내보내는 fbAuthStateReady / fbOnAuth / fbSignInEmail / fbSignOut 이고,
 * 계정 목록·프로필 복원·백업 복원·온보딩처럼 앱에만 필요한 단계는 가져오지
 * 않는다.
 */

import { useCallback, useEffect, useState } from "react";
import {
  fbAuthStateReady, fbOnAuth, fbReady, fbSignInEmail, fbSignOut,
} from "../lib/firebase.js";
import {
  UNRESOLVED_ORGANIZATION_CONTEXT, createFirestoreMembershipReader,
  readyOrganizationContext, resolveOrganizationContext,
} from "../data/repositories/organization-context.js";
import { classifySignInError, consoleLog } from "./console-diagnostics.js";

const SANS = "system-ui, -apple-system, Segoe UI, sans-serif";

const shell = {
  minHeight: "100vh",
  backgroundColor: "#f5f5f7",
  color: "#1d1d1f",
  fontFamily: SANS,
};
const centered = { ...shell, display: "flex", alignItems: "center", justifyContent: "center" };
const card = {
  width: 360, padding: 32, borderRadius: 16, backgroundColor: "#ffffff",
  boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
};
const input = {
  width: "100%", boxSizing: "border-box", padding: "10px 12px", marginTop: 6,
  border: "1px solid #d2d2d7", borderRadius: 8, fontSize: 14,
};
const button = {
  width: "100%", marginTop: 20, padding: "11px 12px", border: "none", borderRadius: 8,
  backgroundColor: "#1d1d1f", color: "#ffffff", fontSize: 14, fontWeight: 700, cursor: "pointer",
};
const muted = { marginTop: 10, fontSize: 13, color: "#6e6e73", lineHeight: 1.6 };
const notice = { marginTop: 14, fontSize: 13, lineHeight: 1.5, color: "#b3261e" };

function Panel({ title, children }) {
  return (
    <div style={centered}>
      <div style={card}>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>{title}</h1>
        {children}
      </div>
    </div>
  );
}

function SignInPanel({ onSignIn, pending, failure }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  return (
    <Panel title="필라티쳐 운영 콘솔">
      <p style={muted}>대표에게 받은 계정으로 로그인합니다.</p>
      <form onSubmit={(event) => { event.preventDefault(); onSignIn(email, password); }}>
        <label style={{ display: "block", marginTop: 18, fontSize: 13, fontWeight: 700 }}>
          이메일
          <input style={input} type="email" value={email} autoComplete="username"
            onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label style={{ display: "block", marginTop: 14, fontSize: 13, fontWeight: 700 }}>
          비밀번호
          <input style={input} type="password" value={password} autoComplete="current-password"
            onChange={(event) => setPassword(event.target.value)} />
        </label>
        <button style={{ ...button, opacity: pending ? 0.6 : 1 }} type="submit" disabled={pending}>
          {pending ? "확인 중…" : "로그인"}
        </button>
      </form>
      {failure ? <p style={notice}>{failure.message}</p> : null}
    </Panel>
  );
}

/**
 * @param {{ children?: any }} props
 */
export default function ConsoleApp({ children }) {
  const [authReady, setAuthReady] = useState(false);
  const [userId, setUserId] = useState("");
  const [organization, setOrganization] = useState(UNRESOLVED_ORGANIZATION_CONTEXT);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState(null);

  useEffect(() => {
    let alive = true;
    if (!fbReady) { setAuthReady(true); return undefined; }
    let stop = () => {};
    (async () => {
      await fbAuthStateReady();
      if (!alive) return;
      setAuthReady(true);
      stop = fbOnAuth(async (user) => {
        if (!alive) return;
        if (!user) {
          setUserId("");
          setOrganization(UNRESOLVED_ORGANIZATION_CONTEXT);
          return;
        }
        setUserId(user.id);
        const resolved = await resolveOrganizationContext(user.id, {
          listActiveMemberships: createFirestoreMembershipReader(),
          warn: (code, detail) => consoleLog(code, detail),
        });
        if (!alive) return;
        setOrganization(readyOrganizationContext(resolved));
        consoleLog("console_organization_resolved", {
          feature: "console_sign_in", stage: "organization_resolved",
          role: resolved.role, status: resolved.status, isLegacy: resolved.isLegacy,
        });
      });
    })();
    return () => { alive = false; try { stop(); } catch (_error) { /* 이미 해제된 경우 */ } };
  }, []);

  const signIn = useCallback(async (email, password) => {
    setPending(true);
    setFailure(null);
    consoleLog("console_sign_in_started", {
      feature: "console_sign_in", stage: "submit",
      hasEmail: Boolean(email), hasPassword: Boolean(password),
    });
    try {
      await fbSignInEmail(email, password);
    } catch (error) {
      setFailure(classifySignInError(error));
      consoleLog("console_sign_in_failed", {
        feature: "console_sign_in", stage: "submit", outcome: "failed",
        errorDomain: "firebase_auth", errorCode: String(error?.code || "unknown"),
        message: error?.message || "",
      });
    } finally {
      setPending(false);
    }
  }, []);

  const retryOrganization = useCallback(async () => {
    if (!userId) return;
    setOrganization(UNRESOLVED_ORGANIZATION_CONTEXT);
    const resolved = await resolveOrganizationContext(userId, {
      listActiveMemberships: createFirestoreMembershipReader(),
      warn: (code, detail) => consoleLog(code, detail),
    });
    setOrganization(readyOrganizationContext(resolved));
  }, [userId]);

  if (!fbReady) {
    return <Panel title="설정이 없습니다"><p style={notice}>Firebase 설정이 없어 콘솔을 열 수 없습니다.</p></Panel>;
  }
  if (!authReady) {
    return <Panel title="필라티쳐 운영 콘솔"><p style={muted}>불러오는 중…</p></Panel>;
  }
  if (!userId) {
    return <SignInPanel onSignIn={signIn} pending={pending} failure={failure} />;
  }
  if (!organization.ready) {
    return <Panel title="소속을 확인하는 중"><p style={muted}>잠시만 기다려 주세요.</p></Panel>;
  }
  if (organization.status === "unknown") {
    return (
      <Panel title="소속을 확인하지 못했습니다">
        <p style={muted}>
          네트워크 문제로 소속 정보를 읽지 못했습니다. 이 상태에서는 센터 기능을 열지 않습니다.
        </p>
        <button style={button} type="button" onClick={retryOrganization}>다시 시도</button>
      </Panel>
    );
  }
  if (organization.role !== "owner") {
    return (
      <Panel title="권한이 없습니다">
        <p style={muted}>운영 콘솔은 대표 계정만 사용할 수 있습니다.</p>
        <button style={{ ...button, backgroundColor: "#6e6e73" }} type="button"
          onClick={() => fbSignOut()}>로그아웃</button>
      </Panel>
    );
  }

  return (
    <div style={shell}>
      <header style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "16px 28px", backgroundColor: "#ffffff", borderBottom: "1px solid #e5e5ea",
      }}>
        <strong style={{ fontSize: 15 }}>필라티쳐 운영 콘솔</strong>
        <button style={{
          padding: "7px 14px", border: "1px solid #d2d2d7", borderRadius: 8,
          backgroundColor: "#ffffff", fontSize: 13, cursor: "pointer",
        }} type="button" onClick={() => fbSignOut()}>로그아웃</button>
      </header>
      <main style={{ padding: 28 }}>
        {typeof children === "function" ? children(organization) : children}
      </main>
    </div>
  );
}
