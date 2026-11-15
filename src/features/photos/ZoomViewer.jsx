import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ZOOM_DOUBLE, clampView, zoomAt } from './zoom-view.js';
import { useMotionClose } from '../ui/use-motion-close.js';

/* 카드 크게 보기. 두 손가락으로 벌리기 · 한 손가락으로 옮기기 · 두 번 눌러 크게/원래대로 · PC 는 휠.
   같은 이미지(메모리의 blob 주소)를 그대로 크게 보여 줄 뿐이다 -- 저장 · 다운로드 · 새 주소를 만들지 않는다. */
const distance = ([a, b]) => Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
const middle = ([a, b]) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

export default function ZoomViewer({ src, alt, onClose }) {
  const stage = useRef(null), pointers = useRef(new Map()), gesture = useRef(null), lastTap = useRef({ at: 0, x: 0, y: 0 });
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  /* 닫을 때 번지듯 사라진다 (움직임 줄이기를 켠 기기에서는 바로 닫힌다). */
  const { closing, close } = useMotionClose(onClose);

  useEffect(() => {
    const key = (event) => { if (event.key === 'Escape') close(); };
    window.addEventListener('keydown', key);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', key); document.body.style.overflow = overflow; };
  }, [close]);

  const frame = () => stage.current?.getBoundingClientRect() || { left: 0, top: 0, width: 1, height: 1 };
  const size = () => { const r = frame(); return { width: r.width, height: r.height }; };
  const local = (event) => { const r = frame(); return { x: event.clientX - r.left - r.width / 2, y: event.clientY - r.top - r.height / 2 }; };

  const down = (event) => {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointers.current.set(event.pointerId, local(event));
    const points = [...pointers.current.values()];
    if (points.length >= 2) gesture.current = { kind: 'pinch', d0: distance(points), m0: middle(points), v0: viewRef.current };
    else gesture.current = { kind: 'pan', p0: points[0], v0: viewRef.current, moved: false };
  };
  const move = (event) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, local(event));
    const g = gesture.current, points = [...pointers.current.values()];
    if (!g) return;
    if (g.kind === 'pinch' && points.length >= 2) {
      const scaled = zoomAt(g.v0, g.v0.scale * (distance(points) / g.d0), g.m0, size());
      const m = middle(points);
      setView(clampView({ ...scaled, x: scaled.x + (m.x - g.m0.x), y: scaled.y + (m.y - g.m0.y) }, size()));
    } else if (g.kind === 'pan') {
      const dx = points[0].x - g.p0.x, dy = points[0].y - g.p0.y;
      if (Math.hypot(dx, dy) > 6) g.moved = true;
      if (g.v0.scale > 1) setView(clampView({ ...g.v0, x: g.v0.x + dx, y: g.v0.y + dy }, size()));
    }
  };
  const up = (event) => {
    const g = gesture.current, point = pointers.current.get(event.pointerId);
    pointers.current.delete(event.pointerId);
    if (g?.kind === 'pan' && !g.moved && point && event.type === 'pointerup') {
      const now = Date.now(), tap = lastTap.current;
      if (now - tap.at < 300 && Math.hypot(point.x - tap.x, point.y - tap.y) < 30) {
        const current = viewRef.current;
        setView(current.scale > 1.01 ? { scale: 1, x: 0, y: 0 } : zoomAt(current, ZOOM_DOUBLE, point, size()));
        lastTap.current = { at: 0, x: 0, y: 0 };
      } else lastTap.current = { at: now, x: point.x, y: point.y };
    }
    // 두 손가락 중 하나를 떼면 남은 손가락으로 이어서 옮긴다 -- 그 순간 사진이 튀지 않게.
    const rest = [...pointers.current.values()];
    gesture.current = rest.length ? { kind: 'pan', p0: rest[0], v0: viewRef.current, moved: true } : null;
  };
  const wheel = (event) => {
    const current = viewRef.current;
    setView(zoomAt(current, current.scale * Math.exp(-event.deltaY * 0.0015), local(event), size()));
  };

  return createPortal(
    <div className="zoom-viewer" role="dialog" aria-modal="true" aria-label="카드 크게 보기" data-closing={closing || undefined}>
      <button type="button" className="zoom-close" onClick={close} aria-label="크게 보기 닫기">닫기</button>
      <div ref={stage} className="zoom-stage" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onWheel={wheel}>
        <img src={src} alt={alt} draggable={false} onContextMenu={(event) => event.preventDefault()}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }} />
      </div>
      <p className="zoom-hint">{view.scale > 1.01 ? '두 번 누르면 원래 크기로 돌아가요' : '두 손가락으로 벌리거나 두 번 눌러 크게 볼 수 있어요'}</p>
    </div>,
    document.body,
  );
}
