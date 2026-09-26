/**
 * 큰 사진만 줄인다. 작은 사진은 손대지 않는다.
 *
 * ── 왜 "넘을 때만" 인가 ──
 * 체형 사진이 저장되는 길이 둘이고 크기가 스무 배 넘게 차이 난다.
 *
 *   CameraPreview.capture   1080×1440 q85   → 수백 KB
 *   시스템 카메라 폴백      센서 원본 q92   → 3~6 MB
 *
 * 앞의 것은 이미 충분히 작다. 그것까지 다시 인코딩하면 **화질은 잃고 용량은
 * 거의 그대로다** -- JPEG 을 다시 JPEG 으로 굽는 일은 공짜가 아니다. 그래서
 * 제한을 넘는 것만 줄이고, 넘지 않으면 **받은 blob 을 그대로 돌려준다.**
 * "그대로" 는 같은 객체라는 뜻이다 -- 바이트가 한 개도 바뀌지 않는다.
 *
 * ── 세로 사진이 눕지 않게 ──
 * `imageOrientation: "from-image"` 로 EXIF 방향을 **먼저 적용**한 뒤 잰다.
 * 그래야 세로로 찍은 사진의 긴 변이 세로로 읽히고, 줄인 결과도 세로다.
 * 이 옵션 없이 그리면 캔버스는 회전 정보를 모른 채 원시 픽셀을 그리므로
 * 사진이 눕는다 -- iOS 폴백 경로가 특히 그렇다.
 *
 * 방향을 못 읽으면 **줄이지 않는다.** 누운 사진을 만드느니 큰 파일이 낫다.
 * 크기는 다음 기회에 줄일 수 있지만 돌아간 사진은 되돌릴 수 없다.
 *
 * ── EXIF 는 따라오지 않는다 ──
 * 캔버스로 다시 구우면 결과에 EXIF 가 없다 -- GPS 도 촬영 기기 정보도
 * 함께 사라진다. 줄이지 않은 사진은 원본 그대로이므로 원본의 EXIF 를 지닌다.
 * 이 앱에서는 문제가 되지 않는다: 기본 촬영 경로인 @capgo/camera-preview 는
 * iOS 에서 위치를 끄도록 패치되어 있고(tools/patch-camera-preview-ios-no-location.mjs),
 * 위치가 붙을 수 있는 폴백 사진은 제한을 넘어 어차피 다시 구워진다.
 */

/** 촬영 사진을 기기에 저장할 때의 제한. */
export const CAPTURE_MAX_EDGE = 1600;
export const CAPTURE_QUALITY = 0.82;

/**
 * 긴 변이 제한을 넘을 때만 줄인다.
 *
 * @param {Blob} blob
 * @param {{ maxEdge?: number, quality?: number,
 *   createBitmap?: Function, createCanvas?: Function }} [options]
 * @returns {Promise<{ blob: Blob, resized: boolean, reason: string,
 *   width: number, height: number, sourceWidth: number, sourceHeight: number }>}
 *   resized 가 false 면 blob 은 **받은 것 그대로**다.
 */
export async function downscaleToFit(blob, options = {}) {
  if (!(blob instanceof Blob)) throw new TypeError("photo blob is required");
  const maxEdge = Number(options.maxEdge) > 0 ? Number(options.maxEdge) : CAPTURE_MAX_EDGE;
  const quality = options.quality ?? CAPTURE_QUALITY;
  const createBitmap = options.createBitmap || globalThis.createImageBitmap;
  const createCanvas = options.createCanvas
    || ((width, height) => Object.assign(document.createElement("canvas"), { width, height }));

  const unchanged = (reason, width = 0, height = 0) => ({
    blob, resized: false, reason, width, height, sourceWidth: width, sourceHeight: height,
  });

  if (typeof createBitmap !== "function") return unchanged("decoder_unavailable");

  /* 방향을 적용해서만 연다. 실패하면 방향 없이 다시 열지 않는다 -- 그렇게 연
     비트맵은 세로 사진을 가로로 내놓는다. 위 머리말 참고. */
  let bitmap = null;
  try { bitmap = await createBitmap(blob, { imageOrientation: "from-image" }); }
  catch (_error) { return unchanged("orientation_unknown"); }
  if (!bitmap) return unchanged("decode_failed");

  try {
    const sourceWidth = bitmap.width;
    const sourceHeight = bitmap.height;
    const longEdge = Math.max(sourceWidth, sourceHeight);

    /* 제한 안이어도 JPEG 일 때만 그냥 둔다. 20MB PNG 를 "줄일 필요 없음" 으로
       보내면 아끼려던 것을 그대로 저장하게 된다 -- 제한은 픽셀에만 걸려 있고
       용량은 인코딩이 정한다. */
    if (longEdge <= maxEdge && blob.type === "image/jpeg") {
      return unchanged("within_limit", sourceWidth, sourceHeight);
    }

    const scale = Math.min(1, maxEdge / longEdge);
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = createCanvas(width, height);
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);
    const output = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!output) return unchanged("encode_failed", sourceWidth, sourceHeight);
    return {
      blob: output,
      resized: true,
      reason: longEdge <= maxEdge ? "reencoded" : "downscaled",
      width, height, sourceWidth, sourceHeight,
    };
  } finally { bitmap.close?.(); }
}
