/* 두 사진 자동 맞춤 (2026-11-15 대표: "강사들이 편리함을 느껴야 해").
   찍은 거리와 위치가 다른 두 사진을, 사람의 크기와 자리가 같아지게 확대 · 이동 값을 정한다.
   강사가 두 손가락으로 일일이 맞추던 일이다.

   자세 점은 기기 안의 MediaPipe 가 찾는다(App.jsx loadLandmarker) -- 사진은 어디로도 나가지 않는다.
   여기는 계산만 한다: 점 → 몸의 기준(키 또는 몸통) → 카드 칸 안에서의 확대 · 위치.

   지키는 것 둘.
   ① 확대만 한다(1배 미만으로 줄이지 않는다) -- 줄이면 칸 가장자리에 빈 띠가 생긴다. 작게 찍힌 쪽을 키워 큰 쪽에 맞춘다.
   ② 옮길 때도 빈 띠가 생기지 않는 만큼만 옮긴다. 그 안에서 두 사람이 같은 자리에 오는 곳을 고른다. */

const MP = { nose: 0, shL: 11, shR: 12, hipL: 23, hipR: 24, ankL: 27, ankR: 28 };
export const ALIGN_VISIBILITY_MIN = 0.5;
export const ALIGN_ZOOM_MAX = 3;

/* 실패는 종류마다 코드가 다르다 (CLAUDE.md 실패 진단 원칙 1). */
export const ALIGN_ERROR = Object.freeze({
  NO_PERSON: 'align/person-not-found',      // 사람을 못 찾음
  NO_BODY: 'align/body-not-visible',        // 사람은 있는데 어깨 · 골반이 안 보임
  MODEL: 'align/model-unavailable',         // 인식 도구를 못 받음 (네트워크)
  UNKNOWN: 'align/unknown',
});
export function alignError(code, index = -1, cause = null) {
  return Object.assign(new Error(code), { code, index, cause });
}

const seen = (point) => point && Number.isFinite(point.x) && Number.isFinite(point.y) && (point.visibility ?? 1) >= ALIGN_VISIBILITY_MIN;
function middle(a, b) {
  const points = [a, b].filter(seen);
  if (!points.length) return null;
  return { x: points.reduce((sum, p) => sum + p.x, 0) / points.length, y: points.reduce((sum, p) => sum + p.y, 0) / points.length };
}

/**
 * 자세 점(0~1)에서 몸의 기준을 뽑는다.
 * full: 코 ~ 발목(전신이 보일 때), torso: 어깨 ~ 골반(상반신만 보일 때).
 * @returns {{ full: {cx:number, cy:number, length:number}|null, torso: {cx:number, cy:number, length:number}|null }}
 */
export function bodyFrame(landmarks) {
  if (!Array.isArray(landmarks) || !landmarks.length) throw alignError(ALIGN_ERROR.NO_PERSON);
  const shoulder = middle(landmarks[MP.shL], landmarks[MP.shR]);
  const hip = middle(landmarks[MP.hipL], landmarks[MP.hipR]);
  if (!shoulder || !hip) throw alignError(ALIGN_ERROR.NO_BODY);
  const torsoLength = Math.hypot(hip.x - shoulder.x, hip.y - shoulder.y);
  if (torsoLength < 0.04) throw alignError(ALIGN_ERROR.NO_BODY);
  const cx = (shoulder.x + hip.x) / 2;
  const torso = { cx, cy: (shoulder.y + hip.y) / 2, length: torsoLength };
  const nose = seen(landmarks[MP.nose]) ? landmarks[MP.nose] : null;
  const ankle = middle(landmarks[MP.ankL], landmarks[MP.ankR]);
  const full = nose && ankle && ankle.y - nose.y > torsoLength
    ? { cx, cy: (nose.y + ankle.y) / 2, length: ankle.y - nose.y }
    : null;
  return { full, torso };
}

/* 칸을 꽉 채운(cover) 사진의 크기. comparison-card.js drawCover 와 같은 식. */
const coverSize = (width, height, cellW, cellH, zoom) => {
  const scale = Math.max(cellW / width, cellH / height) * zoom;
  return { w: width * scale, h: height * scale };
};
/* 두 구간이 겹치면 그 안에서 가운데(want)에 가장 가까운 점, 안 겹치면 두 구간 사이의 한가운데. */
function meet(a, b, want) {
  const lo = Math.max(a[0], b[0]), hi = Math.min(a[1], b[1]);
  if (lo <= hi) return { at: Math.min(hi, Math.max(lo, want)), exact: true };
  return { at: (lo + hi) / 2, exact: false };
}

