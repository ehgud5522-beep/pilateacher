import { useCallback, useEffect, useRef, useState } from 'react';
import { SharedBeforeAfter, sharingMessage } from '../../src/features/photos/SharedBeforeAfter.jsx';
import { isTransientSharingError } from '../../src/features/photos/sharing-errors.js';
import { memberPhotoSharing } from './firebase.js';
import { BEFORE_AFTER_PRIVACY, daysBetweenDates, dotDate } from './before-after-copy.js';
import { RETRY_DELAYS, readConsent, rememberConsent, scopeKey } from './before-after-state.js';

/* 보니따 앱 비포애프터 (2026-11-14 다시 그림, 11-15 안정화).
   목록은 가볍게 -- 카드 이미지는 기록을 열 때만 받는다. 전에는 목록 줄마다 카드(최대 4MB)를 받았다.

   11-15 대표: "새로고침을 해야 다시 제대로 뜸, 계속 잘 유지가 되게". 원인은 한 번의 실패였다 -- 앱이 뒤에서 돌아오는 순간 등
   연결이 잠깐 끊기면 Firebase 가 functions/internal 을 돌려주고(서버는 이 코드를 만들지 않는다), 화면은 받은 기록을 비우고
   "아직 받은 기록이 없어요" 와 오류를 띄웠다. 이제 잠깐 끊긴 실패는 보던 것을 그대로 두고 조금 뒤 다시 확인한다.
   동의 철회 · 공유 꺼짐처럼 결정된 실패만 보던 것을 거둔다. */

/* 마지막으로 받은 목록 -- 탭을 옮겼다 돌아와도 빈 화면부터 다시 그리지 않게. 메모리에만 둔다(기기에 쓰지 않는다). */
const lastSeen = new Map();

