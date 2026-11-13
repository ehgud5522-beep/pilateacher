import { useEffect, useRef, useState } from 'react';
import { SharedBeforeAfter, sharingMessage } from './SharedBeforeAfter.jsx';

export default function TeacherPhotoSharing({ api, member, organizationId, selectedPhotos, comparisonConfig, onClose }) {
  const [feedback, setFeedback] = useState(''), [prepared, setPrepared] = useState(null), [shares, setShares] = useState([]);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [confirmed, setConfirmed] = useState(false);
  const operation = useRef({ key: '', id: '' });
  const scope = { organizationId, clientId: member.orgClientId };
  const refresh = async () => { const result = await api({ action: 'teacherList', ...scope }); setShares(result.shares); };
  useEffect(() => { let active = true; api({ action: 'teacherList', organizationId, clientId: member.orgClientId }).then((r) => { if (active) setShares(r.shares); }).catch((e) => { if (active) setMessage(sharingMessage(e)); }); return () => { active = false; }; }, [api, member.orgClientId, organizationId]);
  const run = async (fn) => { setBusy(true); setMessage(''); try { await fn(); } catch (e) { setMessage(sharingMessage(e)); } finally { setBusy(false); } };
  const prepare = () => run(async () => {
    const input = { ...scope, photoIds: selectedPhotos.map((p) => p.sourcePhotoId || p.photoId || p.blobId || p.id), feedback,
      shareType: comparisonConfig ? 'comparison' : 'photos', comparisonConfig: comparisonConfig || null };
    const key = JSON.stringify(input);
    if (operation.current.key !== key) operation.current = { key, id: crypto.randomUUID() };
    setPrepared(await api({ action: 'prepare', requestId: operation.current.id, ...input })); setConfirmed(false);
  });
  return <section className="ba-panel private-share-teacher" aria-label="회원에게 비공개 공유">
    <div className="ba-toolbar"><h2>사진 공유하기</h2><button type="button" disabled={busy} onClick={onClose}>닫기</button></div>
    <p>받는 회원: {prepared?.memberName || member.name}</p><small>회원 식별번호: {member.orgClientId || '연결 필요'}</small>
    {message && <p role="status">{message}</p>}
    {!prepared ? <><p>선택한 사진 {selectedPhotos.length}장 · 서버에 저장된 사진과 편집 내용을 확인합니다.</p>
      <label>강사 피드백<textarea maxLength={1000} value={feedback} onChange={(e) => setFeedback(e.target.value)} /></label>
      <button type="button" disabled={busy || !selectedPhotos.length || selectedPhotos.length > 12 || !member.orgClientId} onClick={prepare}>공유 내용 미리보기</button></> : <>
      <SharedBeforeAfter share={prepared} api={api} />
      {prepared.status === 'draft' && <><label><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />받는 회원과 공개할 사진·피드백을 확인했습니다.</label>
        <button type="button" className="ba-primary" disabled={busy || !confirmed} onClick={() => run(async () => { await api({ action: 'activate', shareId: prepared.id, confirmed: true }); setPrepared(null); setMessage('회원앱에 공유했습니다. 알림 전송 결과와 별개로 공유가 저장되었습니다.'); await refresh(); })}>공유하기</button></>}
      <button type="button" disabled={busy} onClick={() => setPrepared(null)}>목록으로</button></>}
    <h3>공유 기록</h3>{shares.map((s) => <div key={s.id} className="ba-toolbar"><button type="button" onClick={() => { setPrepared(s); setConfirmed(false); }}>{s.status === 'draft' ? '공유 준비' : '공개 중'} · {s.photos.length}장</button><button type="button" disabled={busy} onClick={() => { if (window.confirm('공유를 취소할까요? 이미 저장되거나 촬영된 사본은 회수할 수 없습니다.')) run(async () => { await api({ action: 'revoke', shareId: s.id }); setPrepared(null); await refresh(); setMessage('공유를 취소했습니다.'); }); }}>공유 취소</button></div>)}
  </section>;
}
