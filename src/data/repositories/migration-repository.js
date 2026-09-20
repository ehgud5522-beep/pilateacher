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
 * 같은 파일을 다시 올리면 같은 id 로 간다.
 *
 * 그 id 로 가는 두 번째 쓰기를 규칙이 막아 주지는 않는다 -- 이미 있는 문서에
 * 대한 set 은 create 가 아니라 update 이고, 대표는 자기 센터의 회원과 회원권을
 * 고칠 수 있는 사람이다. 규칙에 기대면 두 번째 업로드가 그 사이 앱에서 고친
 * 이름과 차감된 잔여 횟수를 조용히 되돌린다. 그래서 쓰기 전에 그 문서가 이미
 * 있는지 확인하고, 있으면 건드리지 않고 "이미 있음"으로 넘긴다.
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
import {
  UNIT_PRICE_SOURCE, resolveUnitPrice, unitPriceSourceFor,
} from "../schema/pay-rates.js";
import { netContractPriceFor } from "../schema/deduction-pricing.js";
import { paths } from "../schema/paths.js";
import { normalizePhone } from "./client-repository.js";
import { fullRoomRateOf } from "./instructor-repository.js";

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
  MISSING_RATE: "missing_rate",
  ALREADY_EXISTS: "already_exists",
  WRITE_FAILED: "write_failed",
  /* 듀엣 세 가지를 따로 둔다. 고칠 것이 서로 다르기 때문이다 -- 하나는 연락처를
     받아 오는 일, 하나는 1차 시트에 줄을 더하는 일, 하나는 강사에게 누적 횟수를
     물어보는 일이다. 한 사유로 뭉치면 대표가 무엇을 해야 하는지 알 수 없다. */
  DUET_PARTNER_PHONE_MISSING: "duet_partner_phone_missing",
  DUET_PARTNER_NOT_FOUND: "duet_partner_not_found",
  DUET_PARTNER_SESSIONS_MISSING: "duet_partner_sessions_missing",
});

export const CLIENT_SHEET_COLUMNS = Object.freeze(["회원명", "연락처", "지점"]);
export const PASS_SHEET_COLUMNS = Object.freeze([
  "회원명", "연락처", "지점", "담당강사", "상품명", "급여카테고리",
  "총세션", "서비스세션", "남은횟수", "강사누적진행", "인수인계여부",
  "계약금액", "차수", "결제수단", "계약일", "만료일",
]);

/**
 * 듀엣을 적는 칸. 선택이다 -- 머리말에 없어도 되고, 있어도 비워 두면 1:1 이다.
 *
 * ── 왜 한 줄인가 ──
 * 두 줄로 적고 묶는 방식은 택하지 않았다. 회원권 문서 id 가
 * passIdFor(clientId, 차수) 로 정해지므로 두 줄이면 회원권이 둘 만들어지고,
 * 그것을 도로 하나로 합칠 키를 새로 발명해야 한다. 그 키가 틀리면 30회짜리가
 * 두 개 생기고 이관은 되돌릴 수 없다. 한 줄이면 애초에 하나만 만들어진다.
 *
 * 짝은 1차 시트에 자기 줄이 이미 있다 -- 독립된 회원이기 때문이고, 그 사실이
 * 이 설계의 근거이기도 하다. 여기서는 그 사람을 연락처로 가리키기만 한다.
 *
 * ── 강사누적진행2 가 왜 필요한가 ──
 * 듀엣 단가는 두 사람의 누적 중 적은 쪽으로 정해진다 (pass-clients.js).
 * 짝의 누적을 심지 않으면 0 에서 시작하고, 그러면 그 회원권의 처음 스무
 * 회차가 전부 신규 단가 25,000 으로 기록된다 -- 급여가 통째로 틀리는 그
 * 증상이다. 짐작해서 대표의 값을 복사하지 않는다. 강사에게 물어 적는다.
 */
