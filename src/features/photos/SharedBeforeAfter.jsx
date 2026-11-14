import './private-sharing.css';
import { useEffect, useRef, useState } from 'react';
import { drawContained, renderAlbumPhoto } from './album-render.js';

import { sharingMessage } from './sharing-errors.js';
export { sharingMessage } from './sharing-errors.js';

export function SharedBeforeAfter(props) {
  return props.share.shareType === 'card' ? <SharedCard {...props} /> : <LegacySharedBeforeAfter {...props} />;
}

// Only memory-held blob URLs. Never write member photographs to the offline view cache.
function LegacySharedBeforeAfter({ share, api, thumbnail = false }) {
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
          const bytes = Uint8Array.from(window.globalThis.atob(result.base64), (c) => c.charCodeAt(0));
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

// Cards are never reconstructed, cached offline, or exposed through a public URL.
export function CardImage({ src, share, thumbnail = false }) {
  return <figure><img src={src} alt="공유된 비포애프터 비교 카드" draggable={false} style={{ width: '100%', maxHeight: thumbnail ? 180 : undefined, objectFit: 'contain' }} /><figcaption>{share.teacherName} · {(share.dates || []).join(' → ')}</figcaption></figure>;
}
function SharedCard({ share, api, thumbnail = false }) {
  const [src, setSrc] = useState(''), [error, setError] = useState(''), [epoch, setEpoch] = useState(0);
  useEffect(() => {
    let active = true, serial = 0, url = '';
    const clear = () => { serial++; if (url) URL.revokeObjectURL(url); url = ''; if (active) setSrc(''); };
    const load = async () => {
      clear(); const current = serial;
      try {
        if (!navigator.onLine || document.visibilityState === 'hidden') return;
        await api({ action: 'detail', shareId: share.id });
        const result = await api({ action: 'media', shareId: share.id });
        if (!active || current !== serial) return;
        url = URL.createObjectURL(new Blob([Uint8Array.from(globalThis.atob(result.base64), (c) => c.charCodeAt(0))], { type: 'image/jpeg' }));
        setSrc(url); setError('');
      } catch (e) { if (active && current === serial) { clear(); setError(sharingMessage(e)); } }
    };
    const verify = async () => {
      const current = serial;
      try { await api({ action: 'detail', shareId: share.id }); }
      catch (e) { if (active && current === serial) { clear(); setError(sharingMessage(e)); } }
    };
    const visibility = () => { if (document.visibilityState === 'hidden' || !navigator.onLine) clear(); else load(); };
    load(); const timer = setInterval(verify, 15000);
    window.addEventListener('offline', visibility); window.addEventListener('online', visibility); document.addEventListener('visibilitychange', visibility);
    return () => { active = false; clear(); clearInterval(timer); window.removeEventListener('offline', visibility); window.removeEventListener('online', visibility); document.removeEventListener('visibilitychange', visibility); };
  }, [share.id, api, epoch]);
  return <div className="private-share-view">{src ? <CardImage src={src} share={share} thumbnail={thumbnail} /> : error ? <p role="alert">{error}<button type="button" onClick={() => setEpoch((n) => n + 1)}>다시 확인</button></p> : <p role="status">카드를 확인하고 있습니다…</p>}</div>;
}
