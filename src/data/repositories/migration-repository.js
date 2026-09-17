/**
 * 10월 이관. 엑셀에 있는 회원과 회원권을 CSV 로 올린다.
 *
 * ── 두 번에 나눈다 ──
 * 1차 회원 CSV 가 clients 를 만들고, 2차 회원권 CSV 가 이름+연락처로 그 회원을
 * 찾아 붙인다. 한 파일에 다 넣으면 동명이인을 만났을 때 "이 회원권이 누구 것
 * 인가"를 파일 안에서 풀 수 없다.
 *
 * ── 한 행이 실패해도 멈추지 않는다 ──
 * 120건 중 3건 때문에 전부 되돌리면 다시 올리는 비용이 크다. 실패한 행은 사유와
 * 함께 목록으로 돌려주고, 대표가 그 행만 고쳐 다시 올린다.
 *
 * ── 두 번 올려도 중복되지 않는다 ──
 * 문서 id 를 행에서 결정적으로 만든다.
 *   회원   csv_<연락처숫자만>
 *   회원권 csv_<clientId>_<차수>
 *   원장   <passId>_issue
 * 같은 파일을 다시 올리면 같은 id 로 가고, 이미 있는 문서는 create 규칙이
 * 거부한다 -- 데이터는 그대로이고 그 행만 "이미 있음"으로 실패 목록에 들어간다.
 *
 * 이름을 id 에 넣지 않는다. 이름은 개명과 오타 수정으로 바뀌고, 바뀌면 같은
 * 사람이 두 명이 된다. 연락처는 잘 바뀌지 않으며, 바뀌는 날은 사람이 개입해야
 * 하는 상황이다.
 *
 * 다만 한 번호를 가족이 함께 쓰는 경우가 실무에 있는지 모른다. 있다면 이 방식이
 * 깨지므로 1차에서 연락처 중복을 감지해 실패 목록으로 보고한다 -- 조용히 덮어쓰면
 * 한 사람이 사라진다.
 */

import { CLIENT_STATUS, PASS_STATUS, PAY_CATEGORY } from "../schema/constants.js";
import {
  PAYMENT_METHOD_BY_LABEL, PAY_CATEGORY_BY_LABEL, valueOfLabel,
} from "../schema/display-names.js";
import { paths } from "../schema/paths.js";
import { normalizePhone } from "./client-repository.js";

/** 실패 사유. 화면이 사유별로 묶어 보여주고, 대표가 무엇을 고칠지 안다. */
export const MIGRATION_ERROR = Object.freeze({
  MISSING_FIELD: "missing_field",
  INVALID_NUMBER: "invalid_number",
  INVALID_DATE: "invalid_date",
  UNKNOWN_LABEL: "unknown_label",
  DUPLICATE_PHONE: "duplicate_phone",
  CLIENT_NOT_FOUND: "client_not_found",
  LOCATION_NOT_FOUND: "location_not_found",
  INSTRUCTOR_NOT_FOUND: "instructor_not_found",
  INSTRUCTOR_AMBIGUOUS: "instructor_ambiguous",
  ALREADY_EXISTS: "already_exists",
  WRITE_FAILED: "write_failed",
});

export const CLIENT_SHEET_COLUMNS = Object.freeze(["회원명", "연락처", "지점"]);
export const PASS_SHEET_COLUMNS = Object.freeze([
  "회원명", "연락처", "지점", "담당강사", "상품명", "급여카테고리",
  "총세션", "서비스세션", "남은횟수", "강사누적진행", "인수인계여부",
  "계약금액", "차수", "결제수단", "계약일", "만료일",
]);

/** 회원 문서 id. 연락처 하나로 정해진다 -- 위 머리말 참고. */
export const clientIdForPhone = (phone) => {
  const digits = normalizePhone(phone);
  return digits ? `csv_${digits}` : "";
};

