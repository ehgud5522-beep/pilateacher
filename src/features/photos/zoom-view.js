/* 카드 크게 보기의 계산 (2026-11-15 대표: "사진 확인하려고 확대가 안 됨, 눌러도 아무 반응이 없음").
   좌표는 무대(화면) 가운데를 0 으로 본다. 사진은 무대에 맞춰(contain) 놓이고, 그 위에 translate(x, y) scale(s) 를 건다.
   화면 위 한 점 p 에 놓인 사진의 점 u 는 p = x + s·u 이다 -- 배율을 바꿔도 손가락 아래 점이 그대로 있게 하는 식의 바탕. */
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 5;
/** 두 번 눌렀을 때의 배율 */
export const ZOOM_DOUBLE = 2.5;

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));

/** 사진이 무대 밖으로 빠져나가지 않게 이동을 막는다. 1배면 늘 가운데. */
export function clampView(view, size) {
  const scale = clamp(view?.scale || 1, ZOOM_MIN, ZOOM_MAX);
  if (scale <= ZOOM_MIN + 0.001) return { scale: ZOOM_MIN, x: 0, y: 0 };
  const maxX = (Math.max(1, size?.width || 1) * (scale - 1)) / 2;
  const maxY = (Math.max(1, size?.height || 1) * (scale - 1)) / 2;
  return { scale, x: clamp(view.x, -maxX, maxX), y: clamp(view.y, -maxY, maxY) };
}

/** point(무대 가운데 기준)를 손가락 아래에 둔 채 배율을 바꾼다. */
export function zoomAt(view, nextScale, point, size) {
  const from = clampView(view, size);
  const scale = clamp(nextScale, ZOOM_MIN, ZOOM_MAX);
  const k = scale / from.scale;
  return clampView({ scale, x: point.x - (point.x - from.x) * k, y: point.y - (point.y - from.y) * k }, size);
}
