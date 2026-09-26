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
    const maxEdge = options.maxEdge || PHOTO_BACKUP_MAX_EDGE;
    /* 제한 안에 들어오는 JPEG 은 **다시 굽지 않고 그대로 올린다.**
       기기에 저장된 촬영 사진은 1080×1440 이라 1800 에 걸리지 않는데, 그것을
       q0.82 로 재인코딩하면 화질만 잃고 용량은 거의 그대로다. 원본 바이트를
       그대로 보내는 편이 모든 면에서 낫다.

       JPEG 일 때만이다 -- HEIC·PNG 를 그냥 올리면 image/jpeg 라고 적어 둔
       메타데이터와 실제 내용이 어긋난다. 썸네일은 항상 새로 만든다. */
    const withinLimit = Math.max(bitmap.width, bitmap.height) <= maxEdge;
    const image = withinLimit && blob.type === "image/jpeg"
      ? { blob, width: bitmap.width, height: bitmap.height }
      : await render(maxEdge, options.quality ?? PHOTO_BACKUP_QUALITY);
    const thumbnail = await render(options.thumbMaxEdge || PHOTO_THUMB_MAX_EDGE, options.thumbQuality ?? PHOTO_THUMB_QUALITY);
    return { image, thumbnail, sourceWidth: bitmap.width, sourceHeight: bitmap.height };
  } finally { bitmap.close?.(); }
}