export const PASS_SHEET_DUET_COLUMNS = Object.freeze(["회원명2", "연락처2", "강사누적진행2"]);

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
 * 이 회원권이 회당 얼마를 기준으로 하는가. 실제 단가는 차감할 때 판정이
 * 정하고(deduction-pricing.js), 이 값은 판정 4 가 쓰는 기준값이다.
 *
 * 표를 이관 시점에 한 번만 읽는다. 지난 회원권을 나중에 다시 계산하면 그 사이
 * 바뀐 단가가 소급되고, 이미 정산이 끝난 달의 근거가 사라진다.
 */
function baseUnitPriceFor({ category, categoryLabel, instructor, instructorName, line }) {
  const source = unitPriceSourceFor(category);
  if (source === UNIT_PRICE_SOURCE.MANUAL) {
    throw failure(line, MIGRATION_ERROR.MISSING_RATE,
      `${categoryLabel} 은(는) 기준 단가를 표가 정해 주지 않습니다. 이 회원권은 앱에서 직접 발급해 주세요`);
  }
  const fullRoomRate = fullRoomRateOf(instructor);
  if (source === UNIT_PRICE_SOURCE.FULL_ROOM_RATE && !fullRoomRate) {
    throw failure(line, MIGRATION_ERROR.MISSING_RATE,
      `${instructorName} 강사의 풀방금액이 없습니다. 강사 단가에서 먼저 입력해 주세요`);
  }
  return resolveUnitPrice(category, { fullRoomRate });
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

      /* 규칙이 baseUnitPrice 를 요구한다. 없으면 이 행은 통째로 거부된다.

         값은 카테고리가 정한다 -- 양식에 단가 칸을 두지 않은 이유이기도 하다.
         대표가 백 줄에 단가를 손으로 적으면 그 오타가 곧 급여 숫자가 된다.
         표에 있는 여섯 카테고리는 표가, 1:1 재등록(정상)은 담당 강사의
         풀방금액이 정한다.

         남는 것은 "기타" 하나다. 그것은 표도 풀방금액도 답을 갖고 있지 않다.
         0 으로 심으면 그 회원권의 수업이 통째로 무보수로 기록되고 원장은
         고칠 수 없으므로, 심지 않고 그 행만 실패로 돌린다. */
      const baseUnitPrice = baseUnitPriceFor({
        category, categoryLabel, instructor: matches[0], instructorName, line,
      });

      /* 단가는 표를 다시 읽지 않는다. 이관 시점의 표로 지난 회원권을 계산하면
         그때 팔린 조건과 달라진다. 판정 4 가 쓸 기준값만 심고, 실제 단가는
         차감할 때 판정이 정한다. */
      const clientId = client.id;

      /* ── 듀엣 ─────────────────────────────────────────────────────────
         짝이 적혀 있으면 이 회원권은 두 사람이 함께 쓴다. 어느 한 칸이라도
         비면 그 행만 실패로 돌린다 -- 업로드를 멈추지 않고, 대표가 그 행만
         고쳐 다시 올린다.

         임시 번호를 만들어 심지 않는다. 한 번 심으면 그 번호가 그 회원의
         정체가 되어 그대로 남고, 나중에 진짜 번호가 오면 같은 사람이 둘이
         된다. */
      const partnerName = requireText(record, "회원명2");
      const partnerPhoneRaw = requireText(record, "연락처2");
      let clientIds;
      let partner = null;
      let partnerPriorSessions = 0;
      if (partnerName || partnerPhoneRaw) {
        const partnerPhone = normalizePhone(partnerPhoneRaw);
        if (!partnerPhone) {
          throw failure(line, MIGRATION_ERROR.DUET_PARTNER_PHONE_MISSING,
            `듀엣 상대의 연락처가 필요합니다: ${partnerName || "이름 없음"}`);
        }
        if (partnerPhone === phone) {
          /* 회차는 하나인데 누적이 둘 올라간다. 20회 판정이 실제의 두 배 속도로
             지나가고, 그 시점부터 단가가 조용히 틀린다. */
          throw failure(line, MIGRATION_ERROR.DUET_PARTNER_NOT_FOUND,
            `듀엣 상대가 본인과 같은 연락처입니다: ${name}`);
        }
        partner = clientByPhone.get(partnerPhone);
        if (!partner) {
          throw failure(line, MIGRATION_ERROR.DUET_PARTNER_NOT_FOUND,
            `듀엣 상대를 1차 회원 목록에서 찾을 수 없습니다: ${partnerName || partnerPhoneRaw}`);
        }
        const partnerSessions = readInt(record, "강사누적진행2", { min: 0, optional: true });
        if (partnerSessions === null) {
          throw failure(line, MIGRATION_ERROR.DUET_PARTNER_SESSIONS_MISSING,
            `듀엣 상대의 강사누적진행이 필요합니다: ${partnerName || partnerPhoneRaw}`);
        }
        partnerPriorSessions = partnerSessions;
        clientIds = [clientId, partner.id];
      }

      const passId = passIdFor(clientId, purchaseRound);
      writes.push({
        line,
        name,
        clientId,
        /* 짝이 없으면 undefined 로 둔다. 길이 1 짜리 배열을 심어도 뜻은 같지만,
           이관분에 없던 필드가 생기면 "이 회원권은 언제 만들어졌나"를 필드로
           가려내던 자리가 흐려진다. */
        partnerClientId: partner ? partner.id : "",
        partnerPriorSessions,
        passId,
        instructorId,
        priorSessions,
        pass: {
          clientId,
          ...(clientIds ? { clientIds } : {}),
          locationId,
          productId: requireText(record, "상품명") || "csv",
          category,
          totalSessions,
          serviceSessions,
          contractPrice,
          /* 부가세를 뺀 공급가액. 부원장의 5:5 가 이 값을 반으로 접는다.
             이관분에도 넣는다 -- 담당 강사가 나중에 부원장이 되면 그때 이
             회원권의 남은 회차가 5:5 로 가고, 값이 없으면 그 시점의 세율로
             계산된다. */
          netContractPrice: netContractPriceFor(contractPrice, paymentMethod),
          paymentMethod,
          purchaseRound,
          remainingCount,
          baseUnitPrice,
          /* 아직 서비스 회차를 쓰지 않은 상태로 옮긴다. 옛 엑셀은 그것을
             기록하지 않았고, 지어내면 남은 서비스 1회분이 조용히 사라진다.

             차감은 서비스를 먼저 쓰므로(deduction-pricing.js 의
             spendsServiceSession) 이 선택에 값이 붙는다: 옛 시스템에서 이미
             서비스를 쓴 회원권이라면 다음 한 회차가 기준 단가 대신 10,000 으로
             기록된다. 반대로 잘못 짐작하면 회원이 서비스 1회를 잃는다.
             한쪽은 강사의 한 회차 차액이고 다른 쪽은 회원이 산 것의 일부라,
             회원 쪽으로 기운 이 선택을 그대로 둔다. 급여 집계에서 category 가
             service 로 보이므로 대표가 알아볼 수는 있다. */
          serviceUsed: 0,
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
 * @property {(path: string) => Promise<boolean>} [exists]
 */

/**
 * 이관은 만들기만 한다. update 도 merge 도 없다 -- 두 번째 업로드가 기존
 * 문서를 건드리면 안 되기 때문이다. 그 "만들기만"을 지키는 것은 규칙이 아니라
 * exists 다 -- runRows 머리말 참고.
 *
 * 한 행의 문서들은 한 배치로 묶는다 -- 회원권만 남고 원장이 없으면 잔여의
 * 근거가 사라지고, 원장은 append-only 라 나중에 채울 수 없다.
 *
 * @returns {MigrationStore}
 */
export function createFirestoreMigrationStore() {
  const load = () => import("firebase/firestore");
  return {
    commit: async (writes) => {
      const { doc, getFirestore, writeBatch } = await load();
      const firestore = getFirestore();
      const batch = writeBatch(firestore);
      for (const write of writes) batch.set(doc(firestore, write.path), write.data);
      await batch.commit();
    },
    serverTimestamp: async () => {
      const { serverTimestamp } = await load();
      return serverTimestamp();
    },
    // 거부된 행만 여기로 온다 -- runRows 머리말 참고.
    exists: async (documentPath) => {
      const { doc, getDoc, getFirestore } = await load();
      return (await getDoc(doc(getFirestore(), documentPath))).exists();
    },
  };
}

const alreadyThere = (row) => failure(
  row.line, MIGRATION_ERROR.ALREADY_EXISTS, `이미 올라간 행입니다: ${row.name || row.clientId}`,
);

/**
 * 한 행씩 쓰고, 실패는 사유와 함께 모은다.
 *
 * ── 쓰기 전에 있는지 본다 ──
 * 두 번째 업로드를 규칙이 막아 주지 않기 때문이다 -- 위 머리말 참고. 백 건이면
 * 백 번 읽지만 1년에 한 번 하는 일이고, 그 대가로 대표가 같은 파일을 몇 번
 * 올리든 앱에서 고친 값이 되돌아가지 않는다.
 *
 * 읽지 못하면 쓰지 않는다. "있는지 모르겠다"에서 덮어쓰기로 넘어가면 잃는 쪽이
 * 회원의 잔여 횟수다.
 */
const runRows = async (rows, { pathOf, exists, write }) => {
  const succeeded = [];
  const failures = [];
  for (const row of rows) {
    try {
      if (exists && await exists(pathOf(row))) { failures.push(alreadyThere(row)); continue; }
    } catch (error) {
      failures.push(failure(
        row.line, MIGRATION_ERROR.WRITE_FAILED,
        `이미 올라갔는지 확인하지 못했습니다 (코드 ${error?.code || "unknown"})`,
      ));
      continue;
    }
    try {
      await write(row);
      succeeded.push(row);
    } catch (error) {
      /* 여기까지 왔으면 방금 전에는 없던 문서다. 그래도 permission-denied 가
         나올 수 있다 -- 두 사람이 같은 파일을 동시에 올리는 경우다. 그때만 한
         번 더 읽어 가른다. 규칙에 막힌 쓰기를 "이미 올렸다"로 읽으면 대표는 한
         줄도 저장되지 않은 업로드를 끝난 것으로 보고 넘어간다. */
      const code = String(error?.code || "unknown");
      const already = code === "permission-denied" && exists
        ? await exists(pathOf(row)).catch(() => false)
        : false;
      if (already) { failures.push(alreadyThere(row)); continue; }
      failures.push(failure(row.line, MIGRATION_ERROR.WRITE_FAILED, `쓰지 못했습니다 (코드 ${code})`));
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
export async function applyClientMigration(organizationId, writes, { store = createFirestoreMigrationStore() } = {}) {
  const stampedAt = await store.serverTimestamp();
  return runRows(writes, {
    pathOf: (row) => paths.client(organizationId, row.clientId),
    exists: store.exists,
    write: (row) => store.commit([{
      path: paths.client(organizationId, row.clientId),
      data: { ...row.data, organizationId, createdAt: stampedAt },
    }]),
  });
}

/**
 * 2차 업로드. 한 행이 세 문서를 함께 쓴다.
 * @param {string} organizationId
 * @param {Array<any>} writes planPassMigration 의 결과
 * @param {{ store?: MigrationStore }} [options]
 */
export async function applyPassMigration(organizationId, writes, { store = createFirestoreMigrationStore() } = {}) {
  const stampedAt = await store.serverTimestamp();
  return runRows(writes, {
    pathOf: (row) => paths.pass(organizationId, row.passId),
    exists: store.exists,
    write: (row) => {
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
      /* 듀엣이면 짝의 누적도 함께 심는다. 심지 않으면 0 에서 시작하고, 단가가
         두 사람 중 적은 쪽을 보므로 그 회원권의 처음 스무 회차가 전부 신규
         단가로 기록된다 -- 급여가 통째로 틀리는 그 증상이다. */
      ...(row.partnerClientId ? [{
        path: paths.instructorClientTotal(organizationId, row.instructorId, row.partnerClientId),
        data: {
          organizationId,
          instructorId: row.instructorId,
          clientId: row.partnerClientId,
          sessions: row.partnerPriorSessions,
        },
      }] : []),
    ]);
    },
  });
}
