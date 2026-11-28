/**
 * 공지 이미지를 줄인다 (2026-11-28). 긴 변 1080px · JPEG. 문서 한도 안에 들 때까지 화질을 내린다.
 * 브라우저에서만 쓴다 (canvas). 들지 못하면 code 를 가진 오류.
 */
import { MEMBER_NOTICE_IMAGE_MAX } from "../../../functions/shared/member-notice.mjs";

const MAX_SIDE = 1080;
const QUALITIES = [0.85, 0.75, 0.65, 0.55, 0.45];

export async function shrinkNoticeImage(file, { maxChars = MEMBER_NOTICE_IMAGE_MAX } = {}) {
  if (!file || !/^image\//.test(String(file.type || ""))) throw Object.assign(new Error("member_notice_image_type"), { code: "member_notice_image_type" });
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(Object.assign(new Error("member_notice_image_decode"), { code: "member_notice_image_decode" }));
      element.src = url;
    });
    let scale = Math.min(1, MAX_SIDE / Math.max(image.naturalWidth || 1, image.naturalHeight || 1));
    for (let round = 0; round < 3; round += 1) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (const quality of QUALITIES) {
        const data = canvas.toDataURL("image/jpeg", quality);
        if (data.length <= maxChars) return data;
      }
      scale *= 0.75;
    }
    throw Object.assign(new Error("member_notice_image_too_large"), { code: "member_notice_image_too_large" });
  } finally {
    URL.revokeObjectURL(url);
  }
}