/** 회원권 문서 id. 한 회원의 한 차수는 하나뿐이다. */
export const passIdFor = (clientId, purchaseRound) => `csv_${clientId}_${purchaseRound}`;

/* ── CSV 파싱 ───────────────────────────────────────────────────────────
   따옴표 안의 쉼표와 줄바꿈을 지킨다. 회원 이름에 쉼표는 드물지만 주소나 메모가
   섞여 들어오는 파일이 실제로 있다. */

/** @param {string} text @returns {Array<Array<string>>} */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const source = String(text ?? "").replace(/^﻿/, "");
  const push = () => { row.push(field); field = ""; };
  const endRow = () => { push(); rows.push(row); row = []; };
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') { field += '"'; index += 1; } else quoted = false;
      } else field += character;
      continue;
    }
    if (character === '"') { quoted = true; continue; }
    if (character === ",") { push(); continue; }
    if (character === "\r") continue;
    if (character === "\n") { endRow(); continue; }
    field += character;
  }
  if (field !== "" || row.length > 0) endRow();
  // 전부 빈 칸인 줄은 엑셀이 흘리는 꼬리다.
  return rows.filter((entry) => entry.some((value) => String(value).trim() !== ""));
}

/**
 * 첫 줄을 머리글로 읽어 객체 배열로 만든다.
 * @param {string} text
 * @returns {{ rows: Array<Record<string, string>>, missingColumns: Array<string> }}
 */
export function readSheet(text, expectedColumns) {
  const parsed = parseCsv(text);
  if (parsed.length === 0) return { rows: [], missingColumns: [...expectedColumns] };
  const header = parsed[0].map((value) => String(value).trim());
  const missingColumns = expectedColumns.filter((column) => !header.includes(column));
  const rows = parsed.slice(1).map((values) => {
    const record = {};
    header.forEach((column, index) => { record[column] = String(values[index] ?? "").trim(); });
    return record;
  });
  return { rows, missingColumns };
}

const failure = (line, reason, message) => ({ line, reason, message });

const requireText = (record, column) => String(record?.[column] ?? "").trim();

const readInt = (record, column, { min, optional = false }) => {
  const raw = requireText(record, column);
  if (!raw) {
    if (optional) return null;
    throw failure(0, MIGRATION_ERROR.MISSING_FIELD, `${column} 이(가) 비어 있습니다`);
  }
  const parsed = Number(raw.replace(/[,\s]/g, ""));
  if (!Number.isInteger(parsed) || parsed < min) {
    throw failure(0, MIGRATION_ERROR.INVALID_NUMBER, `${column} 이(가) 숫자가 아닙니다: ${raw}`);
  }
  return parsed;
};

const readDate = (record, column) => {
  const raw = requireText(record, column);
  if (!raw) throw failure(0, MIGRATION_ERROR.MISSING_FIELD, `${column} 이(가) 비어 있습니다`);
  // 2026-09-30 과 2026/9/30 을 둘 다 받는다. 엑셀이 어느 쪽으로 내보낼지 모른다.
  const parts = raw.split(/[-/.]/).map((piece) => Number(piece.trim()));
  if (parts.length !== 3 || parts.some((piece) => !Number.isInteger(piece))) {
    throw failure(0, MIGRATION_ERROR.INVALID_DATE, `${column} 을(를) 날짜로 읽을 수 없습니다: ${raw}`);
  }
  const [year, month, day] = parts;
  const at = new Date(year, month - 1, day, 23, 59, 59);
  if (!Number.isFinite(at.getTime()) || at.getFullYear() !== year) {
    throw failure(0, MIGRATION_ERROR.INVALID_DATE, `${column} 을(를) 날짜로 읽을 수 없습니다: ${raw}`);
  }
  return at;
};

/**
 * 1차 — 회원 시트를 문서로 바꾼다. 쓰지는 않는다.
 *
 * @param {string} text
 * @param {{ locations?: Array<any>, createdBy?: string }} [context]
 */
