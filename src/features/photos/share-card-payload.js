// Encode the already drawn Compare canvas exactly once. Preview and upload use these bytes.
export async function captureShareCard(canvas, pair, comment) {
  if (!canvas || canvas.width !== 1200) throw new Error('share/card-not-ready');
  const { width, height } = canvas;
  const preview = canvas.toDataURL('image/jpeg', 0.9);
  if (!preview.startsWith('data:image/jpeg;base64,')) throw new Error('share/card-not-jpeg');
  const cardBase64 = preview.slice(preview.indexOf(',') + 1);
  const bytes = Uint8Array.from(globalThis.atob(cardBase64), (c) => c.charCodeAt(0));
  if (bytes.length > 4 * 1024 * 1024) throw new Error('share/card-too-large');
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
  return { preview, cardBase64, sha256, bytes: bytes.length, width, height,
    dates: pair.map((p) => p.date), photoIds: pair.map((p) => p.sourcePhotoId || p.photoId || p.blobId || p.id), comment };
}
