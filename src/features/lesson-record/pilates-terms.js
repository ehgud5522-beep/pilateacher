/* 전사가 놓친 필라테스 용어를 되돌리는 사전.

   STT 는 "리포머"를 "리폼화", "디포먼트"로 적어 놓는다. 강사에게는 기록이 틀린
   것으로 보이고, 뒤이어 4칸으로 정리할 때도 틀린 단어가 그대로 들어간다.

   ── variants 를 추가하는 법 ─────────────────────────────────────────
   실사용에서 오인식이 나오면 그 표현을 해당 canonical 의 variants 에 넣는다.
   기기에 쌓이는 교정 기록(readPilatesTermCorrections)에 무엇이 얼마나 고쳐졌는지
   남으므로, 거기서 자주 보이는 것부터 채워 넣으면 된다.

   넣을 때 지키는 것:
   - 실제 다른 뜻으로 쓰이는 일반어는 넣지 않는다. "체어"를 "의자"로 되돌리면
     의자를 말한 기록까지 바뀐다.
   - 짧은 조각(두 글자 이하)은 넣지 않는다. 다른 단어 안에 박혀 있을 수 있다.
   - 확실하지 않으면 넣지 않는다. 틀린 교정은 틀린 전사보다 나쁘다 -- 강사는
     자기가 말한 것이 바뀐 줄 모른다.
   ──────────────────────────────────────────────────────────────── */

/* variants 가 빈 항목은 아직 안전하게 되돌릴 오인식을 못 찾은 것이다. 용어 자체는
   남겨 둔다 -- 이 목록이 우리가 다루는 용어의 등록부이고, 오인식이 관찰되면
   여기에 붙이면 된다. 두 글자짜리는 다른 낱말에 박혀 있어 쓰지 않는다. */
export const PILATES_TERM_DICTIONARY = Object.freeze([
  // 기구
  { canonical: "리포머", variants: ["리폼화", "디포먼트", "리포마", "리포머스", "리퍼머", "리포먼트", "래퍼무어"] },
  { canonical: "캐딜락", variants: ["캐딜라", "게릴락", "캐들락", "카딜락"] },
  { canonical: "체어", variants: ["체어기구"] },
  { canonical: "바렐", variants: ["바렐기구"] },
  { canonical: "스프링보드", variants: ["스프링보트", "스프링볼드"] },
  { canonical: "타워", variants: ["타월기구"] },

  // 동작
  { canonical: "풋워크", variants: ["푸트워크", "풋워커"] },
  { canonical: "헌드레드", variants: ["헌드레스", "헌드렛", "훈드레드", "헌드러드"] },
  { canonical: "롤업", variants: [] },
  { canonical: "티저", variants: ["티저동작"] },
  { canonical: "숄더브릿지", variants: ["숄더브리지", "숄더브릿찌", "쇼울더브릿지"] },
  { canonical: "스완", variants: ["스완동작"] },
  { canonical: "머메이드", variants: ["머메이더", "메르메이드", "머매이드"] },
  { canonical: "스파인트위스트", variants: ["스파인 트위스트", "스파인트위스터"] },
  { canonical: "레그서클", variants: ["레그 서클", "렉서클", "레그써클"] },
  { canonical: "사이드킥", variants: ["사이드 킥", "사이드킼"] },

  // 부위
  { canonical: "견갑", variants: ["견갑골부위"] },
  { canonical: "흉추", variants: [] },
  { canonical: "요추", variants: [] },
  { canonical: "중둔근", variants: ["중둔근육", "중든근"] },
  { canonical: "대둔근", variants: ["대둔근육", "대든근"] },
  { canonical: "내전근", variants: ["내전근육", "내정근"] },
  { canonical: "복사근", variants: ["복사근육", "복싸근"] },
  { canonical: "능형근", variants: ["능형근육", "능현근"] },
  { canonical: "승모근", variants: ["승모근육", "승보근"] },

  // 기타
  { canonical: "큐잉", variants: [] },
  { canonical: "시퀀스", variants: ["시퀀서", "시퀜스"] },
  { canonical: "얼라인먼트", variants: ["얼라인먼드", "얼라이먼트"] },
  { canonical: "코어", variants: [] },
  { canonical: "뉴트럴", variants: ["뉴트롤", "뉴츄럴"] },
  { canonical: "임프린트", variants: ["임프린드", "인프린트"] },
]);

