/**
 * 차수 — **회원권을 쓰는 순서를 정하는 번호.**
 *
 * 2026-10-09 부터 차감이 차수 순으로 간다 (lesson-settlement 의
 * nextByPurchaseRound). 그 전에는 만료일이 순서를 정했고, 차수는 화면에
 * 적히기만 하는 숫자였다 -- 틀려도 아무 일이 없었다.
 *
 * 이제는 틀리면 엉뚱한 회원권에서 빠진다. 그래서 두 가지를 더한다:
 * 발급할 때 **자동으로 다음 번호**를 넣고, 만료일이 차수와 어긋난 회원을
 * 찾아 화면이 먼저 말한다.
 */

const text = (value) => String(value ?? "").trim();

/** 이 회원권의 차수. 읽을 수 없으면 null 이다 -- 0 으로 바꾸지 않는다. */
export function purchaseRoundOf(pass) {
  const round = Number(pass?.purchaseRound);
  return Number.isInteger(round) && round > 0 ? round : null;
}

/**
 * 이 회원에게 다음으로 줄 차수.
 *
 * 그 회원이 이 센터에서 산 것 중 가장 큰 번호의 다음이다. 종류를 가리지
 * 않는다 -- 1:1 1차, 2:1 2차, 1:1 3차면 1:1 안에서는 1차 다음이 3차이고,
 * 그것이 실제로 산 순서다. 종류마다 1 부터 세면 같은 번호가 둘이 되고,
 * 그때 순서는 발급 시각이 정하게 되어 아무도 예측하지 못한다.
 *
 * 한 장도 없으면 1 이다.
 *
 * @param {Array<any>} passes 그 센터의 회원권 (이 함수가 회원으로 거른다)
 * @param {string} clientId
 * @param {(pass: any, clientId: string) => boolean} belongsTo 짝까지 보는 판정
 */
export function nextPurchaseRound(passes, clientId, belongsTo) {
  const target = text(clientId);
  if (!target) return 1;
  const mine = (Array.isArray(passes) ? passes : []).filter((pass) => (
    pass && (typeof belongsTo === "function"
      ? belongsTo(pass, target)
      : text(pass.clientId) === target)
  ));
  const highest = mine.reduce((top, pass) => Math.max(top, purchaseRoundOf(pass) ?? 0), 0);
  return highest + 1;
}

/**
 * 만료일이 차수와 어긋난 회원권. **뒤 차수가 먼저 만료되는 것들이다.**
 *
 * 차수 순으로 쓰므로, 앞 차수에 잔여가 남아 있는 동안 뒤 차수는 쓰이지
 * 않는다. 그런데 뒤 차수가 먼저 만료되면 그 회차는 손도 못 대 보고 사라진다
 * -- 회원이 돈을 낸 회차다.
 *
 * 자동으로 피하지 않는다 (순서를 뒤집으면 예측이 깨진다). 대신 화면이 먼저
 * 말하고, 대표가 만료일을 옮겨 푼다.
 *
 * ── 같은 종류 안에서만 본다 ──
 * 차감 후보가 종류별로 갈리므로, 1:1 1차와 2:1 2차는 서로를 기다리지 않는다.
 * 그 둘을 견주면 아무 문제 없는 회원권이 매번 경고에 걸린다.
 *
 * @param {Array<any>} passes 한 회원의 회원권
 * @param {{ now?: Date, kindOf?: (pass: any) => string, usable?: (pass: any) => boolean }} [options]
 * @returns {Array<{ pass: any, round: number, blockedBy: any, blockedByRound: number }>}
 */
