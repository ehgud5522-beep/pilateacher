import terms from "./pilates-terms.json" with { type: "json" };

const normalize = (value) => String(value || "").trim().toLocaleLowerCase("ko-KR").replace(/\s+/g, "");
const KOREAN_PARTICLES = Object.freeze(["에서", "으로", "부터", "까지", "에게", "처럼", "보다", "하고", "의", "에", "로", "을", "를", "은", "는", "이", "가", "와", "과", "도", "만"]);
const particleLookahead = KOREAN_PARTICLES.join("|");

function editDistance(left, right) {
  const a = [...left];
  const b = [...right];
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const previous = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = previous;
    }
  }
  return row[b.length];
}

const cleanEntry = (entry, raw, confidence) => ({
  raw,
  canonical: entry.canonical,
  category: entry.category,
  bodyKey: entry.bodyKey,
  confidence,
});

export function mapPilatesTerms(rawTranscript) {
  const transcript = String(rawTranscript || "").trim();
  const mapped = [];
  const uncertain = [];
  const occupied = new Set();

  for (const entry of terms) {
    for (const alias of entry.aliases || []) {
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = new RegExp(`(?<![A-Za-z가-힣])${escaped}(?=$|[^A-Za-z가-힣]|(?:${particleLookahead})(?=$|[^A-Za-z가-힣]))`, /[A-Za-z]/.test(alias) ? "giu" : "gu");
      let match;
      while ((match = pattern.exec(transcript))) {
        const key = `${match.index}:${match[0].length}`;
        if (!occupied.has(key)) {
          occupied.add(key);
          mapped.push({ ...cleanEntry(entry, match[0], 1), start: match.index, end: match.index + match[0].length });
        }
        if (!match[0].length) pattern.lastIndex += 1;
      }
    }
  }

  const known = new Set(mapped.map((item) => normalize(item.raw)));
  const tokens = transcript.match(/[A-Za-z]{3,}|[가-힣]{2,}/g) || [];
  for (const token of tokens) {
    const bases = [token, ...KOREAN_PARTICLES.filter((particle) => token.endsWith(particle) && token.length > particle.length + 1).map((particle) => token.slice(0, -particle.length))];
    if (bases.some((base) => known.has(normalize(base)) || terms.some((entry) => (entry.aliases || []).some((alias) => normalize(alias) === normalize(base))))) continue;
    let candidate = null;
    for (const base of bases) {
      const normalizedToken = normalize(base);
      for (const entry of terms) {
        for (const alias of entry.aliases || []) {
          const normalizedAlias = normalize(alias);
          if (normalizedAlias.length < 3 || Math.abs(normalizedAlias.length - normalizedToken.length) > 1) continue;
          const distance = editDistance(normalizedToken, normalizedAlias);
          if (distance === 1 && (!candidate || normalizedAlias.length > normalize(candidate.raw).length)) {
            candidate = cleanEntry(entry, base, 0.65);
          }
        }
      }
    }
    if (candidate && !uncertain.some((item) => item.raw === token && item.canonical === candidate.canonical)) uncertain.push(candidate);
  }

  return {
    version: 1,
    rawTranscript: transcript,
    mapped: mapped.sort((a, b) => a.start - b.start),
    uncertain,
  };
}

export const PILATES_TERMS = Object.freeze(terms.map((entry) => Object.freeze({ ...entry, aliases: Object.freeze([...(entry.aliases || [])]) })));