export const PILATES_TERM_CORRECTION_KEY = "pilateacher_stt_term_corrections_v1";
export const PILATES_TERM_CORRECTION_LIMIT = 200;

/* 한글에는 단어를 띄어 쓰는 경계가 없다. 그렇다고 뒤에 한글이 오면 무조건 넘기면,
   조사가 붙는 "리폼화로"·"리폼화를"이 전부 빠진다 -- 그게 대부분의 경우다.

   그래서 앞은 막고 뒤는 가린다. 앞에 한글이 이어지면 더 긴 낱말의 가운데이므로
   건드리지 않고, 뒤는 조사로 시작할 때만 낱말이 끝난 것으로 본다. "코얼"이
   "코얼링" 안에서 바뀌는 일은 이 규칙이 막는다. */
const HANGUL = /[가-힣]/u;
const PARTICLE_START = /^[로를을은는이가의에와과도만랑써랄']/u;
const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const boundedAt = (text, start, end) => {
  const before = start > 0 ? text[start - 1] : "";
  const after = end < text.length ? text.slice(end) : "";
  if (HANGUL.test(before)) return false;
  if (!after) return true;
  return !HANGUL.test(after[0]) || PARTICLE_START.test(after);
};

/* 긴 변형부터 본다. "스파인 트위스트"가 "스파인"보다 먼저 걸려야 한다.
   두 글자짜리는 다른 낱말 안에 그대로 들어 있기 쉬워 쓰지 않는다. */
const orderedVariants = () => PILATES_TERM_DICTIONARY
  .flatMap((entry) => entry.variants.map((variant) => ({ variant, canonical: entry.canonical })))
  .filter((item) => String(item.variant || "").replace(/\s+/gu, "").length > 2)
  .sort((a, b) => b.variant.length - a.variant.length);

export function correctPilatesTerms(value) {
  const original = String(value ?? "");
  if (!original.trim()) return { transcript: original, corrections: [] };
  let transcript = original;
  const corrections = [];
  for (const { variant, canonical } of orderedVariants()) {
    if (!transcript.includes(variant)) continue;
    const matcher = new RegExp(escapeRegExp(variant), "gu");
    transcript = transcript.replace(matcher, (match, offset, full) => {
      if (!boundedAt(full, offset, offset + match.length)) return match;
      corrections.push({ heard: variant, canonical });
      return canonical;
    });
  }
  return { transcript, corrections };
}

/* 무엇이 얼마나 고쳐졌는지 기기에 쌓아 둔다. 사전을 넓힐 때 쓰는 자료이고,
   서버로 보내지 않는다 -- 강사가 말한 문장이 아니라 단어만 남긴다. */
export function readPilatesTermCorrections(storage = globalThis.localStorage) {
  try {
    const parsed = JSON.parse(storage?.getItem?.(PILATES_TERM_CORRECTION_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) { return []; }
}

export function recordPilatesTermCorrections(corrections, storage = globalThis.localStorage, clock = () => new Date()) {
  const entries = (Array.isArray(corrections) ? corrections : [])
    .filter((item) => item && item.heard && item.canonical)
    .map((item) => ({ heard: String(item.heard), canonical: String(item.canonical), at: clock().toISOString() }));
  if (!entries.length) return readPilatesTermCorrections(storage);
  // 오래된 것부터 버린다.
  const next = [...readPilatesTermCorrections(storage), ...entries].slice(-PILATES_TERM_CORRECTION_LIMIT);
  try { storage?.setItem?.(PILATES_TERM_CORRECTION_KEY, JSON.stringify(next)); } catch (_error) {}
  return next;
}

/* 교정하고 그 사실을 기록까지 한 번에. 전사가 들어오는 자리에서 부른다. */
export function applyPilatesTermDictionary(value, storage = globalThis.localStorage) {
  const result = correctPilatesTerms(value);
  if (result.corrections.length) recordPilatesTermCorrections(result.corrections, storage);
  return result.transcript;
}
