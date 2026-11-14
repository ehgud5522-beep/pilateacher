import { useCallback, useEffect, useRef, useState } from 'react';
import { SharedBeforeAfter, sharingMessage } from '../../src/features/photos/SharedBeforeAfter.jsx';
import { memberPhotoSharing } from './firebase.js';

export default function MemberBeforeAfter({ scope, requestedShare, api = memberPhotoSharing }) {
  const request = useRef(0);
  const [shares, setShares] = useState([]), [selected, setSelected] = useState(null), [consent, setConsent] = useState('missing');
  const [agreed, setAgreed] = useState(false), [notify, setNotify] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const refresh = useCallback(async () => {
    const serial = ++request.current;
    try {
      if (!window.navigator.onLine) throw new Error('offline');
      const grant = await api({ action: 'consentStatus', ...scope });
      const result = await api({ action: 'memberList', ...scope });
      if (serial !== request.current) return;
      setConsent(grant.status); setShares(result.shares); setError('');
      setSelected((old) => old && result.shares.find((s) => s.id === old.id) || null);
    } catch (e) { if (serial !== request.current) return; setShares([]); setSelected(null); setError(sharingMessage(e)); }
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
  return <section className="stack private-member-sharing" aria-label="비포애프터">
    <h1>비포애프터</h1><button type="button" onClick={refresh}>새로고침</button><p>회원님의 변화 과정을 확인하세요.</p>
    {error && <p role="alert">{error}<button type="button" onClick={refresh}>다시 확인</button></p>}
    {consent !== 'granted' ? <div className="card stack"><h2>사진 공유 동의</h2><p>담당 선생님이 선택한 체형 사진·비교 결과와 피드백을 이 계정에서 비공개로 확인합니다. 기존 Firebase 저장소를 사용하며 외부 공개 링크를 만들지 않습니다. AI 분석 결과는 포함하지 않습니다.</p><p>동의하지 않아도 기존 수업 서비스를 이용할 수 있습니다. 언제든 동의를 철회할 수 있으며, 철회하면 공유 자료 열람이 차단됩니다. 이미 저장되거나 촬영된 사본은 회수할 수 없습니다.</p><label><input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />사진·비교·피드백을 회원앱에 공유하는 데 동의합니다.</label><label><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />새 공유 기록 알림 받기 (선택)</label><button className="share-confirm" type="button" disabled={!agreed || busy} onClick={() => saveConsent(true)}>동의하기</button></div> : <button type="button" disabled={busy} onClick={() => { if (window.confirm('사진 공유 동의를 철회할까요? 기존 공유 기록도 열람할 수 없게 됩니다.')) saveConsent(false); }}>공유 동의 철회</button>}
    {selected ? <div className="card"><button type="button" onClick={() => setSelected(null)}>목록으로</button><SharedBeforeAfter key={selected.id} share={selected} api={api} /></div> : shares.length ? shares.map((s) => <div className="card" key={s.id}><SharedBeforeAfter share={s} api={api} thumbnail /><button className="share-record" type="button" onClick={async () => { try { setSelected(await api({ action: 'read', shareId: s.id })); } catch (e) { setError(sharingMessage(e)); } }}>
      {s.unread && <strong>새 기록 · </strong>}{s.shareType === 'card' ? `${s.dates.join(' → ')} · 비교 카드 1장` : `${s.photos[0]?.date} · ${s.photos.length}장`}<p>{s.teacherName}</p>{s.shareType !== 'card' && <p>{s.feedback}</p>}
    </button></div>) : <div className="card"><p>아직 공유된 비포애프터 기록이 없습니다.</p><p>수업 후 담당 선생님이 공유한 사진을 이곳에서 확인할 수 있습니다.</p></div>}
  </section>;
}
