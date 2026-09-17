/**
 * 이관 업로드 양식(xlsx)을 만든다. 결과는 public/ 에 커밋되고, 앱은 그 파일을
 * 링크로 내려준다.
 *
 * ── 왜 정적 파일인가 ──
 * 바이트가 모든 사용자에게 같다. 브라우저에서 매번 만들면 같은 결과를 위해
 * 번들만 커진다.
 *
 * 그리고 결정적인 이유가 하나 더 있다. 이 양식의 존재 이유는 드롭다운이다 --
 * 급여카테고리와 결제수단을 손으로 치면 오타가 나고, 오타는 그 행을 실패로
 * 만든다. xlsx 의 데이터 유효성 검사(dataValidation)는 널리 쓰이는 무료
 * 쓰기 라이브러리들이 지원하지 않는다. 손으로 만든 파일만 그것을 담는다.
 *
 * 고칠 일이 생기면 이 스크립트를 고치고 다시 돌린다:
 *   node tools/migration/build-template.mjs
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { zipSync, strToU8 } from "fflate";

const OUT = fileURLToPath(new URL("../../public/pilateacher-migration-template.xlsx", import.meta.url));

/* 회원권 시트의 열. migration-repository.js 의 PASS_SHEET_COLUMNS 와 같아야
   한다 -- 어긋나면 업로드가 "열이 없습니다"로 전부 실패한다. */
const CLIENT_COLUMNS = ["회원명", "연락처", "지점"];
const PASS_COLUMNS = [
  "회원명", "연락처", "지점", "담당강사", "상품명", "급여카테고리",
  "총세션", "서비스세션", "남은횟수", "강사누적진행", "인수인계여부",
  "계약금액", "차수", "결제수단", "계약일", "만료일",
];

const CATEGORY_CHOICES = [
  "1:1 신규", "1:1 재등록(이벤트)", "1:1 재등록(정상)",
  "2:1 신규", "2:1 재등록", "서비스", "렛미인", "기타",
];
const PAYMENT_CHOICES = ["카드", "현금", "계좌", "제로페이", "바우처"];
const HANDOVER_CHOICES = ["Y", "N"];

const GUIDE = [
  ["필라티처 이관 양식"],
  [],
  ["순서"],
  ["1) \"1. 회원\" 시트를 채워 먼저 업로드합니다."],
  ["2) 업로드가 끝나면 \"2. 회원권\" 시트를 채워 업로드합니다."],
  ["   회원권은 이름과 연락처로 1차에서 만든 회원을 찾아 붙습니다."],
  [],
  ["주의"],
  ["· 2행의 예시는 지우고 올려 주세요."],
  ["· 연락처는 회원을 구분하는 기준입니다. 하이픈은 있어도 없어도 됩니다."],
  ["· 한 연락처에 두 사람을 넣으면 그 행은 실패로 보고됩니다."],
  ["· 급여카테고리 · 결제수단 · 인수인계여부는 칸을 눌러 목록에서 고르세요."],
  ["  직접 입력한 값이 목록에 없으면 그 행만 실패합니다."],
  ["· 지점과 담당강사는 앱에 등록된 이름과 정확히 같아야 합니다."],
  ["· 같은 이름의 강사가 둘이면 그 행은 실패로 보고됩니다."],
  [],
  ["실패해도 나머지는 저장됩니다"],
  ["· 실패한 행만 고쳐서 다시 올리면 됩니다."],
  ["· 같은 파일을 두 번 올려도 회원권이 두 번 발급되지 않습니다."],
  [],
  ["강사누적진행"],
  ["· 그 강사가 그 회원에게 지금까지 진행한 횟수입니다."],
  ["· 급여 단가가 이 숫자로 갈리므로 가능한 한 정확히 넣어 주세요."],
  ["· 모르는 건은 99 를 넣으면 기준 단가부터 시작합니다."],
  [],
  ["남은횟수 · 계약일 · 만료일"],
  ["· 남은횟수는 9월 말일 기준으로 남은 회차입니다."],
  ["· 날짜는 2026-09-30 또는 2026/9/30 형식으로 넣어 주세요."],
];

