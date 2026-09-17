import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
import {
  columnIndexOf, readSharedStrings, readSheetNames, readSheetXml, readWorkbook,
  rowNumberOf, rowsToCsv,
} from "../../src/data/repositories/xlsx-reader.js";
import {
  CLIENT_SHEET_COLUMNS, PASS_SHEET_COLUMNS, planClientMigration, planPassMigration,
} from "../../src/data/repositories/migration-repository.js";

/* DOMParser 는 브라우저에 있고 node 에는 없다. 리더가 쓰는 표면이 좁아서
   (getElementsByTagName · textContent · getAttribute) 여기서 세운다. */
const { JSDOM } = await import("jsdom").catch(() => ({ JSDOM: null }));
const hasDom = Boolean(JSDOM);
if (hasDom) globalThis.DOMParser = new JSDOM().window.DOMParser;

const TEMPLATE = fileURLToPath(new URL("../../public/pilateacher-migration-template.xlsx", import.meta.url));

test("a cell reference says which column and row it is", () => {
  assert.equal(columnIndexOf("A1"), 0);
  assert.equal(columnIndexOf("C12"), 2);
  assert.equal(columnIndexOf("AA3"), 26);
  assert.equal(columnIndexOf(""), -1);
  assert.equal(rowNumberOf("C12"), 12);
  assert.equal(rowNumberOf("AA100"), 100);
});

test("rows become csv the one parser already understands", () => {
  assert.equal(rowsToCsv([["a", "b"], ["1", "2"]]), "a,b\n1,2");
  // 쉼표와 따옴표가 든 칸은 다시 감싼다. 그러지 않으면 파서가 열을 쪼갠다.
  assert.equal(rowsToCsv([["김,하나", '그는 "안녕"']]), '"김,하나","그는 ""안녕"""');
  assert.equal(rowsToCsv(undefined), "");
});

test("the committed template is a real workbook with three sheets", () => {
  /* 이 파일이 깨지면 대표의 첫 시도가 실패한다. 빌드 스크립트를 고치고 다시
     돌리는 것을 잊었을 때 여기서 걸린다. */
  const files = unzipSync(new Uint8Array(readFileSync(TEMPLATE)));
  for (const required of [
    "[Content_Types].xml", "_rels/.rels", "xl/workbook.xml",
    "xl/_rels/workbook.xml.rels", "xl/worksheets/sheet3.xml",
  ]) {
    assert.ok(files[required], `${required} 이(가) 없다`);
  }
});

test("the template offers the three dropdowns that stop the typos", () => {
  /* 양식이 xlsx 인 유일한 이유다. CSV 로는 이것을 줄 수 없다. */
  const files = unzipSync(new Uint8Array(readFileSync(TEMPLATE)));
  const sheet = new globalThis.TextDecoder().decode(files["xl/worksheets/sheet3.xml"]);
  assert.equal((sheet.match(/<dataValidation /g) || []).length, 3);
  assert.match(sheet, /sqref="F2:F1000"/, "급여카테고리");
  assert.match(sheet, /sqref="K2:K1000"/, "인수인계여부");
  assert.match(sheet, /sqref="N2:N1000"/, "결제수단");
  assert.match(sheet, /1:1 재등록\(이벤트\)/);
  assert.match(sheet, /제로페이/);
  // dataValidations 는 sheetData 뒤여야 한다. 앞이면 엑셀이 손상으로 본다.
  assert.ok(sheet.indexOf("</sheetData>") < sheet.indexOf("<dataValidations"));
});

test("the template's columns are exactly the ones the parser expects", () => {
  /* 양식과 파서가 어긋나면 업로드가 "열이 없습니다"로 전부 실패한다. */
  const files = unzipSync(new Uint8Array(readFileSync(TEMPLATE)));
  const decode = (name) => new globalThis.TextDecoder().decode(files[name]);
  for (const column of CLIENT_SHEET_COLUMNS) {
    assert.match(decode("xl/worksheets/sheet2.xml"), new RegExp(column), `1. 회원 시트에 ${column}`);
  }
  for (const column of PASS_SHEET_COLUMNS) {
    assert.match(decode("xl/worksheets/sheet3.xml"), new RegExp(column), `2. 회원권 시트에 ${column}`);
  }
});

