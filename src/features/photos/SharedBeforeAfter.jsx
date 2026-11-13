import './private-sharing.css';
import { useEffect, useRef, useState } from 'react';
import { drawContained, renderAlbumPhoto } from './album-render.js';

export const sharingMessage = (error) => {
  const code = String(error?.message || '');
  if (code.includes('consent')) return '회원앱에서 사진 공유 동의를 확인해 주세요.';
  if (code.includes('member-not-linked')) return '회원앱 계정 연결을 확인할 수 없습니다.';
  if (code.includes('photo-not-ready') || code.includes('photo-changed')) return '원본 서버 백업과 회원 연결을 확인한 뒤 다시 선택해 주세요.';
  if (code.includes('disabled')) return '비포애프터 공유는 아직 준비 중입니다.';
  if (code.includes('update-required')) return '앱을 최신 버전으로 업데이트해 주세요.';
  return '공유 자료를 확인할 수 없습니다. 연결·권한·공유 상태를 확인한 뒤 다시 시도해 주세요.';
};

// Only memory-held blob URLs. Never write member photographs to the offline view cache.
export function SharedBeforeAfter({ share, api, thumbnail = false }) {
  const [images, setImages] = useState([]), [error, setError] = useState(''), [epoch, setEpoch] = useState(0);
  const [mode, setMode] = useState(share.comparisonConfig?.mode || 'side');
  const [split, setSplit] = useState(share.comparisonConfig?.split ?? 50);
  const canvas = useRef(null);
  useEffect(() => {
    let active = true, serial = 0; const urls = new Set();
    const clear = () => { serial++; setImages([]); urls.forEach((url) => URL.revokeObjectURL(url)); urls.clear(); };
    const load = async () => {
      const request = ++serial;
      try {
        if (!navigator.onLine || document.visibilityState === 'hidden') throw new Error('offline');
        await api({ action: 'detail', shareId: share.id });
        const frames = [];
        for (const photo of (thumbnail ? share.photos.slice(0, 1) : share.photos)) {
          const result = await api({ action: 'media', shareId: share.id, photoId: photo.id });
          if (!active || request !== serial) return;
          const bytes = Uint8Array.from(window.atob(result.base64), (c) => c.charCodeAt(0));
          const url = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' })); urls.add(url);
          frames.push(await renderAlbumPhoto(url, photo.edit));
          URL.revokeObjectURL(url); urls.delete(url);
        }
        if (active && request === serial) { setImages(frames); setError(''); }
      } catch (e) { if (active && request === serial) { clear(); setError(sharingMessage(e)); } }
    };
    const verify = async () => {
      try { await api({ action: 'detail', shareId: share.id }); }
      catch (e) { if (active) { clear(); setError(sharingMessage(e)); } }
    };
    const hide = () => { if (!navigator.onLine || document.visibilityState === 'hidden') clear(); else load(); };
    load(); const timer = setInterval(verify, 15000);
    window.addEventListener('offline', hide); window.addEventListener('online', hide); document.addEventListener('visibilitychange', hide);
    return () => { active = false; serial++; clearInterval(timer); urls.forEach((url) => URL.revokeObjectURL(url)); window.removeEventListener('offline', hide); window.removeEventListener('online', hide); document.removeEventListener('visibilitychange', hide); };
  }, [share.id, share.photos, api, epoch, thumbnail]);
  useEffect(() => {
    const c = canvas.current; if (!c) return;
    c.width = 1200; c.height = 1400; const ctx = c.getContext('2d'); ctx.fillStyle = '#15151b'; ctx.fillRect(0, 0, 1200, 1400);
    if (images.length !== 2) return;
    const align = share.comparisonConfig?.align || [];
    if (mode === 'side') images.forEach((img, i) => drawContained(ctx, img, i * 600, 0, 600, 1400, align[i]));
    else { drawContained(ctx, images[0], 0, 0, 1200, 1400, align[0]); ctx.save(); ctx.beginPath(); ctx.rect(split * 12, 0, 1200 - split * 12, 1400); ctx.clip(); drawContained(ctx, images[1], 0, 0, 1200, 1400, align[1]); ctx.restore(); }
  }, [images, mode, split, share.comparisonConfig]);
  return <div className="private-share-view">
    {error ? <p role="alert">{error}<button type="button" onClick={() => setEpoch((n) => n + 1)}>다시 확인</button></p> : !images.length ? <p role="status">사진을 확인하고 있습니다…</p> : null}
    {!thumbnail && images.length > 0 && share.shareType === 'comparison' ? <>
      <p>BEFORE {share.photos[0].date} · AFTER {share.photos[1].date}</p>
      {share.photos[0].view !== share.photos[1].view && <p>촬영 방향이 달라 정확한 체형 비교가 어려울 수 있습니다.</p>}
      <canvas ref={canvas} style={{ width: '100%', maxHeight: '65vh', objectFit: 'contain' }} role="img" aria-label="공유된 비포애프터 비교" />
      <button type="button" aria-pressed={mode === 'side'} onClick={() => setMode('side')}>나란히</button><button type="button" aria-pressed={mode === 'overlay'} onClick={() => setMode('overlay')}>슬라이더 비교</button>
      {mode === 'overlay' && <label>겹침 슬라이더<input type="range" min="0" max="100" value={split} onChange={(e) => setSplit(Number(e.target.value))} /></label>}
    </> : images.map((frame, i) => <figure key={share.photos[i].id}><MemoryCanvas frame={frame} thumbnail={thumbnail} /><figcaption>{share.photos[i].date}</figcaption></figure>)}
    {!thumbnail && images.length > 0 && <><p>{share.teacherName}</p><p style={{ whiteSpace: 'pre-wrap' }}>{share.feedback}</p>
    <small>촬영 각도와 자세에 따라 다르게 보일 수 있습니다. 의료적 진단 자료가 아닙니다.</small></>}
  </div>;
}
function MemoryCanvas({ frame, thumbnail }) {
  const ref = useRef(null);
  useEffect(() => { const c = ref.current; c.width = frame.width; c.height = frame.height; c.getContext('2d').drawImage(frame, 0, 0); return () => { c.width = 1; c.height = 1; }; }, [frame]);
  return <canvas ref={ref} role="img" aria-label="공유된 사진" style={{ width: '100%', maxHeight: thumbnail ? 120 : '65vh', objectFit: 'contain' }} />;
}