const CLIENT_EXAMPLE = ["김하나", "010-1234-5678", "반송점"];
const PASS_EXAMPLE = [
  "김하나", "010-1234-5678", "반송점", "정예진", "1:1 20회 가을 이벤트", "1:1 재등록(이벤트)",
  "20", "2", "8", "35", "N", "1300000", "2", "카드", "2026-08-01", "2027-02-01",
];

const escapeXml = (value) => String(value)
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&apos;");

const columnLetter = (index) => {
  let letter = "";
  let n = index;
  while (n >= 0) {
    letter = String.fromCharCode(65 + (n % 26)) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
};

/* 전부 inlineStr 로 쓴다. sharedStrings 를 두면 파일이 조금 작아지지만
   스크립트가 두 배로 길어지고, 이 파일은 몇 KB 다. */
const cell = (rowIndex, columnIndex, value) => {
  if (value === undefined || value === null || value === "") return "";
  const reference = `${columnLetter(columnIndex)}${rowIndex}`;
  return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
};

const sheetXml = (rows, validations = []) => {
  const body = rows.map((values, index) => {
    const rowIndex = index + 1;
    const cells = values.map((value, columnIndex) => cell(rowIndex, columnIndex, value)).join("");
    return `<row r="${rowIndex}">${cells}</row>`;
  }).join("");
  /* dataValidations 는 스키마상 sheetData 뒤에 와야 한다. 앞에 두면 엑셀이
     파일을 손상된 것으로 본다. */
  const validation = validations.length === 0 ? "" : [
    `<dataValidations count="${validations.length}">`,
    ...validations.map(({ sqref, choices }) => [
      `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1"`,
      ` errorTitle="목록에서 골라 주세요" error="이 칸은 목록에 있는 값만 넣을 수 있습니다."`,
      ` sqref="${sqref}"><formula1>"${escapeXml(choices.join(","))}"</formula1></dataValidation>`,
    ].join("")),
    "</dataValidations>",
  ].join("");
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    `<sheetData>${body}</sheetData>`,
    validation,
    "</worksheet>",
  ].join("");
};

const SHEETS = [
  { name: "안내", rows: GUIDE, validations: [] },
  { name: "1. 회원", rows: [CLIENT_COLUMNS, CLIENT_EXAMPLE], validations: [] },
  {
    name: "2. 회원권",
    rows: [PASS_COLUMNS, PASS_EXAMPLE],
    validations: [
      { sqref: `F2:F${1000}`, choices: CATEGORY_CHOICES },
      { sqref: `K2:K${1000}`, choices: HANDOVER_CHOICES },
      { sqref: `N2:N${1000}`, choices: PAYMENT_CHOICES },
    ],
  },
];

const contentTypes = [
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
  '<Default Extension="xml" ContentType="application/xml"/>',
  '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
  ...SHEETS.map((_sheet, index) =>
    `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`),
  "</Types>",
].join("");

const rootRels = [
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>',
  "</Relationships>",
].join("");

const workbook = [
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
  '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"',
  ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>',
  ...SHEETS.map((sheet, index) =>
    `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`),
  "</sheets></workbook>",
].join("");

const workbookRels = [
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
  ...SHEETS.map((_sheet, index) =>
    `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`),
  "</Relationships>",
].join("");

const files = {
  "[Content_Types].xml": strToU8(contentTypes),
  "_rels/.rels": strToU8(rootRels),
  "xl/workbook.xml": strToU8(workbook),
  "xl/_rels/workbook.xml.rels": strToU8(workbookRels),
};
SHEETS.forEach((sheet, index) => {
  files[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(sheetXml(sheet.rows, sheet.validations));
});

writeFileSync(OUT, Buffer.from(zipSync(files, { level: 6 })));
console.log(`wrote ${OUT}`);