/**
 * @param {{ frame: ReturnType<typeof bodyFrame>, width: number, height: number }[]} photos 두 장 (BEFORE, AFTER)
 * @param {{ cellW: number, cellH: number }} cell 카드 사진 칸
 * @returns {{ align: {zoom:number,x:number,y:number}[], basis: 'full'|'torso', exact: boolean }}
 */
export function autoAlign(photos, cell) {
  const basis = photos.every((p) => p.frame.full) ? 'full' : 'torso';
  const parts = photos.map((p) => p.frame[basis]);
  // 1배일 때 칸 안에서의 몸 길이(px). 긴 쪽에 맞춘다 -- 작은 쪽만 키운다.
  const lengths = photos.map((p, i) => parts[i].length * coverSize(p.width, p.height, cell.cellW, cell.cellH, 1).h);
  const target = Math.max(...lengths);
  let exact = true;
  const zooms = lengths.map((length) => {
    const zoom = target / length;
    if (zoom > ALIGN_ZOOM_MAX) exact = false;
    return Math.min(ALIGN_ZOOM_MAX, Math.max(1, zoom));
  });
  // 빈 띠 없이 몸 가운데가 올 수 있는 범위: 가만히 둔 자리 ± 사진이 칸을 넘치는 만큼의 절반.
  const reach = photos.map((p, i) => {
    const size = coverSize(p.width, p.height, cell.cellW, cell.cellH, zooms[i]);
    const baseX = cell.cellW / 2 + (parts[i].cx - 0.5) * size.w, baseY = cell.cellH / 2 + (parts[i].cy - 0.5) * size.h;
    const slackX = Math.max(0, (size.w - cell.cellW) / 2), slackY = Math.max(0, (size.h - cell.cellH) / 2);
    return { baseX, baseY, x: [baseX - slackX, baseX + slackX], y: [baseY - slackY, baseY + slackY] };
  });
  const atX = meet(reach[0].x, reach[1].x, cell.cellW / 2), atY = meet(reach[0].y, reach[1].y, cell.cellH / 2);
  if (!atX.exact || !atY.exact) exact = false;
  const round = (value) => (Math.round(value * 100) / 100) || 0; // -0 을 0 으로
  const align = reach.map((r, i) => ({
    zoom: round(zooms[i]),
    x: round(Math.min(r.x[1], Math.max(r.x[0], atX.at)) - r.baseX) / cell.cellW * 100,
    y: round(Math.min(r.y[1], Math.max(r.y[0], atY.at)) - r.baseY) / cell.cellH * 100,
  })).map((a) => ({ zoom: a.zoom, x: round(a.x), y: round(a.y) }));
  return { align, basis, exact };
}

/** 사용자에게 보일 문구. 종류마다 다르고, 분류하지 못한 것은 코드를 함께 보여 준다. */
export function alignMessage(error) {
  const which = error?.index === 0 ? 'BEFORE' : error?.index === 1 ? 'AFTER' : '';
  const photo = which ? `${which} 사진` : '사진';
  /* 부위만 찍은 사진(목 · 골반 · 다리 …)은 자동으로 맞출 기준이 없다. 사진이 잘못된 것처럼 말하지 않고,
     어떤 사진에서 되는지와 부위 사진에서 쓸 방법을 말한다. */
  if (error?.code === ALIGN_ERROR.NO_PERSON) return `${photo}에서 몸 전체를 찾지 못했어요. 자동 맞춤은 전신 · 상반신 사진에서 돼요. 부위 사진은 직접 끌어 맞추거나, 다음부터 [지난 사진에 맞춰 찍기]로 찍어 주세요.`;
  if (error?.code === ALIGN_ERROR.NO_BODY) return `${photo}에 어깨와 골반이 함께 보이지 않아요. 자동 맞춤은 전신 · 상반신 사진에서 돼요. 부위 사진은 직접 끌어 맞추거나, 다음부터 [지난 사진에 맞춰 찍기]로 찍어 주세요.`;
  if (error?.code === ALIGN_ERROR.MODEL) return '자세 인식 도구를 받지 못했어요. 인터넷 연결을 확인한 뒤 다시 눌러 주세요.';
  return `자동으로 맞추지 못했어요 (코드 ${String(error?.code || ALIGN_ERROR.UNKNOWN).slice(0, 40)}). 직접 끌어서 맞춰 주세요.`;
}
