/**
 * 업로드된 xlsx 에서 시트 하나를 행 배열로 읽는다.
 *
 * ── 왜 직접 읽는가 ──
 * 필요한 것은 "문자열 칸 읽기" 하나뿐이다. 수식도 서식도 차트도 읽지 않는다.
 * 그 하나를 위해 수백 KB 짜리 스프레드시트 라이브러리를 앱에 넣으면, 1년에 한
 * 번 쓰는 이관 화면 때문에 모든 강사가 매일 그 무게를 내려받는다.
 *
 * fflate 는 압축 해제만 하고 8KB 다. XML 은 브라우저에 이미 있는 DOMParser 로
 * 읽는다. 둘 다 이 화면을 열 때만 불러온다 -- firebase 모듈을 다루는 방식과
 * 같다.
 *
 * ── CSV 를 받지 않는 것이 아니다 ──
 * CSV 도 그대로 받는다(migration-repository 의 parseCsv). 다만 대표가 엑셀에서
 * CSV 로 내보내는 과정에서 한글이 깨지는 일이 잦아, xlsx 를 직접 받는 길을
 * 함께 둔다.
 */

/** 셀 참조("C12")에서 열 번호(0부터)를 얻는다. */
export function columnIndexOf(reference) {
  const letters = String(reference ?? "").replace(/[^A-Z]/gi, "").toUpperCase();
  if (!letters) return -1;
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

/** 셀 참조에서 행 번호(1부터)를 얻는다. */
export function rowNumberOf(reference) {
  const digits = String(reference ?? "").replace(/\D/g, "");
  return digits ? Number(digits) : 0;
}

const textOf = (node) => (node ? node.textContent || "" : "");

/**
 * 시트 XML 한 장을 2차원 배열로 만든다.
 *
 * 빈 칸은 XML 에 아예 없다 -- 엑셀은 값이 있는 칸만 적는다. 그래서 순서대로
 * 읽지 않고 셀 참조가 말하는 자리에 넣는다. 그러지 않으면 중간이 빈 행에서
 * 열이 통째로 밀린다.
 *
 * @param {string} sheetXml
 * @param {Array<string>} sharedStrings
 * @returns {Array<Array<string>>}
 */
export function readSheetXml(sheetXml, sharedStrings = []) {
  const document = new globalThis.DOMParser().parseFromString(String(sheetXml ?? ""), "application/xml");
  const rows = [];
  for (const row of document.getElementsByTagName("row")) {
    const rowNumber = rowNumberOf(row.getAttribute("r")) || rows.length + 1;
    const values = [];
    for (const cell of row.getElementsByTagName("c")) {
      const columnIndex = columnIndexOf(cell.getAttribute("r"));
      if (columnIndex < 0) continue;
      const type = cell.getAttribute("t") || "";
      let value = "";
      if (type === "s") {
        // 공유 문자열 표를 가리키는 번호다.
        const index = Number(textOf(cell.getElementsByTagName("v")[0]));
        value = sharedStrings[index] ?? "";
      } else if (type === "inlineStr") {
        value = [...cell.getElementsByTagName("t")].map(textOf).join("");
      } else {
        value = textOf(cell.getElementsByTagName("v")[0]);
      }
      values[columnIndex] = String(value).trim();
    }
    rows[rowNumber - 1] = [...values].map((item) => item ?? "");
  }
  return [...rows]
    .map((row) => (row || []).map((value) => value ?? ""))
    .filter((row) => row.some((value) => String(value).trim() !== ""));
}

/** 공유 문자열 표. 엑셀이 같은 문구를 여러 칸에서 쓸 때 여기로 모은다. */
export function readSharedStrings(xml) {
  if (!xml) return [];
  const document = new globalThis.DOMParser().parseFromString(String(xml), "application/xml");
  return [...document.getElementsByTagName("si")].map((node) => (
    [...node.getElementsByTagName("t")].map(textOf).join("")
  ));
}

/** 통합 문서에 어떤 시트가 어떤 순서로 들어 있는가. */
export function readSheetNames(workbookXml) {
  if (!workbookXml) return [];
  const document = new globalThis.DOMParser().parseFromString(String(workbookXml), "application/xml");
  return [...document.getElementsByTagName("sheet")].map((node) => node.getAttribute("name") || "");
}

/**
 * xlsx 파일 하나를 시트 이름 → 행 배열로 읽는다.
 *
 * @param {ArrayBuffer | Uint8Array} buffer
 * @param {{ unzip?: (bytes: Uint8Array) => Record<string, Uint8Array> }} [options]
 * @returns {Promise<{ sheetNames: Array<string>, sheets: Record<string, Array<Array<string>>> }>}
 */
export async function readWorkbook(buffer, options = {}) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const unzip = options.unzip || (await import("fflate")).unzipSync;
  let files;
  try {
    files = unzip(bytes);
  } catch (error) {
    // 확장자만 xlsx 인 파일이 실제로 올라온다. "열 수 없다"고 말해야 한다.
    throw Object.assign(new Error("엑셀 파일로 읽을 수 없습니다."), { code: "invalid_workbook", cause: error });
  }

  const decode = (name) => (files[name] ? new globalThis.TextDecoder().decode(files[name]) : "");
  const sharedStrings = readSharedStrings(decode("xl/sharedStrings.xml"));
  const sheetNames = readSheetNames(decode("xl/workbook.xml"));
  const sheets = {};
  sheetNames.forEach((name, index) => {
    /* 시트 파일 이름은 workbook.xml.rels 가 정하지만, 엑셀과 구글 시트가 모두
       sheet1..N 순서로 내보낸다. 그 이름이 없으면 그 시트는 비어 있는 것으로
       둔다 -- 화면이 "시트를 찾을 수 없습니다"로 말한다. */
    const xml = decode(`xl/worksheets/sheet${index + 1}.xml`);
    sheets[name] = xml ? readSheetXml(xml, sharedStrings) : [];
  });
  return { sheetNames, sheets };
}

/** 행 배열을 CSV 문자열로. 파서 하나만 쓰기 위해 xlsx 를 CSV 모양으로 되돌린다. */
export function rowsToCsv(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => (
    (Array.isArray(row) ? row : []).map((value) => {
      const text = String(value ?? "");
      return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
    }).join(",")
  )).join("\n");
}