export function expiryOutOfOrder(passes, options = {}) {
  const kindOf = typeof options.kindOf === "function" ? options.kindOf : defaultKind;
  const usable = typeof options.usable === "function" ? options.usable : defaultUsable;
  const now = options.now instanceof Date ? options.now : new Date();

  const rows = (Array.isArray(passes) ? passes : [])
    .map((pass) => ({ pass, round: purchaseRoundOf(pass), at: expiryTime(pass) }))
    /* 차수나 만료일을 읽을 수 없으면 견줄 수 없다. 모르는 것으로 경고하면
       그 경고는 곧 무시된다. */
    .filter((row) => row.round !== null && row.at !== null && usable(row.pass, now));

  const found = [];
  for (const row of rows) {
    const earlier = rows.filter((other) => (
      kindOf(other.pass) === kindOf(row.pass)
      && other.round < row.round
      // 앞 차수에 쓸 것이 남아 있어야 뒤 차수가 기다린다.
      && other.at > row.at
    ));
    if (earlier.length === 0) continue;
    /* 가장 늦게 만료되는 앞 차수를 짚는다 -- 그것이 이 회원권을 가장 오래
       붙잡아 두는 회원권이다. */
    const blocker = earlier.reduce((worst, item) => (item.at > worst.at ? item : worst), earlier[0]);
    found.push({ pass: row.pass, round: row.round, blockedBy: blocker.pass, blockedByRound: blocker.round });
  }
  return found;
}

/** 한 줄 문구. 어느 차수가 어느 차수보다 먼저 만료되는지 말한다. */
export function expiryOrderWarning(row) {
  if (!row) return "";
  return `${row.round}차가 ${row.blockedByRound}차보다 먼저 만료돼요. 만료일을 확인해 주세요.`;
}

/* 종류. 디오사와 2:1 과 1:1 은 서로 다른 줄에 선다 -- 차감 후보가 그렇게
   갈리므로 기다리는 관계도 그 안에서만 생긴다. */
function defaultKind(pass) {
  const category = text(pass?.category);
  if (category.startsWith("pt_2_1")) return "duet";
  if (category.startsWith("diosa")) return category;
  return "solo";
}

/** 아직 쓸 수 있는 회원권인가. 끝난 것은 경고할 것이 없다. */
function defaultUsable(pass, now) {
  const remaining = Number(pass?.remainingCount);
  if (!Number.isInteger(remaining) || remaining <= 0) return false;
  if (text(pass?.status) !== "active") return false;
  const at = expiryTime(pass);
  return at === null ? true : at > now.getTime();
}

function expiryTime(pass) {
  const value = pass?.expiresAt;
  if (!value) return null;
  const at = typeof value?.toDate === "function" ? value.toDate() : new Date(value);
  const time = at.getTime();
  return Number.isFinite(time) ? time : null;
}

/**
 * 센터 전체에서 만료일이 차수와 어긋난 회원들.
 *
 * 대표가 한 화면에서 보고 만료일을 옮긴다. 회원권이 아니라 **회원** 단위로
 * 묶는다 -- 한 사람에게 두 장이 걸려 있어도 열어야 할 화면은 하나다.
 *
 * 이름은 여기서 붙이지 않는다. 부르는 쪽이 명부에서 찾는다 (§7 -- 이 모듈은
 * 회원 이름을 모른다).
 *
 * @param {Array<any>} passes 센터의 회원권 전부
 * @param {{ now?: Date, clientIdsOf?: (pass: any) => Array<string> }} [options]
 * @returns {Array<{ clientId: string, rows: Array<any> }>}
 */
export function expiryOrderByClient(passes, options = {}) {
  const clientIdsOf = typeof options.clientIdsOf === "function"
    ? options.clientIdsOf
    : (pass) => [text(pass?.clientId)].filter(Boolean);
  const now = options.now instanceof Date ? options.now : new Date();

  /* 회원마다 자기 회원권만 모아 본다. 센터 전체를 한 번에 견주면 남의
     회원권이 서로의 차수를 가로챈다. */
  const byClient = new Map();
  for (const pass of Array.isArray(passes) ? passes : []) {
    for (const clientId of clientIdsOf(pass)) {
      if (!clientId) continue;
      if (!byClient.has(clientId)) byClient.set(clientId, []);
      byClient.get(clientId).push(pass);
    }
  }

  const found = [];
  for (const [clientId, mine] of byClient) {
    const rows = expiryOutOfOrder(mine, { ...options, now });
    if (rows.length) found.push({ clientId, rows });
  }
  return found;
}
