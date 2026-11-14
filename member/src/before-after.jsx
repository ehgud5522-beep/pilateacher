import { useCallback, useEffect, useRef, useState } from 'react';
import { SharedBeforeAfter, sharingMessage } from '../../src/features/photos/SharedBeforeAfter.jsx';
import { memberPhotoSharing } from './firebase.js';
import { BEFORE_AFTER_PRIVACY, daysBetweenDates, dotDate } from './before-after-copy.js';

/* 보니따 앱 비포애프터 (2026-11-14 다시 그림).
   목록은 가볍게 -- 카드 이미지는 기록을 열 때만 받는다. 전에는 목록 줄마다 카드(최대 4MB)를 받았다. */
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

export default function MemberBeforeAfter({ scope, requestedShare, api = memberPhotoSharing }) {
  const request = useRef(0);
  const [shares, setShares] = useState([]), [selected, setSelected] = useState(null), [consent, setConsent] = useState('missing');
  const [agreed, setAgreed] = useState(false), [notify, setNotify] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const refresh = useCallback(async () => {
    const serial = ++request.current;
    try {
      if (!window.navigator.onLine) throw new Error('offline');
      const grant = await api({ action: 'consentStatus', ...scope });
      const result = await api({ action: 'memberList', ...scope });
      if (serial !== request.current) return;
      setConsent(grant.status); setShares(result.shares); setError(''); setLoaded(true);
      setSelected((old) => old && result.shares.find((s) => s.id === old.id) || null);
    } catch (e) { if (serial !== request.current) return; setShares([]); setSelected(null); setError(sharingMessage(e)); setLoaded(true); }
  }, [scope.organizationId, scope.clientId, api]);
  useEffect(() => { refresh(); const timer = window.setInterval(refresh, 15000); const clear = () => { request.current++; setShares([]); setSelected(null); }; window.addEventListener('offline', clear); return () => { request.current++; window.clearInterval(timer); window.removeEventListener('offline', clear); }; }, [refresh]);
  useEffect(() => {
    if (!requestedShare) return;
    let active = true;
    api({ action: 'read', shareId: requestedShare }).then((s) => { if (active) setSelected(s); }).catch((e) => { if (active) setError(sharingMessage(e)); });
    return () => { active = false; };
  }, [requestedShare, api]);
  const saveConsent = async (granted) => {
    setBusy(true);
    try { await api({ action: 'consent', ...scope, granted, confirmed: agreed, notifications: notify, version: 'before-after-member-v1' }); setSelected(null); await refresh(); }
    catch (e) { setError(sharingMessage(e)); } finally { setBusy(false); }
  };
  const open = async (s) => { try { setSelected(await api({ action: 'read', shareId: s.id })); } catch (e) { setError(sharingMessage(e)); } };

  if (selected) {
    const days = selected.shareType === 'card' ? daysBetweenDates(selected.dates?.[0], selected.dates?.[1]) : null;
    return <section className="stack private-member-sharing ba-member" aria-label="비포애프터 기록">
      <div className="ba-member-head"><button type="button" className="ba-back" onClick={() => setSelected(null)} aria-label="목록으로">‹</button>
        <div><h1>{days ? `${days}일의 변화` : '비포애프터'}</h1><p className="muted num">{selected.teacherName ? `${selected.teacherName} 선생님` : '담당 선생님'}{selected.shareType === 'card' ? ` · ${dotDate(selected.dates?.[0])} → ${dotDate(selected.dates?.[1])}` : ''}</p></div></div>
      <div className="card ba-member-card"><SharedBeforeAfter key={selected.id} share={selected} api={api} /></div>
      <p className="ba-privacy">{BEFORE_AFTER_PRIVACY}</p>
    </section>;
  }

  return <section className="stack private-member-sharing ba-member" aria-label="비포애프터">
    <div className="ba-member-head"><div><h1>비포애프터</h1><p className="muted">선생님이 남긴 회원님의 변화를 확인해요.</p></div>
      <button type="button" className="ba-refresh" onClick={refresh}>새로고침</button></div>
    {error && <p role="alert" className="ba-error">{error}<button type="button" onClick={refresh}>다시 확인</button></p>}
    {consent !== 'granted' ? <div className="card stack tight ba-consent"><h2>사진 공유 동의</h2>
      <p>담당 선생님이 선택한 비포애프터 비교 사진과 코멘트를 이 계정에서 비공개로 확인합니다. 외부 공개 링크를 만들지 않으며, AI 분석 결과는 포함하지 않습니다.</p>
      <p className="muted">동의하지 않아도 기존 수업 서비스를 이용할 수 있습니다. 언제든 동의를 철회할 수 있으며, 철회하면 공유 자료를 볼 수 없게 됩니다. 이미 저장되거나 촬영된 사본은 회수할 수 없습니다.</p>
      <label className="ba-check"><input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />비교 사진과 코멘트를 회원앱에서 받는 데 동의합니다.</label>
      <label className="ba-check"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />새 기록 알림 받기 (선택)</label>
      <button className="share-confirm" type="button" disabled={!agreed || busy} onClick={() => saveConsent(true)}>동의하기</button></div>
      : <>
        {shares.length ? <div className="card ba-share-list">{shares.map((s) => <ShareRow key={s.id} share={s} onOpen={() => open(s)} />)}</div>
          : loaded ? <div className="card quietcard ba-empty-share"><p>아직 받은 비포애프터 기록이 없어요.</p><p className="muted">수업 후 담당 선생님이 변화를 기록해 보내면 여기에서 볼 수 있어요.</p></div> : <p className="muted" role="status">확인하고 있어요…</p>}
        <button type="button" className="ba-withdraw" disabled={busy} onClick={() => { if (window.confirm('사진 공유 동의를 철회할까요? 받은 기록도 볼 수 없게 됩니다.')) saveConsent(false); }}>공유 동의 철회</button>
      </>}
    <p className="ba-privacy">{BEFORE_AFTER_PRIVACY}</p>
  </section>;
}