export function planClientMigration(text, { locations = [], createdBy = "" } = {}) {
  const { rows, missingColumns } = readSheet(text, CLIENT_SHEET_COLUMNS);
  const byLocationName = new Map(locations.map((item) => [String(item.name || "").trim(), item.id]));
  const writes = [];
  const failures = [];
  const seenPhones = new Map();

  rows.forEach((record, index) => {
    const line = index + 2; // 머리글이 1행이다. 사람이 엑셀에서 찾는 번호와 맞춘다.
    const name = requireText(record, "회원명");
    const phone = normalizePhone(requireText(record, "연락처"));
    const locationName = requireText(record, "지점");
    if (!name) { failures.push(failure(line, MIGRATION_ERROR.MISSING_FIELD, "회원명이 비어 있습니다")); return; }
    if (!phone) { failures.push(failure(line, MIGRATION_ERROR.MISSING_FIELD, "연락처가 비어 있습니다")); return; }
    const locationId = byLocationName.get(locationName);
    if (!locationId) {
      failures.push(failure(line, MIGRATION_ERROR.LOCATION_NOT_FOUND, `지점을 찾을 수 없습니다: ${locationName}`));
      return;
    }
    /* 같은 연락처가 두 번 나오면 둘 중 하나가 사라진다. 조용히 덮어쓰지 않고
       대표에게 묻는다 -- 가족이 한 번호를 쓰는 경우가 있는지 우리는 모른다. */
    const seenAt = seenPhones.get(phone);
    if (seenAt) {
      failures.push(failure(line, MIGRATION_ERROR.DUPLICATE_PHONE, `${seenAt}행과 연락처가 같습니다: ${name}`));
      return;
    }
    seenPhones.set(phone, line);
    const clientId = clientIdForPhone(phone);
    writes.push({
      line,
      name,
      phone,
      clientId,
      data: { name, phone, locationId, status: CLIENT_STATUS.ACTIVE, createdBy },
    });
  });

  return { writes, failures, missingColumns };
}

/**
 * 2차 — 회원권 시트를 문서로 바꾼다.
 *
 * @param {string} text
 * @param {{ clients?: Array<any>, locations?: Array<any>, instructors?: Array<any>, createdBy?: string }} [context]
 */
