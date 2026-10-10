/**
 * 회원 앱 **업로드 키**가 무엇인지 한 곳에 적는다.
 *
 * ── 왜 지문을 박아 두나 ──
 * 회원 앱은 강사 앱과 **다른 키**로 서명한다 (2026-10-10, 대표 결정). 한
 * 저장소에 키 설정이 둘 있고, 둘 다 `keystore.properties` 라는 같은 이름이라
 * 언젠가 섞인다. 섞여서 강사 앱 키로 서명된 회원 앱 번들은 **빌드가 통과하고**
 * Play 가 업로드에서 "다른 키" 라고 거절한다 -- 그 전까지 아무도 모른다.
 *
 * 그래서 만든 번들의 서명 지문을 이것과 맞춰 본다 (build-aab.mjs, Codemagic).
 * 지문은 비밀이 아니다 -- Firebase 콘솔에도 같은 값이 등록된다.
 *
 * ── 키를 바꾸면 ──
 * Play Console 에서 업로드 키 재설정을 요청한 뒤에만 여기를 고친다. 이
 * 값만 고치면 검사는 통과하고 업로드에서 거절당한다.
 */

export const MEMBER_UPLOAD_KEY = Object.freeze({
  alias: "bonita-member-upload",
  sha1: "4B:70:C9:9E:6F:7A:2D:AF:DD:0B:A9:46:09:B2:2D:14:B5:35:88:CA",
  sha256: "D4:89:56:28:97:19:9A:A2:84:1A:FD:CD:F6:5F:24:FD:B7:C6:0F:06:9C:95:42:AF:6D:01:CE:BE:03:74:06:F9",
});

const normalize = (value) => String(value ?? "").toUpperCase().replace(/[^0-9A-F]/g, "");

/**
 * `keytool -printcert` 출력에서 SHA1 을 찾아 회원 앱 업로드 키인지 본다.
 * **순수 함수다.**
 *
 * keytool 은 로캘을 따라 문구가 바뀌지만 `SHA1:` · `SHA-1:` 표기는 남는다.
 *
 * @param {string} keytoolOutput
 * @returns {{ ok: boolean, code: string, found: string }}
 */
export function checkUploadSignature(keytoolOutput) {
  const line = String(keytoolOutput ?? "").split(/\r?\n/)
    .find((row) => /SHA-?1\s*:/i.test(row));
  if (!line) return { ok: false, code: "SIGNATURE_UNREADABLE", found: "" };
  const found = line.slice(line.search(/:/) + 1).trim();
  if (normalize(found) !== normalize(MEMBER_UPLOAD_KEY.sha1)) {
    return { ok: false, code: "WRONG_UPLOAD_KEY", found };
  }
  return { ok: true, code: "OK", found };
}