test("the template names its sheets in the order the screen expects", { skip: !hasDom }, () => {
  const files = unzipSync(new Uint8Array(readFileSync(TEMPLATE)));
  const names = readSheetNames(new globalThis.TextDecoder().decode(files["xl/workbook.xml"]));
  assert.deepEqual(names, ["안내", "1. 회원", "2. 회원권"]);
});

test("a sheet with gaps keeps its columns in place", { skip: !hasDom }, () => {
  /* 빈 칸은 XML 에 아예 없다. 순서대로 읽으면 중간이 빈 행에서 열이 통째로
     밀리고, 연락처 자리에 지점이 들어간다. */
  const xml = [
    '<worksheet><sheetData>',
    '<row r="1"><c r="A1" t="inlineStr"><is><t>회원명</t></is></c>',
    '<c r="C1" t="inlineStr"><is><t>지점</t></is></c></row>',
    '<row r="2"><c r="C2" t="inlineStr"><is><t>반송점</t></is></c></row>',
    '</sheetData></worksheet>',
  ].join("");
  const rows = readSheetXml(xml);
  assert.equal(rows[0][0], "회원명");
  assert.equal(rows[0][2], "지점");
  assert.equal(rows[1][0], "");
  assert.equal(rows[1][2], "반송점");
});

test("shared strings are resolved to their text", { skip: !hasDom }, () => {
  const shared = readSharedStrings('<sst><si><t>김하나</t></si><si><t>반송점</t></si></sst>');
  assert.deepEqual(shared, ["김하나", "반송점"]);
  const xml = '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row></sheetData></worksheet>';
  assert.deepEqual(readSheetXml(xml, shared), [["김하나", "반송점"]]);
});

test("a number cell reads as its digits", { skip: !hasDom }, () => {
  const xml = '<worksheet><sheetData><row r="1"><c r="A1"><v>1300000</v></c></row></sheetData></worksheet>';
  assert.deepEqual(readSheetXml(xml), [["1300000"]]);
});

test("a file that is not a workbook says so instead of throwing something opaque", async () => {
  const error = await readWorkbook(new Uint8Array([1, 2, 3])).then(() => null, (thrown) => thrown);
  assert.ok(error);
  assert.equal(error.code, "invalid_workbook");
  assert.match(error.message, /엑셀 파일로 읽을 수 없습니다/);
});

test("the template round-trips through the reader into the migration parser", { skip: !hasDom }, async () => {
  /* 양식 → 리더 → CSV → 파서가 한 줄로 이어지는지. 어느 한 칸이라도 어긋나면
     대표의 첫 업로드가 통째로 실패한다. */
  const workbook = await readWorkbook(readFileSync(TEMPLATE), { unzip: unzipSync });
  assert.deepEqual(workbook.sheetNames, ["안내", "1. 회원", "2. 회원권"]);

  const clientPlan = planClientMigration(rowsToCsv(workbook.sheets["1. 회원"]), {
    locations: [{ id: "bansong", name: "반송점" }],
    createdBy: "owner-a",
  });
  assert.deepEqual(clientPlan.missingColumns, [], "1. 회원 시트의 열이 파서와 맞아야 한다");
  assert.equal(clientPlan.writes.length, 1, "예시 행 하나가 읽힌다");
  assert.equal(clientPlan.writes[0].clientId, "csv_01012345678");

  const passPlan = planPassMigration(rowsToCsv(workbook.sheets["2. 회원권"]), {
    clients: [{ id: "csv_01012345678", phone: "01012345678", locationId: "bansong" }],
    locations: [{ id: "bansong", name: "반송점" }],
    instructors: [{ userId: "u1", displayName: "정예진" }],
    createdBy: "owner-a",
  });
  assert.deepEqual(passPlan.missingColumns, [], "2. 회원권 시트의 열이 파서와 맞아야 한다");
  assert.deepEqual(passPlan.failures, [], "예시 행이 그대로 통과해야 한다");
  assert.equal(passPlan.writes[0].pass.category, "pt_1_1_repurchase_event");
  assert.equal(passPlan.writes[0].pass.paymentMethod, "card");
  assert.equal(passPlan.writes[0].priorSessions, 35);
});
