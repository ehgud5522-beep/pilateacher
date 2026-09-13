/* 사진에서 사람만 남기기 위한 마스크.

   기기 안에서만 돈다. 사진도 마스크도 밖으로 나가지 않는다 -- 모델 파일만
   받아 온다.

   포즈 분석이 쓰는 로더와 따로 둔다. 촬영·분석 경로는 손대지 않는다는 것이
   이번 작업의 조건이고, 라이브러리는 어차피 같은 CDN 파일이라 브라우저
   캐시에서 나온다. 공유해서 얻을 것이 없다. */

const MP_VER = "0.10.14";
const MP_LIB = [
  `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}/vision_bundle.mjs`,
  `https://unpkg.com/@mediapipe/tasks-vision@${MP_VER}/vision_bundle.mjs`,
];
const MP_WASM = [
  `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}/wasm`,
  `https://unpkg.com/@mediapipe/tasks-vision@${MP_VER}/wasm`,
];

/* 243KB. 셀카용으로 학습됐지만 3~4m 떨어진 전신에서도 머리카락·발끝까지
   잡는 것을 실제 사진으로 확인했다. 같은 사진에서 deeplab_v3(2.7MB)와
   IoU 0.87 로 사실상 같은 답을 냈고, 채널이 하나뿐이라 마스크 메모리가
   20분의 1이다. */
const SEGMENTER_MODEL = "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite";

/* 확신도 마스크를 쓴다. 카테고리 마스크는 0/1 이라 가장자리가 계단으로
   남는다 -- 머리카락과 손끝이 특히 상한다. */
const SEGMENTER_OPTIONS = { runningMode: "IMAGE", outputCategoryMask: false, outputConfidenceMasks: true };

/* 바디뷰가 꺼져 있으면 여기서 멈춘다. 화면이 뜨지 않으므로 불릴 일도
   없지만, 모델을 받지 않는다는 것은 눈에 보이는 자리에 적혀 있어야 한다
   -- 네트워크로 나가는 요청이라 조용히 사라지면 확인할 방법이 없다. */
import { BODY_VIEW_ENABLED } from "./posture-model.js";

let segmenterPromise = null;

/* 화면을 닫을 때 모델을 놓아준다. 마스크는 이미 기기에 있으므로 다시 열 때
   모델이 또 필요한 일은 드물고, 저사양 기기에서 붙들고 있을 이유가 없다. */
export function closeBodySegmenter() {
  const pending = segmenterPromise;
  segmenterPromise = null;
  Promise.resolve(pending).then((segmenter) => segmenter?.close?.()).catch(() => {});
}

/* 한 번만 받아 두고 계속 쓴다. 바디뷰를 열지 않으면 아무것도 받지 않는다. */
export function loadBodySegmenter({ log = () => {} } = {}) {
  if (!BODY_VIEW_ENABLED) return Promise.reject(new Error("body_view_disabled"));
  if (segmenterPromise) return segmenterPromise;
  segmenterPromise = (async () => {
    let dynamicImport = null;
    try { dynamicImport = new Function("url", "return import(url)"); } catch (_error) { dynamicImport = null; }
    let vision = null;
    let wasmBase = MP_WASM[0];
    for (let index = 0; index < MP_LIB.length; index += 1) {
      try {
        const loaded = dynamicImport ? await dynamicImport(MP_LIB[index]) : await import(MP_LIB[index]);
        if (loaded?.FilesetResolver && loaded?.ImageSegmenter) {
          vision = loaded;
          wasmBase = MP_WASM[index];
          log("segmenter_library_loaded", { source: index === 0 ? "jsdelivr" : "unpkg" });
          break;
        }
      } catch (error) {
        log("segmenter_library_load_failed", { source: index === 0 ? "jsdelivr" : "unpkg", error });
      }
    }
    if (!vision) throw new Error("segmenter_library_unavailable");
    const fileset = await vision.FilesetResolver.forVisionTasks(wasmBase);
    const make = (delegate) => vision.ImageSegmenter.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: SEGMENTER_MODEL, delegate },
      ...SEGMENTER_OPTIONS,
    });
    /* 포즈 로더와 같은 순서지만 같은 코드는 아니다. 태스크마다 델리게이트를
       따로 정하므로 폴백도 따로 가진다. */
    try {
      const segmenter = await make("GPU");
      log("segmenter_ready", { source: "GPU" });
      return segmenter;
    } catch (error) {
      log("segmenter_gpu_fallback", { source: "CPU", error });
      const segmenter = await make("CPU");
      log("segmenter_ready", { source: "CPU" });
      return segmenter;
    }
  })().catch((error) => {
    segmenterPromise = null;
    log("segmenter_failed", { error });
    throw error;
  });
  return segmenterPromise;
}

/* 마스크 하나를 회색 PNG 로 만든다. 저장하는 것은 마스크뿐이다 -- 사진을
   한 번 더 복사해 두지 않는다. 합성은 화면에서 한다. */
export async function personMaskPng(image, { log = () => {} } = {}) {
  if (!BODY_VIEW_ENABLED) return null;
  const width = Number(image?.naturalWidth || image?.width || 0);
  const height = Number(image?.naturalHeight || image?.height || 0);
  if (!width || !height) return null;
  const segmenter = await loadBodySegmenter({ log });
  const result = segmenter.segment(image);
  try {
    const mask = (result.confidenceMasks || [])[0];
    if (!mask) return null;
    const maskWidth = mask.width;
    const maskHeight = mask.height;
    const values = mask.getAsFloat32Array();
    const canvas = document.createElement("canvas");
    canvas.width = maskWidth;
    canvas.height = maskHeight;
    const context = canvas.getContext("2d");
    const pixels = context.createImageData(maskWidth, maskHeight);
    let covered = 0;
    for (let index = 0; index < maskWidth * maskHeight; index += 1) {
      const confidence = values[index];
      const level = confidence > 1 ? 255 : confidence < 0 ? 0 : Math.round(confidence * 255);
      pixels.data[index * 4] = level;
      pixels.data[index * 4 + 1] = level;
      pixels.data[index * 4 + 2] = level;
      pixels.data[index * 4 + 3] = 255;
      if (level >= 128) covered += 1;
    }
    context.putImageData(pixels, 0, 0);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) return null;
    return { blob, width: maskWidth, height: maskHeight, area: covered / (maskWidth * maskHeight) };
  } finally {
    result.close?.();
  }
}

/* 사진에 마스크를 씌워 사람만 남긴 그림. 마스크는 회색이고 알파가 아니므로
   여기서 밝기를 알파로 옮긴다.

   좌표는 건드리지 않는다 -- 같은 픽셀 격자에 알파만 다시 쓰므로, 정렬이
   준 배율·위치도 마커 자리도 그대로다. */
export async function composePersonCutout(image, maskImage) {
  const width = Number(image?.naturalWidth || image?.width || 0);
  const height = Number(image?.naturalHeight || image?.height || 0);
  if (!width || !height || !maskImage) return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0, width, height);
  const photo = context.getImageData(0, 0, width, height);

  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = width;
  maskCanvas.height = height;
  const maskContext = maskCanvas.getContext("2d");
  maskContext.drawImage(maskImage, 0, 0, width, height);
  const mask = maskContext.getImageData(0, 0, width, height);

  for (let index = 0; index < width * height; index += 1) {
    photo.data[index * 4 + 3] = mask.data[index * 4];
  }
  context.putImageData(photo, 0, 0);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}
