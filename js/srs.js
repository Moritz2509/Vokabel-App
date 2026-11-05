// Spaced-Repetition-Logik (angelehnt an SM-2 / Anki).
//
// Jede Karte hat einen Lernstand (srs). Je nachdem, wie gut du eine Vokabel
// kannst, wird der Abstand bis zur nächsten Abfrage größer (gut gekonnt)
// oder sie kommt sofort wieder dran (nicht gekonnt).

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export const RATING = Object.freeze({ AGAIN: 0, HARD: 1, GOOD: 2, EASY: 3 });
export const RATING_LABELS = ['Nochmal', 'Schwer', 'Gut', 'Leicht'];

const MIN_EASE = 1.3;
const START_EASE = 2.5;
const MAX_INTERVAL_DAYS = 3650;

// Lernschritte für neue/falsch beantwortete Karten
const AGAIN_STEP = 1 * MINUTE;
const HARD_STEP = 10 * MINUTE;

export function newSrs(now = Date.now()) {
  return {
    state: 'new', // new | learning | review
    ease: START_EASE, // Faktor, um den das Intervall wächst
    interval: 0, // in Tagen (nur im Zustand "review")
    reps: 0, // erfolgreiche Wiederholungen in Folge (review)
    lapses: 0, // wie oft eine gelernte Karte wieder vergessen wurde
    streak: 0, // richtige Antworten in Folge
    due: now,
    last: null,
  };
}

/**
 * Berechnet den neuen Lernstand nach einer Bewertung.
 * Gibt ein neues Objekt zurück, das alte bleibt unverändert.
 */
export function review(srs, rating, now = Date.now()) {
  const s = { ...srs, last: now };

  if (rating === RATING.AGAIN) {
    if (s.state === 'review') s.lapses += 1;
    if (s.state !== 'new') s.ease = Math.max(MIN_EASE, s.ease - 0.2);
    s.state = 'learning';
    s.reps = 0;
    s.interval = 0;
    s.streak = 0;
    s.due = now + AGAIN_STEP;
    return s;
  }

  s.streak += 1;

  if (s.state === 'new' || s.state === 'learning') {
    if (rating === RATING.HARD) {
      // noch nicht sicher: bleibt in der Lernphase und kommt bald wieder
      s.state = 'learning';
      s.due = now + HARD_STEP;
      return s;
    }
    s.state = 'review';
    s.reps = 1;
    if (rating === RATING.EASY) {
      s.interval = 4;
      s.ease += 0.15;
    } else {
      s.interval = 1;
    }
    s.due = now + s.interval * DAY;
    return s;
  }

  // state === 'review'
  const prev = Math.max(1, s.interval);
  const good = Math.max(prev + 1, Math.round(prev * s.ease));
  let next;
  if (rating === RATING.HARD) {
    next = Math.max(1, Math.round(prev * 1.2));
    s.ease = Math.max(MIN_EASE, s.ease - 0.15);
  } else if (rating === RATING.GOOD) {
    next = good;
  } else {
    next = Math.max(good + 1, Math.round(prev * s.ease * 1.3));
    s.ease += 0.15;
  }
  s.interval = Math.min(MAX_INTERVAL_DAYS, next);
  s.reps += 1;
  s.due = now + s.interval * DAY;
  return s;
}

/** Zeitspanne bis zur nächsten Abfrage für jede Bewertung (für die Buttons). */
export function preview(srs, now = Date.now()) {
  return [RATING.AGAIN, RATING.HARD, RATING.GOOD, RATING.EASY].map(
    (r) => review(srs, r, now).due - now,
  );
}

export function isDue(srs, now = Date.now()) {
  return srs.state === 'new' || srs.due <= now;
}

/** 0 = neu, 1 = am Lernen, 2 = sitzt fast, 3 = gemeistert */
export function mastery(srs) {
  if (srs.state === 'new') return 0;
  if (srs.state === 'learning' || srs.interval < 4) return 1;
  if (srs.interval < 21) return 2;
  return 3;
}
export const MASTERY_LABELS = ['Neu', 'Am Lernen', 'Sitzt fast', 'Gemeistert'];

/**
 * Stellt die Karten für eine Lernrunde zusammen:
 * zuerst fällige Karten (die am längsten überfälligen zuerst),
 * dann bis zu `newLimit` neue Karten.
 */
export function dueQueue(cards, now = Date.now(), newLimit = 20) {
  const due = cards
    .filter((c) => c.srs.state !== 'new' && c.srs.due <= now)
    .sort((a, b) => a.srs.due - b.srs.due);
  const fresh = cards
    .filter((c) => c.srs.state === 'new')
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
    .slice(0, Math.max(0, newLimit));
  return [...due, ...fresh];
}

/** Alle Karten, die schwächsten zuerst (zum freien Üben). */
export function weakestFirst(cards) {
  return [...cards].sort(
    (a, b) =>
      mastery(a.srs) - mastery(b.srs) ||
      b.srs.lapses - a.srs.lapses ||
      a.srs.ease - b.srs.ease ||
      a.srs.interval - b.srs.interval,
  );
}

/** Zeitpunkt der nächsten fälligen Wiederholung (ohne neue Karten). */
export function nextDue(cards) {
  let min = Infinity;
  for (const c of cards) if (c.srs.state !== 'new' && c.srs.due < min) min = c.srs.due;
  return min === Infinity ? null : min;
}

export function formatInterval(ms) {
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / MINUTE))} Min`;
  if (ms < 20 * HOUR) return `${Math.round(ms / HOUR)} Std`;
  const days = Math.round(ms / DAY);
  if (days < 31) return days === 1 ? '1 Tag' : `${days} Tage`;
  if (days < 365) return `${Math.round(days / 30)} Mon`;
  const y = Math.round((days / 365) * 10) / 10;
  return `${String(y).replace('.', ',')} J`;
}

/**
 * Eine Lernrunde, wie bei Quizlet: Karten, die du nicht wusstest,
 * werden ein paar Karten später erneut abgefragt – so lange, bis sie sitzen.
 */
export class Session {
  constructor(ids) {
    this.queue = [...ids];
    this.total = this.queue.length;
    this.finished = new Set();
    this.attempts = new Map();
    this.firstTryCorrect = 0;
    this.mistakes = new Set();
    this.answered = 0;
  }

  get current() {
    return this.queue[0];
  }

  get done() {
    return this.queue.length === 0;
  }

  get progress() {
    return this.total ? this.finished.size / this.total : 1;
  }

  /**
   * @param {boolean} correct  wurde die Karte gewusst?
   * @param {boolean} requeue  soll sie in dieser Runde nochmal kommen?
   * @param {number}  gap      nach wie vielen anderen Karten
   */
  next(correct, requeue, gap = 3) {
    const id = this.queue.shift();
    if (id === undefined) return;
    this.answered += 1;
    const n = (this.attempts.get(id) ?? 0) + 1;
    this.attempts.set(id, n);
    if (n === 1 && correct) this.firstTryCorrect += 1;
    if (!correct) this.mistakes.add(id);
    if (requeue) {
      this.queue.splice(Math.min(gap, this.queue.length), 0, id);
    } else {
      this.finished.add(id);
    }
  }
}
