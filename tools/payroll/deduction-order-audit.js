/**
 * 순서가 틀린 차감을 찾는다. **읽지도 쓰지도 않는다** -- 셈만 한다.
 *
 * ── 무엇이 틀렸는가 ──
 * 2026-10-09 부터 10-22 까지 차감이 **차수 순**으로 돌았다. 그 사이에 뒤
 * 차수의 만료가 더 이른 회원이 있으면, 앞 차수가 먼저 빠지고 뒤 차수는 손도
 * 못 대 보고 만료로 갔다 -- 회원이 돈을 낸 회차다. 율하점 10/15 차감이 그것이다.
 *
 * 2026-10-22 부터 만료일 순으로 돌아왔다. 이 스크립트는 **그 사이에 일어난
 * 일만** 찾는다.
 *
 * ── 고치지 않는다 ──
 * 원장은 append-only 라 지난 항목을 옮길 수 없고, 고치는 길은 보정 항목을
 * 쌓고 다시 차감하는 것뿐이다 -- 그것은 사람이 회원과 이야기한 뒤에 정할 일이다.
 * 여기는 "어느 줄이 그런가" 까지만 답한다.
 */

const text = (value) => String(value ?? "").trim();

const toDate = (value) => {
  if (!value) return null;
  const at = typeof value?.toDate === "function" ? value.toDate() : new Date(value);
  return Number.isFinite(at?.getTime?.()) ? at : null;
};

const expiryTime = (pass) => {
  const at = toDate(pass?.expiresAt);
  return at ? at.getTime() : null;
};

const roundOf = (pass) => {
  const round = Number(pass?.purchaseRound);
  return Number.isInteger(round) && round > 0 ? round : null;
};

/**
 * 두 회원권이 같은 후보군인가.
 *
 * 1:1 과 2:1 은 서로의 후보가 아니다 -- 그 둘을 견주면 아무 문제 없는
 * 회원권이 매번 걸린다. 디오사도 A·B 가 따로 팔리므로 카테고리로 가른다.
 */
export function candidateKind(pass) {
  const category = text(pass?.category);
  if (category === "diosa_a" || category === "diosa_b") return category;
  const clientIds = Array.isArray(pass?.clientIds) ? pass.clientIds.filter(Boolean) : [];
  if (clientIds.length > 1) return "duet";
  return category.startsWith("pt_2_1") ? "duet" : "solo";
}

/**
 * 그 차감이 일어난 순간, **더 먼저 만료되는 같은 종류의 회원권**이 쓸 수 있는
 * 상태로 남아 있었는가.
 *
 * 남아 있었다면 새 규칙에서는 그쪽이 빠졌어야 한다.
 *
 * 잔여는 **그 시점의 값을 되짚는다** -- 지금 값으로 보면 그 뒤에 일어난
 * 차감까지 섞여, 그때 쓸 수 있었던 회원권을 "없었다" 로 읽는다.
 *
 * @param {{
 *   entries?: Array<any>, passes?: Array<any>,
 *   from?: Date, to?: Date,
 * }} input
 *   from·to 차수 순으로 돌던 구간. 그 밖의 차감은 규칙대로 간 것이다
 */
export function misorderedDeductions({ entries, passes, from, to } = {}) {
  const all = (Array.isArray(passes) ? passes : []).filter(Boolean);
  const byId = new Map(all.map((pass) => [text(pass.id || pass.passId), pass]));

  const deductions = (Array.isArray(entries) ? entries : [])
    .filter((entry) => text(entry?.type) === "deduct")
    .map((entry) => ({ entry, at: toDate(entry.occurredAt) }))
    .filter((row) => row.at !== null)
    .sort((left, right) => left.at.getTime() - right.at.getTime());

  /* 그 시점의 잔여를 되짚는다. 지금 잔여에서 **그 뒤의 차감을 되돌려** 올린다 --
     앞에서부터 걸으면서 하나씩 쓰면 되므로, 시작값만 구하면 된다. */
  const spentAfter = new Map();
  for (const { entry } of deductions) {
    const passId = text(entry.passId);
    spentAfter.set(passId, (spentAfter.get(passId) || 0) + 1);
  }
  const remainingAt = new Map();
  for (const pass of all) {
    const id = text(pass.id || pass.passId);
    const now = Number(pass?.remainingCount);
    remainingAt.set(id, (Number.isInteger(now) ? now : 0) + (spentAfter.get(id) || 0));
  }

  const found = [];
  for (const { entry, at } of deductions) {
    const passId = text(entry.passId);
    const used = byId.get(passId);
    /* 회원권을 못 읽으면 견줄 수 없다. 모르는 것으로 목록을 채우면 그 목록은
       곧 안 읽힌다. */
    if (used) {
      const inWindow = (!from || at.getTime() >= from.getTime())
        && (!to || at.getTime() < to.getTime());
      const usedExpiry = expiryTime(used);
      if (inWindow && usedExpiry !== null) {
        const kind = candidateKind(used);
        const clientIds = Array.isArray(used.clientIds) && used.clientIds.length
          ? used.clientIds.map(text)
          : [text(used.clientId)];

        /* 그 순간 쓸 수 있었던, 같은 회원·같은 종류의 다른 회원권 중 더 먼저
           만료되는 것. */
        const shouldHaveUsed = all
          .filter((other) => text(other.id || other.passId) !== passId)
          .filter((other) => candidateKind(other) === kind)
          .filter((other) => {
            const otherClients = Array.isArray(other.clientIds) && other.clientIds.length
              ? other.clientIds.map(text)
              : [text(other.clientId)];
            return otherClients.some((id) => clientIds.includes(id));
          })
          .filter((other) => (remainingAt.get(text(other.id || other.passId)) || 0) > 0)
          .filter((other) => {
            const otherExpiry = expiryTime(other);
            /* 만료일이 없는 회원권은 맨 뒤다 -- 그것이 먼저 쓰였어야 할 이유가
               없다. 그리고 그때 이미 만료된 것도 후보가 아니다. */
            return otherExpiry !== null
              && otherExpiry > at.getTime()
              && otherExpiry < usedExpiry;
          })
          .sort((left, right) => (expiryTime(left) ?? 0) - (expiryTime(right) ?? 0))[0] || null;

        if (shouldHaveUsed) {
          found.push({
            entryId: text(entry.id),
            occurredAt: at,
            instructorId: text(entry.instructorId),
            clientId: text(entry.clientId),
            usedPassId: passId,
            usedRound: roundOf(used),
            usedExpiresAt: toDate(used.expiresAt),
            usedUnitPrice: Number(entry.unitPrice) || 0,
            shouldPassId: text(shouldHaveUsed.id || shouldHaveUsed.passId),
            shouldRound: roundOf(shouldHaveUsed),
            shouldExpiresAt: toDate(shouldHaveUsed.expiresAt),
            kind,
          });
        }
      }
    }
    // 걸어가며 그 회원권의 잔여를 하나 쓴다.
    remainingAt.set(passId, (remainingAt.get(passId) || 0) - 1);
  }
  return found;
}

/** 사람이 읽는 요약. */
export function summarizeOrderAudit(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return {
    entries: list.length,
    clients: new Set(list.map((row) => row.clientId)).size,
    instructors: new Set(list.map((row) => row.instructorId)).size,
    /* 만료로 사라질 수 있는 회차. 이 목록의 요점이 이 숫자다 -- 회원이 돈을
       낸 회차가 몇 개 위험한가. */
    passesAtRisk: new Set(list.map((row) => row.shouldPassId)).size,
  };
}
