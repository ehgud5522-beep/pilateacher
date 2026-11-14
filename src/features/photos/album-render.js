import { DEFAULT_EDIT } from './photo-edit-model.js';

/* 펜 · 자 표시(marks)가 있는 사진은 표시를 그린 그 틀 그대로 먼저 만든다.
   표시 편집기(App.jsx PostureCanvas)는 3:4 틀에 사진을 꽉 채워(cover) 그리고 표시
   좌표를 그 틀의 0~1 로 저장한다 -- 같은 틀이 아니면 선이 엉뚱한 곳에 앉는다.
   옛 자세 사진의 회전 · 확대 · 위치(rot · scale · x · y)도 편집기와 같이 따른다. */
const MARK_FRAME = { width: 900, height: 1200 };
function markedFrame(img, overlay) {
  const { width: w, height: h } = MARK_FRAME;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
  const tf = overlay.transform || {};
  const s = Math.max(w / img.naturalWidth, h / img.naturalHeight) * (tf.scale || 1);
  ctx.save();
  ctx.translate(w / 2 + ((tf.x || 0) / 100) * w, h / 2 + ((tf.y || 0) / 100) * h);
  if (tf.rot) ctx.rotate((tf.rot * Math.PI) / 180);
  ctx.drawImage(img, -img.naturalWidth * s / 2, -img.naturalHeight * s / 2, img.naturalWidth * s, img.naturalHeight * s);
  ctx.restore();
  overlay.draw(ctx, overlay.marks, w, h);
  return canvas;
}

/**
 * @param {string} src
 * @param {object} [edits] 앨범 편집 (자르기 · 회전 · 확대 · 위치 · 밝기)
 * @param {number} [edge] 긴 변 최대 픽셀
 * @param {{ marks: any[], draw: (ctx: CanvasRenderingContext2D, marks: any[], w: number, h: number) => void, transform?: object } | null} [overlay]
 */
export async function renderAlbumPhoto(src, edits = {}, edge = 1400, overlay = null) {
  const loaded = new Image();
  await new Promise((resolve, reject) => { loaded.onload = resolve; loaded.onerror = () => reject(new Error('사진을 불러오지 못했습니다.')); loaded.src = src; });
  const source = overlay?.marks?.length && overlay.draw ? markedFrame(loaded, overlay) : loaded;
  const sw = source.naturalWidth || source.width, sh = source.naturalHeight || source.height;
  const e = { ...DEFAULT_EDIT, ...edits };
  const radians = e.rotate * Math.PI / 180;
  const width = Math.abs(sw * Math.cos(radians)) + Math.abs(sh * Math.sin(radians));
  const height = Math.abs(sw * Math.sin(radians)) + Math.abs(sh * Math.cos(radians));
  const scale = Math.min(1, edge / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale * (1 - e.crop / 100)));
  canvas.height = Math.max(1, Math.round(height * scale * (1 - e.crop / 100)));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#15151b'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.translate(canvas.width * (0.5 + e.x / 100), canvas.height * (0.5 + e.y / 100));
  ctx.rotate(radians); ctx.scale(scale * e.zoom, scale * e.zoom);
  ctx.filter = `brightness(${e.brightness})`;
  ctx.drawImage(source, -sw / 2, -sh / 2);
  return canvas;
}
export function drawContained(ctx, image, x, y, width, height, alignment = {}) {
  const scale = Math.min(width / image.width, height / image.height) * (alignment.zoom || 1);
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, width, height); ctx.clip();
  ctx.drawImage(image, x + (width - image.width * scale) / 2 + (alignment.x || 0) * width / 100, y + (height - image.height * scale) / 2 + (alignment.y || 0) * height / 100, image.width * scale, image.height * scale);
  ctx.restore();
}
