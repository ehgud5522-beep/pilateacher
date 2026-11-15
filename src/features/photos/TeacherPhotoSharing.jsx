import { useEffect, useRef, useState } from 'react';
import { SharedBeforeAfter, sharingMessage } from './SharedBeforeAfter.jsx';

export default function TeacherPhotoSharing({ api, member, organizationId, card, onClose }) {
  const [prepared, setPrepared] = useState(null), [shares, setShares] = useState([]);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [confirmed, setConfirmed] = useState(false), [sent, setSent] = useState(false);
  const operation = useRef(crypto.randomUUID());
  const scope = { organizationId, clientId: member.orgClientId };
  const refresh = async () => { const result = await api({ action: 'teacherList', ...scope }); setShares(result.shares); };
  useEffect(() => { let active = true; api({ action: 'teacherList', organizationId, clientId: member.orgClientId }).then((r) => { if (active) setShares(r.shares); }).catch((e) => { if (active) setMessage(sharingMessage(e)); }); return () => { active = false; }; }, [api, member.orgClientId, organizationId]);
  const run = async (fn) => { setBusy(true); setMessage(''); try { await fn(); } catch (e) { setMessage(sharingMessage(e)); } finally { setBusy(false); } };
  const publish = () => run(async () => {
    let draft = prepared;
    if (!draft) {
      const { preview: _preview, bytes: _bytes, ...payload } = card;
      draft = await api({ action: 'prepare', requestId: operation.current, ...scope, ...payload, shareType: 'card' });
      setPrepared(draft);
    }
    await api({ action: 'activate', shareId: draft.id, confirmed: true });
    setSent(true); setPrepared(null); setConfirmed(false);
    setMessage('회원앱에 공유했습니다. 알림 전송 결과와 별개로 공유가 저장되었습니다.'); await refresh();
  });
  return <section className="ba-panel private-share-teacher" aria-label="회원에게 비공개 공유">
    <div className="ba-toolbar"><h2>비교 카드 공유</h2><button type="button" disabled={busy} onClick={onClose}>닫기</button></div>
    {/* 회원 번호(긴 영문 · 숫자)는 화면에 쓰지 않는다 -- 강사가 읽을 수 없는 값이다. 연결이 안 됐을 때만 말한다. */}
    <p className="ba-share-to">받는 회원 <strong>{member.name}</strong>{!member.orgClientId && <em>센터 회원과 연결이 필요해요</em>}</p>
    {message && <p role="status" className="ba-notice">{message}</p>}
    {card && !sent && !prepared && <img className="ba-share-card" src={card.preview} alt="회원에게 공유할 완성된 비교 카드" />}
    {prepared && <SharedBeforeAfter share={prepared} api={api} />}
    {((card && !sent && !prepared) || prepared?.status === 'draft') && <>
      <label className="ba-share-confirm"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /><span>받는 회원과 카드의 사진·강사 코멘트를 확인했습니다.</span></label>
      <button type="button" className="ba-primary ba-share-send" disabled={busy || !confirmed || !member.orgClientId} onClick={publish}>공유하기</button>
    </>}
    {prepared && <button type="button" className="ba-share-back" disabled={busy} onClick={() => setPrepared(null)}>목록으로</button>}
    {!card && !prepared && !shares.length && <p>앨범에서 사진 두 장을 비교한 뒤 ‘회원에게 공유’를 눌러 주세요.</p>}
    {shares.length > 0 && <div className="ba-share-history"><h3>공유 기록</h3>{shares.map((s) => <div key={s.id} className="ba-share-item"><button type="button" disabled={busy} onClick={() => { setPrepared(s); setConfirmed(false); }}><i className={s.status === 'draft' ? 'is-draft' : ''}>{s.status === 'draft' ? '공유 준비' : '공개 중'}</i>{s.shareType === 'card' ? ((s.dates || []).filter(Boolean).join(' → ') || '비교 카드 1장') : `사진 ${s.photos.length}장`}</button><button type="button" disabled={busy} onClick={() => { if (window.confirm('공유를 취소할까요? 이미 저장되거나 촬영된 사본은 회수할 수 없습니다.')) run(async () => { await api({ action: 'revoke', shareId: s.id }); setPrepared(null); await refresh(); setMessage('공유를 취소했습니다.'); }); }}>공유 취소</button></div>)}</div>}
  </section>;
}