export function planPassMigration(text, {
  clients = [], locations = [], instructors = [], createdBy = "",
} = {}) {
  const { rows, missingColumns } = readSheet(text, PASS_SHEET_COLUMNS);
  const byLocationName = new Map(locations.map((item) => [String(item.name || "").trim(), item.id]));
  const clientByPhone = new Map(clients.map((item) => [normalizePhone(item.phone), item]));

  /* 강사는 이름으로 찾는다 -- 대표는 uid 를 모른다. 같은 이름이 둘이면 고르지
     않고 실패로 돌린다. 잘못 고른 강사에게 한 달치 급여가 쌓인다. */
  const instructorsByName = new Map();
  for (const item of instructors) {
    const name = String(item.displayName || "").trim();
    if (!name) continue;
    instructorsByName.set(name, [...(instructorsByName.get(name) || []), item]);
  }

  const writes = [];
  const failures = [];

  rows.forEach((record, index) => {
    const line = index + 2;
    try {
      const name = requireText(record, "회원명");
      const phone = normalizePhone(requireText(record, "연락처"));
      if (!name || !phone) throw failure(line, MIGRATION_ERROR.MISSING_FIELD, "회원명과 연락처가 모두 필요합니다");

      const client = clientByPhone.get(phone);
      if (!client) {
        throw failure(line, MIGRATION_ERROR.CLIENT_NOT_FOUND, `1차에서 만든 회원을 찾을 수 없습니다: ${name}`);
      }

      const locationName = requireText(record, "지점");
      const locationId = byLocationName.get(locationName) || client.locationId;
      if (!locationId) throw failure(line, MIGRATION_ERROR.LOCATION_NOT_FOUND, `지점을 찾을 수 없습니다: ${locationName}`);

      const instructorName = requireText(record, "담당강사");
      const matches = instructorsByName.get(instructorName) || [];
      if (matches.length === 0) {
        throw failure(line, MIGRATION_ERROR.INSTRUCTOR_NOT_FOUND, `강사를 찾을 수 없습니다: ${instructorName}`);
      }
      if (matches.length > 1) {
        throw failure(line, MIGRATION_ERROR.INSTRUCTOR_AMBIGUOUS, `같은 이름의 강사가 ${matches.length}명입니다: ${instructorName}`);
      }
      const instructorId = matches[0].userId;

      const categoryLabel = requireText(record, "급여카테고리");
      const category = valueOfLabel(PAY_CATEGORY_BY_LABEL, categoryLabel);
      if (!category) throw failure(line, MIGRATION_ERROR.UNKNOWN_LABEL, `급여카테고리를 알 수 없습니다: ${categoryLabel}`);

      const methodLabel = requireText(record, "결제수단");
      const paymentMethod = valueOfLabel(PAYMENT_METHOD_BY_LABEL, methodLabel);
      if (!paymentMethod) throw failure(line, MIGRATION_ERROR.UNKNOWN_LABEL, `결제수단을 알 수 없습니다: ${methodLabel}`);

      const totalSessions = readInt(record, "총세션", { min: 1 });
      const serviceSessions = readInt(record, "서비스세션", { min: 0, optional: true }) ?? 0;
      const remainingCount = readInt(record, "남은횟수", { min: 0 });
      const priorSessions = readInt(record, "강사누적진행", { min: 0 });
      const contractPrice = readInt(record, "계약금액", { min: 0 });
      const purchaseRound = readInt(record, "차수", { min: 1 });
      const expiresAt = readDate(record, "만료일");
      const contractedAt = readDate(record, "계약일");

      const handedOverRaw = requireText(record, "인수인계여부");
      const handedOver = /^(y|yes|예|o|true|1)$/i.test(handedOverRaw);

      /* 단가는 표를 다시 읽지 않는다. 이관 시점의 표로 지난 회원권을 계산하면
         그때 팔린 조건과 달라진다. 판정 4 가 쓸 기준값만 심고, 실제 단가는
         차감할 때 판정이 정한다. */
      const clientId = client.id;
      const passId = passIdFor(clientId, purchaseRound);
      writes.push({
        line,
        name,
        clientId,
        passId,
        instructorId,
        priorSessions,
        pass: {
          clientId,
          locationId,
          productId: requireText(record, "상품명") || "csv",
          category,
          totalSessions,
          serviceSessions,
          contractPrice,
          paymentMethod,
          purchaseRound,
          remainingCount,
          instructorId,
          handedOver,
          expiresAt,
          contractedAt,
          status: PASS_STATUS.ACTIVE,
          createdBy,
        },
      });
    } catch (thrown) {
      if (thrown && thrown.reason) failures.push({ ...thrown, line });
      else failures.push(failure(line, MIGRATION_ERROR.WRITE_FAILED, String(thrown?.message || thrown)));
    }
  });

  return { writes, failures, missingColumns };
}

/** 사유별로 묶는다. 대표가 "무엇을 고쳐야 하는가"를 한눈에 본다. */
export function groupFailures(failures) {
  const groups = new Map();
  for (const item of Array.isArray(failures) ? failures : []) {
    const reason = item?.reason || MIGRATION_ERROR.WRITE_FAILED;
    groups.set(reason, [...(groups.get(reason) || []), item]);
  }
  return [...groups.entries()]
    .map(([reason, rows]) => ({ reason, rows: rows.sort((left, right) => left.line - right.line) }))
    .sort((left, right) => right.rows.length - left.rows.length);
}

/** 기준 단가가 없는 카테고리인지. 화면이 미리 경고하는 데 쓴다. */
export const needsManualBaseRate = (category) => category === PAY_CATEGORY.ETC
  || category === PAY_CATEGORY.PT_1_1_REPURCHASE_NORMAL;

