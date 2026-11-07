/**
 * 업데이트 안내 화면 (2026-11-07, 지시서 11번). 앱 전체를 감싼다 (main.jsx).
 *
 * - 열 때 · 백그라운드에서 돌아올 때 확인한다 (스토어에서 돌아온 순간도 여기다)
 * - 권유: 아래에서 올라오는 안내 [지금 업데이트] [나중에] -- 나중에는 오늘만 쉰다
 * - 필수: 화면 전체를 덮는다. 닫기 · 나중에 없음. [지금 업데이트] 만. 로그인 화면도 덮는다
 * - **아래 앱은 내리지 않는다** -- 덮기만 한다. 입력 중이던 것이 사라지지 않는다
 * - 실패(스토어 열기 · 설치 취소 · 실패)는 원본 코드와 함께 진단에 남기고 [다시 시도] 를 둔다
 *
 * 서버 · 플러그인 호출은 넘겨받는다 (deps) -- 테스트가 가짜를 넘긴다.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { TYPE } from "../../src/features/ui/type-scale.js";
import {
  MEMBER_UPDATE_COPY, MEMBER_UPDATE_DEFAULTS, UPDATE_PROMPT, UPDATE_SNOOZE_KEY, UPDATE_START,
  appUpdatePlugin, decideMemberUpdate, nativePlatform, readMemberUpdateConfig, storeStateFrom, updateStartPlan,
} from "./app-update.js";
import { MEMBER_FEATURE, MEMBER_STAGE, recordDiagnostic } from "./diagnostics.js";

const text = (value) => String(value ?? "").trim();

function readSnooze(storage) {
  try { return storage?.getItem(UPDATE_SNOOZE_KEY) || ""; } catch (_error) { return ""; }
}
function writeSnooze(storage, at) {
  try { storage?.setItem(UPDATE_SNOOZE_KEY, at.toISOString()); } catch (_error) { /* 못 적어도 이번에는 닫힌다 */ }
}

/** 설치된 빌드 번호. 오프라인에서도 읽힌다 (@capacitor/app). */
async function installedBuildOf(globals) {
  const capacitor = globals?.Capacitor;
  const appPlugin = capacitor?.Plugins?.App || (typeof capacitor?.registerPlugin === "function" ? capacitor.registerPlugin("App") : null);
  const info = await appPlugin?.getInfo?.();
  return text(info?.build);
}

const defaultDeps = () => ({
  globals: globalThis,
  storage: (() => { try { return globalThis.localStorage; } catch (_error) { return null; } })(),
  now: () => new Date(),
  readConfig: async () => (await import("./firebase.js")).readUpdateRemoteConfig(MEMBER_UPDATE_DEFAULTS),
  openUrl: (url) => globalThis.open?.(url, "_blank"),
});

/**
 * @param {{ children: any, deps?: any, initialState?: any }} props
 *   initialState  스모크 · 화면 테스트가 첫 그림을 세우는 자리 ({ prompt, config, platform })
 */
