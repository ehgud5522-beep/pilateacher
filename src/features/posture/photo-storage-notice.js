export const LOCAL_PHOTO_NOTICE_KEY = "pt_local_photo_notice_v1";

export const LOCAL_PHOTO_NOTICE_MESSAGE = "현재 원본 사진은 이 기기에 저장됩니다. 앱 삭제, 휴대폰 변경 또는 분실 시 사진을 복구하지 못할 수 있습니다.";

export function claimLocalPhotoNotice(storage, key = LOCAL_PHOTO_NOTICE_KEY) {
  try {
    if (storage?.getItem?.(key) === "shown") return false;
    storage?.setItem?.(key, "shown");
    return true;
  } catch (error) {
    return false;
  }
}
