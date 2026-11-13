import { useRef } from 'react';
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
export function gestureTransform(start, current, initial, width, height) {
  const midpoint = (p) => ({ x: p.reduce((n, v) => n + v.x, 0) / p.length, y: p.reduce((n, v) => n + v.y, 0) / p.length });
  const a = midpoint(start), b = midpoint(current);
  const distance = (p) => Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y);
  return { ...initial, x: clamp((initial.x || 0) + (b.x - a.x) * 100 / Math.max(1, width), -50, 50), y: clamp((initial.y || 0) + (b.y - a.y) * 100 / Math.max(1, height), -50, 50),
    zoom: clamp((initial.zoom || 1) * (start.length === 2 && current.length === 2 ? distance(current) / Math.max(1, distance(start)) : 1), 0.5, 3) };
}
export function usePhotoGestures(value, onChange) {
  const pointers = useRef(new Map()), base = useRef(null);
  const reset = () => { base.current = { points: [...pointers.current.values()], value }; };
  const end = (e) => { pointers.current.delete(e.pointerId); reset(); };
  return {
    onPointerDown: (e) => { if (!onChange) return; e.currentTarget.setPointerCapture(e.pointerId); pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); reset(); },
    onPointerMove: (e) => { if (!onChange || !pointers.current.has(e.pointerId) || !base.current) return; pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); const rect = e.currentTarget.getBoundingClientRect(); onChange(gestureTransform(base.current.points, [...pointers.current.values()], base.current.value, rect.width, rect.height)); },
    onPointerUp: end, onPointerCancel: end,
  };
}