/* ── 실제로 쓰기 ──────────────────────────────────────────────────────────
   한 행이 실패해도 멈추지 않는다. 행마다 따로 쓰고, 실패는 사유와 함께 모은다.

   행 하나 안에서는 묶는다 -- 회원권과 그 원장 발급 항목과 강사 누적은 함께
   쓰이거나 함께 안 쓰인다. 회원권만 남고 원장이 없으면 잔여의 근거가 사라지고,
   원장은 append-only 라 나중에 채울 수도 없다.
   ────────────────────────────────────────────────────────────────────────── */

/**
 * @typedef {object} MigrationStore
 * @property {(writes: Array<{ path: string, data: object, operation?: string }>) => Promise<void>} commit
 * @property {() => Promise<any>} serverTimestamp
 */

const alreadyExists = (error) => String(error?.code || "") === "permission-denied";

const runRows = async (rows, write) => {
  const succeeded = [];
  const failures = [];
  for (const row of rows) {
    try {
      await write(row);
      succeeded.push(row);
    } catch (error) {
      /* 이미 있는 문서는 create 규칙이 거부한다. 두 번째 업로드가 여기로 오고,
         데이터는 그대로다 -- 중복 발급이 구조적으로 불가능하다. */
      failures.push(failure(
        row.line,
        alreadyExists(error) ? MIGRATION_ERROR.ALREADY_EXISTS : MIGRATION_ERROR.WRITE_FAILED,
        alreadyExists(error)
          ? `이미 올라간 행입니다: ${row.name || row.clientId}`
          : `쓰지 못했습니다 (코드 ${error?.code || "unknown"})`,
      ));
    }
  }
  return { succeeded, failures };
};

/**
 * 1차 업로드.
 * @param {string} organizationId
 * @param {Array<any>} writes planClientMigration 의 결과
 * @param {{ store?: MigrationStore }} [options]
 */
export async function applyClientMigration(organizationId, writes, { store } = {}) {
  const stampedAt = await store.serverTimestamp();
  return runRows(writes, (row) => store.commit([{
    path: paths.client(organizationId, row.clientId),
    data: { ...row.data, organizationId, createdAt: stampedAt },
  }]));
}

/**
 * 2차 업로드. 한 행이 세 문서를 함께 쓴다.
 * @param {string} organizationId
 * @param {Array<any>} writes planPassMigration 의 결과
 * @param {{ store?: MigrationStore }} [options]
 */
export async function applyPassMigration(organizationId, writes, { store } = {}) {
  const stampedAt = await store.serverTimestamp();
  return runRows(writes, (row) => {
    const pass = row.pass;
    const passPath = paths.pass(organizationId, row.passId);
    return store.commit([
      { path: passPath, data: { ...pass, organizationId, createdAt: stampedAt } },
      {
        path: paths.passLedgerEntry(organizationId, row.passId, `${row.passId}_issue`),
        data: {
          organizationId,
          passId: row.passId,
          clientId: row.clientId,
          locationId: pass.locationId,
          type: "issue",
          /* 이관 시점에 남은 횟수를 그대로 발급한 것으로 적는다. 이미 진행한
             회차는 옛 엑셀에 있고 원장으로 옮기지 않는다 -- 그것까지 옮기면
             지난 급여가 이 앱에서 두 번 계산된다. */
          delta: pass.remainingCount,
          category: pass.category,
          unitPrice: 0,
          instructorId: row.instructorId,
          occurredAt: stampedAt,
          createdAt: stampedAt,
          createdBy: pass.createdBy,
        },
      },
      {
        path: paths.instructorClientTotal(organizationId, row.instructorId, row.clientId),
        data: {
          organizationId,
          instructorId: row.instructorId,
          clientId: row.clientId,
          sessions: row.priorSessions,
        },
      },
    ]);
  });
}