export function UpdateGate({ children, deps: injected = null, initialState = null }) {
  const deps = useRef(injected || defaultDeps()).current;
  const [state, setState] = useState(initialState || { prompt: UPDATE_PROMPT.NONE });
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const checking = useRef(false);

  const check = useCallback(async () => {
    if (checking.current) return;
    const platform = nativePlatform(deps.globals);
    const plugin = appUpdatePlugin(deps.globals);
    if (platform === "web") return;
    checking.current = true;
    try {
      const [remote, installedBuild, info] = await Promise.all([
        deps.readConfig().catch((error) => ({ values: {}, fetched: false, errorCode: text(error?.code) || "unknown" })),
        installedBuildOf(deps.globals).catch(() => ""),
        plugin ? plugin.getAppUpdateInfo(platform === "ios" ? { country: "KR" } : {}).then((found) => ({ found }), (error) => ({ error }))
          : Promise.resolve({ error: { code: "plugin_missing" } }),
      ]);
      const config = readMemberUpdateConfig(remote.values);
      const store = storeStateFrom(platform, info.found);
      const decided = decideMemberUpdate({
        config, platform, installedBuild: installedBuild || store.installedBuild,
        store, snoozedAt: readSnooze(deps.storage), now: deps.now(),
      });
      /* 개수 · 번호 · 이유만. 이름 · 계정 없음. 원본 코드는 그대로. */
      recordDiagnostic({
        feature: MEMBER_FEATURE.APP_UPDATE, stage: MEMBER_STAGE.UPDATE_CHECK,
        errorDomain: info.error ? "capacitor_plugin" : remote.errorCode ? "remote_config" : "",
        errorCode: text(info.error?.code || info.error?.message) || remote.errorCode,
        message: `${decided.prompt} · ${decided.reason} · 설치 ${installedBuild || store.installedBuild || "?"} · 스토어 ${store.available === null ? "모름" : store.available ? "있음" : "없음"}`,
      });
      setState({ prompt: decided.prompt, reason: decided.reason, config, platform, store });
      if (decided.prompt === UPDATE_PROMPT.NONE) setFailure("");
    } finally {
      checking.current = false;
    }
  }, [deps]);

  useEffect(() => {
    if (initialState) return undefined;
    check();
    const onVisible = () => { if (globalThis.document?.visibilityState === "visible") check(); };
    globalThis.document?.addEventListener?.("visibilitychange", onVisible);
    return () => globalThis.document?.removeEventListener?.("visibilitychange", onVisible);
  }, [check, initialState]);

  const start = async () => {
    if (busy) return;
    setBusy(true);
    setFailure("");
    const plugin = appUpdatePlugin(deps.globals);
    const plan = updateStartPlan(state.platform, state.store, state.config);
    try {
      if (plan.kind === UPDATE_START.IMMEDIATE) {
        /* Play 즉시 업데이트. 설치가 끝나면 앱이 다시 시작된다. 취소 · 실패면 결과 코드가 온다. */
        const result = await plugin.performImmediateUpdate();
        const code = Number(result?.code);
        if (Number.isFinite(code) && code !== 0) throw Object.assign(new Error("immediate_update_not_ok"), { code: `result_${code}` });
      } else if (plan.kind === UPDATE_START.URL) {
        deps.openUrl(plan.url);
      } else {
        await plugin.openAppStore(state.platform === "ios" ? { country: "KR" } : {});
      }
      recordDiagnostic({ feature: MEMBER_FEATURE.APP_UPDATE, stage: MEMBER_STAGE.UPDATE_START, message: plan.kind });
    } catch (error) {
      recordDiagnostic({
        feature: MEMBER_FEATURE.APP_UPDATE, stage: MEMBER_STAGE.FAILED, errorDomain: "capacitor_plugin",
        errorCode: text(error?.code) || "unknown", message: `${plan.kind} · ${text(error?.message)}`,
      });
      setFailure(`${MEMBER_UPDATE_COPY.failed} (코드 ${text(error?.code) || "unknown"})`);
    } finally {
      setBusy(false);
    }
  };

  const later = () => {
    writeSnooze(deps.storage, deps.now());
    setState((current) => ({ ...current, prompt: UPDATE_PROMPT.NONE }));
  };

  const required = state.prompt === UPDATE_PROMPT.REQUIRED;
  const optional = state.prompt === UPDATE_PROMPT.OPTIONAL;
  const title = text(state.config?.title) || MEMBER_UPDATE_COPY.title;
  const message = text(state.config?.message) || (required ? MEMBER_UPDATE_COPY.required : MEMBER_UPDATE_COPY.optional);

  return (
    <>
      {/* 덮을 뿐 내리지 않는다 -- 입력 중이던 것이 남는다. 필수일 때는 눌리지도 읽히지도 않게. */}
      <div aria-hidden={required ? "true" : undefined} inert={required ? "" : undefined}>{children}</div>
      {required || optional ? (
        <div className={required ? "updatewall" : "sheetwrap"} role="alertdialog" aria-modal="true" aria-label={title} data-update-prompt={state.prompt}>
          <div className={required ? "updatecard" : "sheet"}>
            <p className="name">{title}</p>
            <p className="mt" style={{ fontSize: TYPE.body, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{message}</p>
            {failure ? <p className="blocked" role="alert">{failure}</p> : null}
            <button type="button" className="btn primary mt" disabled={busy} onClick={start} data-update-now>
              {busy ? MEMBER_UPDATE_COPY.updating : failure ? "다시 시도" : MEMBER_UPDATE_COPY.update}
            </button>
            {optional ? <button type="button" className="btn mt" disabled={busy} onClick={later} data-update-later>{MEMBER_UPDATE_COPY.later}</button> : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
