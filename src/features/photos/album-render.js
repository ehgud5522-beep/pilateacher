import { DEFAULT_EDIT } from './album-model.js';
export async function renderAlbumPhoto(src, edits = {}, edge = 1400) {
  const img = new Image();
  await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error('사진을 불러오지 못했습니다.')); img.src = src; });
  const e = { ...DEFAULT_EDIT, ...edits };
  const radians = e.rotate * Math.PI / 180;
  const width = Math.abs(img.naturalWidth * Math.cos(radians)) + Math.abs(img.naturalHeight * Math.sin(radians));
  const height = Math.abs(img.naturalWidth * Math.sin(radians)) + Math.abs(img.naturalHeight * Math.cos(radians));
  const scale = Math.min(1, edge / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale * (1 - e.crop / 100)));
  canvas.height = Math.max(1, Math.round(height * scale * (1 - e.crop / 100)));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#15151b'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.translate(canvas.width * (0.5 + e.x / 100), canvas.height * (0.5 + e.y / 100));
  ctx.rotate(radians); ctx.scale(scale * e.zoom, scale * e.zoom);
  ctx.filter = `brightness(${e.brightness})`;
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  return canvas;
}
export function drawContained(ctx, image, x, y, width, height, alignment = {}) {
  const scale = Math.min(width / image.width, height / image.height) * (alignment.zoom || 1);
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, width, height); ctx.clip();
  ctx.drawImage(image, x + (width - image.width * scale) / 2 + (alignment.x || 0) * width / 100, y + (height - image.height * scale) / 2 + (alignment.y || 0) * height / 100, image.width * scale, image.height * scale);
  ctx.restore();
}
