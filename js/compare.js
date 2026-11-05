// Vergleicht eine (getippte oder gesprochene) Antwort mit der richtigen Lösung.
// Tolerant gegenüber Groß-/Kleinschreibung, Satzzeichen, Artikeln und kleinen Tippfehlern.

const ARTICLES = new Set([
  'der', 'die', 'das', 'den', 'dem', 'ein', 'eine', 'einen', 'einem', 'einer',
  'the', 'a', 'an', 'to',
  'le', 'la', 'les', 'l', 'un', 'une',
  'el', 'los', 'las', 'una', 'il', 'lo', 'gli', 'uno',
  'het', 'een',
]);

export function normalize(text, { stripArticles = true } = {}) {
  let t = String(text ?? '').toLowerCase().normalize('NFC');
  t = t.replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ');
  t = t.replace(/[’'`´]/g, ' ');
  t = t.replace(/[^\p{L}\p{N}\s]/gu, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  if (stripArticles) {
    const parts = t.split(' ');
    while (parts.length > 1 && ARTICLES.has(parts[0])) parts.shift();
    t = parts.join(' ');
  }
  return t;
}

export function fold(text) {
  return text.normalize('NFD').replace(/\p{M}/gu, '').replace(/ß/g, 'ss');
}

/** "Haus, Gebäude / Bau" -> ["Haus", "Gebäude", "Bau"] */
export function splitAnswers(expected) {
  return String(expected ?? '')
    .split(/[,;/|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

function allowedTypos(len) {
  if (len <= 3) return 0;
  if (len <= 7) return 1;
  return 2;
}

/**
 * @returns {{result: 'correct'|'close'|'wrong', distance: number}}
 *   correct = richtig, close = fast richtig (Akzent/Tippfehler), wrong = falsch
 */
export function checkAnswer(given, expected) {
  const g = normalize(given);
  if (!g) return { result: 'wrong', distance: Infinity };
  const options = [expected, ...splitAnswers(expected)].map((o) => normalize(o)).filter(Boolean);

  if (options.includes(g)) return { result: 'correct', distance: 0 };

  const gf = fold(g);
  let best = Infinity;
  for (const o of options) {
    const of = fold(o);
    if (of === gf) return { result: 'close', distance: 0 };
    const d = levenshtein(of, gf);
    if (d <= allowedTypos(of.length) && d < best) best = d;
  }
  if (best !== Infinity) return { result: 'close', distance: best };
  return { result: 'wrong', distance: Infinity };
}

const RANK = { correct: 0, close: 1, wrong: 2 };

/**
 * Für Spracheingabe: Die Spracherkennung liefert mehrere Varianten
 * des Gesagten. Wir nehmen diejenige, die am besten passt.
 */
export function checkBest(alternatives, expected) {
  let best = null;
  for (const alt of alternatives) {
    const r = checkAnswer(alt, expected);
    if (
      !best ||
      RANK[r.result] < RANK[best.result] ||
      (RANK[r.result] === RANK[best.result] && r.distance < best.distance)
    ) {
      best = { ...r, text: alt };
    }
  }
  return best ?? { result: 'wrong', distance: Infinity, text: '' };
}
