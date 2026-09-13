/* 사진 레코드가 IndexedDB 안의 이미지를 가리키는 필드 이름들.

   한 군데 목록으로 두는 이유가 있다. 이 이름들은 서로 멀리 떨어진 네 곳에서
   각각 열거되고 있었고, 새 필드를 하나 달면 네 곳을 모두 고쳐야 했다. 하나만
   빠뜨려도 조용히 다른 사고가 난다:

   - 정리 목록에서 빠지면 -> 아무도 가리키지 않는 이미지가 기기에 쌓인다
   - 계정 삭제 목록에서 빠지면 -> 삭제한 뒤에도 회원 신체 사진이 남는다
   - 백업 차단 목록에서 빠지면 -> 클라우드 사본에 끊어진 참조가 실린다

   실제로 thumbnailBlobId 가 계정 삭제 목록에서 빠져 있었다. 목록을 나눠 두면
   그런 일이 다시 난다. 그래서 하나로 합쳤다. */
export const PHOTO_BLOB_ID_FIELDS = Object.freeze([
  "blobId",
  "cleanBlobId",
  "thumbnailBlobId",
  "maskBlobId",
]);

/* 레코드 하나가 붙들고 있는 이미지 id 들. 없는 필드는 조용히 건너뛴다. */
export function photoBlobIdsIn(record) {
  if (!record || typeof record !== "object") return [];
  return PHOTO_BLOB_ID_FIELDS.map((field) => record[field]).filter((value) => typeof value === "string" && value);
}
