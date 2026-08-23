export const PHOTO_BACKUP_MAX_EDGE = 1800;
export const PHOTO_BACKUP_QUALITY = 0.82;
export const PHOTO_THUMB_MAX_EDGE = 320;
export const PHOTO_THUMB_QUALITY = 0.68;

export async function optimizePhotoBackup(blob, options = {}) {
  if (!(blob instanceof Blob)) throw new TypeError("photo blob is required");
  const createBitmap = options.createBitmap || globalThis.createImageBitmap;
  const createCanvas = options.createCanvas || (() => document.createElement("canvas"));
  if (typeof createBitmap !== "function") throw new Error("image decoder is unavailable");
  const bitmap = await createBitmap(blob, { imageOrientation: "from-image" });
  const render = async (maxEdge, quality) => {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = createCanvas(width, height);
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);
    const output = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("image encoding failed")), "image/jpeg", quality));
    return { blob: output, width, height };
  };
  try {
    const image = await render(options.maxEdge || PHOTO_BACKUP_MAX_EDGE, options.quality ?? PHOTO_BACKUP_QUALITY);
    const thumbnail = await render(options.thumbMaxEdge || PHOTO_THUMB_MAX_EDGE, options.thumbQuality ?? PHOTO_THUMB_QUALITY);
    return { image, thumbnail, sourceWidth: bitmap.width, sourceHeight: bitmap.height };
  } finally { bitmap.close?.(); }
}
