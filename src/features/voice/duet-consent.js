/**
 * 듀엣 수업의 AI 기록 동의. 두 사람 모두 동의해야 한다.
 *
 * ── 왜 둘 다인가 ──
 * 듀엣 수업기록에는 두 사람 이야기가 같이 들어간다. 한 명만 동의했는데 녹음을
 * 올리면 다른 사람의 수업 내용이 동의 없이 서버로 가서 처리된다. 대표 회원이
 * 동의했다는 사실은 짝에 대해 아무것도 말해 주지 않는다 -- 대표는 회원권을
 * 찾는 열쇠일 뿐이고, 두 사람은 각자 독립된 회원이다.
 *
 * ── 누가 안 했는지 말한다 ──
 * "동의가 필요합니다" 한 줄로 끝내면 강사는 둘 중 누구에게 물어야 하는지
 * 모른다. 두 사람이 앞에 서 있고 수업은 시작해야 하는 자리다 -- 이름을 대야
 * 그 자리에서 끝난다.
 *
 * 이름은 화면에만 쓴다. 진단에는 남기지 않는다 (CLAUDE.md 7항).
 */

const text = (value) => String(value ?? "").trim();

/**
 * 이 수업기록이 동의를 받아야 할 사람들.
 *
 * 순서는 대표가 먼저다. 화면이 물어보는 순서이고, 강사가 늘 같은 순서를 보면
 * 두 번째 이름이 짝이라는 것을 따로 설명하지 않아도 안다.
 *
 * @param {{ memberId?: string, memberName?: string, duetPartner?: { id?: string, name?: string } | null }} input
 * @returns {Array<{ id: string, name: string }>}
 */
export function consentTargetsFor(input = {}) {
  const id = text(input.memberId);
  if (!id) return [];
  const targets = [{ id, name: text(input.memberName) || "회원" }];
  const partnerId = text(input.duetPartner?.id);
  /* 짝이 자기 자신으로 들어오면 같은 사람에게 두 번 묻게 된다. 한 번 거절하면
     두 번 거절한 것으로 세어져 문구가 "김하나 님, 김하나 님" 이 된다. */
  if (partnerId && partnerId !== id) {
    targets.push({ id: partnerId, name: text(input.duetPartner?.name) || "듀엣 상대" });
  }
  return targets;
}

/**
 * 한 사람이라도 동의가 없으면 막는다.
 *
 * 먼저 거절한 사람에서 멈추지 않고 전부 확인한다 -- 둘 다 없으면 강사가 한
 * 번에 알아야 한다. 한 명씩 알려 주면 첫 번째를 받아 온 뒤 두 번째에서 또
 * 막히고, 그때는 이미 회원 둘이 매트에 누워 있다.
 *
 * 확인 자체가 실패한 사람(네트워크 등)도 동의 없음으로 친다. 모르는 것을
 * 있는 것으로 세면 동의 없는 기록이 올라간다.
 *
 * @param {Array<{ id: string, name: string }>} targets
 * @param {(id: string) => Promise<{ ok?: boolean, message?: string, code?: string }>} check
 */
export async function ensureEveryConsent(targets, check) {
  const list = Array.isArray(targets) ? targets.filter((item) => text(item?.id)) : [];
  if (!list.length) return { ok: false, missing: [], message: "AI 처리를 적용할 회원을 먼저 선택해 주세요." };

  const results = [];
  for (const target of list) {
    let outcome;
    try {
      outcome = await check(target.id);
    } catch (error) {
      outcome = { ok: false, code: error?.code || "consent_check_failed", message: error?.message };
    }
    results.push({ target, outcome: outcome || { ok: false } });
  }

  const missing = results.filter((item) => item.outcome.ok !== true);
  if (!missing.length) return { ok: true, missing: [], message: "" };
  return {
    ok: false,
    missing: missing.map((item) => item.target),
    /* 첫 번째 실패의 원본 코드를 함께 들고 간다. 로그인이 끊긴 것과 동의가
       없는 것은 강사가 할 일이 다르다 (CLAUDE.md 1항). */
    code: missing[0].outcome.code || "consent_required",
    message: missingConsentMessage(missing.map((item) => item.target), list.length),
  };
}

/**
 * 화면에 쓸 한 줄. 누가 안 했는지 이름을 댄다.
 *
 * @param {Array<{ name?: string }>} missing
 * @param {number} total 동의를 받아야 할 전체 인원
 */
export function missingConsentMessage(missing, total = 1) {
  const names = (Array.isArray(missing) ? missing : []).map((item) => text(item?.name)).filter(Boolean);
  if (!names.length) return "AI 수업기록 이용 동의가 필요합니다.";
  if (total <= 1) return `${names[0]} 님의 AI 수업기록 이용 동의가 필요합니다.`;
  /* 듀엣은 둘 다 안 했을 수 있다. "두 분 모두" 라고 말해야 강사가 한 명만
     받아 오고 다시 막히는 일이 없다. */
  if (names.length >= total) return `${names.join(" 님, ")} 님 — 두 분 모두 AI 수업기록 이용 동의가 필요합니다.`;
  return `${names.join(" 님, ")} 님의 AI 수업기록 이용 동의가 필요합니다. (듀엣 수업은 두 분 모두 필요합니다)`;
}