function ShareRow({ share, onOpen }) {
  const days = share.shareType === 'card' ? daysBetweenDates(share.dates?.[0], share.dates?.[1]) : null;
  const range = share.shareType === 'card'
    ? `${dotDate(share.dates?.[0])} → ${dotDate(share.dates?.[1])}`
    : `${dotDate(share.photos?.[0]?.date)} · 사진 ${share.photos?.length || 0}장`;
  return <button type="button" className="ba-share-row" onClick={onOpen}>
    <span className="ba-share-main">
      <span className="ba-share-title">{days ? <><b className="num">{days}</b>일의 변화</> : '비포애프터 기록'}{share.unread ? <i className="ba-share-new">새 기록</i> : null}</span>
      <span className="ba-share-sub num">{range}</span>
      <span className="ba-share-sub">{share.teacherName ? `${share.teacherName} 선생님` : '담당 선생님'}</span>
    </span>
    <span className="ba-share-go" aria-hidden="true">›</span>
  </button>;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export default function MemberBeforeAfter({ scope, requestedShare, api = memberPhotoSharing, storage = globalThis.localStorage }) {
  const key = scopeKey(scope);
  const seen = lastSeen.get(key);
  const request = useRef(0), retry = useRef({ timer: 0, attempt: 0 }), refreshRef = useRef(() => {});
  /* 기록을 열면 오른쪽에서 들어오고, 목록으로 돌아오면 왼쪽에서 들어온다 (motion.css). */
  const cameBack = useRef(false);
  const [shares, setShares] = useState(seen?.shares || []), [selected, setSelected] = useState(null);
  /* 'loading' 은 "아직 모름" 이다 -- 이때 동의 화면을 그리지 않는다. */
  const [consent, setConsent] = useState(() => seen?.consent || readConsent(storage, key) || 'loading');
  const [agreed, setAgreed] = useState(false), [notify, setNotify] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [shaky, setShaky] = useState(false), [loaded, setLoaded] = useState(Boolean(seen));

  const refresh = useCallback(async () => {
    const serial = ++request.current;
    clearTimeout(retry.current.timer);
    try {
      if (!window.navigator.onLine) throw new Error('offline');
      const grant = await api({ action: 'consentStatus', ...scope });
      const result = grant.status === 'granted' ? await api({ action: 'memberList', ...scope }) : { shares: [] };
      if (serial !== request.current) return;
      retry.current.attempt = 0;
      lastSeen.set(key, { consent: grant.status, shares: result.shares });
      rememberConsent(storage, key, grant.status);
      setConsent(grant.status); setShares(result.shares); setError(''); setShaky(false); setLoaded(true);
      setSelected((old) => old && result.shares.some((s) => s.id === old.id) ? old : null);
    } catch (e) {
      if (serial !== request.current) return;
      if (isTransientSharingError(e)) {
        /* 잠깐 끊긴 것 -- 보던 목록 · 동의 상태는 그대로. 조금 뒤 다시 확인하고, 그래도 안 되고 보여 줄 것도 없을 때만 말한다. */
        setShaky(true);
        const attempt = retry.current.attempt++;
        if (e?.message !== 'offline' && attempt < RETRY_DELAYS.length) {
          retry.current.timer = setTimeout(() => refreshRef.current(), RETRY_DELAYS[attempt]);
          return;
        }
        if (!lastSeen.has(key)) { setError(sharingMessage(e)); setLoaded(true); }
        return;
      }
      // 결정된 실패(동의 철회 · 공유 꺼짐 · 회원 연결 끊김 …) -- 보던 것을 거두고 이유를 말한다.
      lastSeen.delete(key);
      setShares([]); setSelected(null); setShaky(false); setError(sharingMessage(e)); setLoaded(true);
    }
  }, [scope.organizationId, scope.clientId, api, key, storage]);
  refreshRef.current = refresh;

  useEffect(() => {
    const again = () => { retry.current.attempt = 0; refreshRef.current(); };
    again();
    const timer = window.setInterval(() => refreshRef.current(), 15000);
    /* 연결이 끊기면 받은 것을 화면에서 거둔다(비공개 사진이 오프라인 화면에 남지 않게). 연결되면 바로 다시 받는다. */
    const offline = () => {
      request.current++; clearTimeout(retry.current.timer); lastSeen.delete(key);
      setShares([]); setSelected(null); setShaky(false);
      setError('인터넷 연결이 끊겨 기록을 잠시 숨겼어요. 연결되면 다시 보여 드려요.');
    };
    const visible = () => { if (document.visibilityState === 'visible') again(); };
    window.addEventListener('offline', offline); window.addEventListener('online', again); document.addEventListener('visibilitychange', visible);
    return () => {
      request.current++; window.clearInterval(timer); clearTimeout(retry.current.timer);
      window.removeEventListener('offline', offline); window.removeEventListener('online', again); document.removeEventListener('visibilitychange', visible);
    };
  }, [key]);

  /* 알림에서 연 기록. 잠깐 끊긴 실패면 두 번까지 다시 연다. */
  useEffect(() => {
    if (!requestedShare) return undefined;
    let active = true, timer = 0;
    const read = (attempt) => api({ action: 'read', shareId: requestedShare })
      .then((s) => { if (active) setSelected(s); })
      .catch((e) => {
        if (!active) return;
        if (isTransientSharingError(e) && e?.message !== 'offline' && attempt < 2) timer = setTimeout(() => read(attempt + 1), RETRY_DELAYS[attempt]);
        else setError(sharingMessage(e));
      });
    read(0);
    return () => { active = false; clearTimeout(timer); };
  }, [requestedShare, api]);

  const saveConsent = async (granted) => {
    setBusy(true);
    try { await api({ action: 'consent', ...scope, granted, confirmed: agreed, notifications: notify, version: 'before-after-member-v1' }); setSelected(null); await refresh(); }
    catch (e) { setError(sharingMessage(e)); } finally { setBusy(false); }
  };
  const open = async (s) => {
    try { setSelected(await api({ action: 'read', shareId: s.id })); }
    catch (e) {
      if (!isTransientSharingError(e) || e?.message === 'offline') { setError(sharingMessage(e)); return; }
      try { await wait(RETRY_DELAYS[0]); setSelected(await api({ action: 'read', shareId: s.id })); } catch (again) { setError(sharingMessage(again)); }
    }
  };
  const status = error
    ? <p role="alert" className="ba-error"><span>{error}</span><button type="button" onClick={() => { retry.current.attempt = 0; refresh(); }}>다시 확인</button></p>
    : shaky && loaded ? <p role="status" className="ba-quiet">연결이 잠시 불안정해요 · 곧 다시 확인할게요</p> : null;

  if (selected) {
    const days = selected.shareType === 'card' ? daysBetweenDates(selected.dates?.[0], selected.dates?.[1]) : null;
    cameBack.current = true;
    return <section className="stack private-member-sharing ba-member member-push" aria-label="비포애프터 기록">
      <div className="ba-member-head"><button type="button" className="ba-back" onClick={() => setSelected(null)} aria-label="목록으로">‹</button>
        <div><h1>{days ? `${days}일의 변화` : '비포애프터'}</h1><p className="muted num">{selected.teacherName ? `${selected.teacherName} 선생님` : '담당 선생님'}{selected.shareType === 'card' ? ` · ${dotDate(selected.dates?.[0])} → ${dotDate(selected.dates?.[1])}` : ''}</p></div></div>
      {status}
      <div className="card ba-member-card"><SharedBeforeAfter key={selected.id} share={selected} api={api} zoomable /></div>
      {selected.shareType === 'card' && <p className="ba-zoom-hint">카드를 누르면 크게 볼 수 있어요</p>}
      <p className="ba-privacy">{BEFORE_AFTER_PRIVACY}</p>
    </section>;
  }

  return <section className={`stack private-member-sharing ba-member${cameBack.current ? ' member-pop' : ''}`} aria-label="비포애프터">
    <div className="ba-member-head"><div><h1>비포애프터</h1><p className="muted">선생님이 남긴 회원님의 변화를 확인해요.</p></div>
      <button type="button" className="ba-refresh" onClick={() => { retry.current.attempt = 0; refresh(); }}>새로고침</button></div>
    {status}
    {consent === 'loading' ? (error ? null : <p className="ba-status" role="status">확인하고 있어요…</p>)
      : consent !== 'granted' ? <div className="card stack tight ba-consent"><h2>사진 공유 동의</h2>
        <p>담당 선생님이 선택한 비포애프터 비교 사진과 코멘트를 이 계정에서 비공개로 확인합니다. 외부 공개 링크를 만들지 않으며, AI 분석 결과는 포함하지 않습니다.</p>
        <p className="muted">동의하지 않아도 기존 수업 서비스를 이용할 수 있습니다. 언제든 동의를 철회할 수 있으며, 철회하면 공유 자료를 볼 수 없게 됩니다. 이미 저장되거나 촬영된 사본은 회수할 수 없습니다.</p>
        <label className="ba-check"><input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} /><span>비교 사진과 코멘트를 회원앱에서 받는 데 동의합니다.</span></label>
        <label className="ba-check"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /><span>새 기록 알림 받기 (선택)</span></label>
        <button className="share-confirm" type="button" disabled={!agreed || busy} onClick={() => saveConsent(true)}>동의하기</button></div>
      : <>
        {shares.length ? <div className="card ba-share-list">{shares.map((s) => <ShareRow key={s.id} share={s} onOpen={() => open(s)} />)}</div>
          : loaded && !error ? <div className="card quietcard ba-empty-share"><p>아직 받은 비포애프터 기록이 없어요.</p><p className="muted">수업 후 담당 선생님이 변화를 기록해 보내면 여기에서 볼 수 있어요.</p></div>
          : !loaded ? <p className="ba-status" role="status">확인하고 있어요…</p> : null}
        <button type="button" className="ba-withdraw" disabled={busy} onClick={() => { if (window.confirm('사진 공유 동의를 철회할까요? 받은 기록도 볼 수 없게 됩니다.')) saveConsent(false); }}>공유 동의 철회</button>
      </>}
    <p className="ba-privacy">{BEFORE_AFTER_PRIVACY}</p>
  </section>;
}
