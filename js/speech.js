// Spracheingabe (Web Speech API) und Vorlesen (Speech Synthesis).

const Recognition =
  typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);

export const canListen = Boolean(Recognition);
export const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window;

let active = null;

const ERRORS = {
  'not-allowed': 'Kein Zugriff auf das Mikrofon. Bitte im Browser erlauben.',
  'service-not-allowed': 'Spracherkennung ist in diesem Browser nicht erlaubt.',
  'audio-capture': 'Kein Mikrofon gefunden.',
  network: 'Spracherkennung braucht eine Internetverbindung.',
  'language-not-supported': 'Diese Sprache wird von der Spracherkennung nicht unterstützt.',
};

export function errorMessage(err) {
  return ERRORS[err?.message] ?? `Spracherkennung fehlgeschlagen (${err?.message ?? err}).`;
}

export function isListening() {
  return active !== null;
}

/**
 * Hört einmal zu und liefert die erkannten Varianten (beste zuerst).
 * Leeres Array, wenn nichts verstanden wurde oder abgebrochen.
 */
export function listen(lang, { onInterim, maxAlternatives = 5 } = {}) {
  if (!Recognition) return Promise.reject(new Error('unsupported'));
  cancel();
  if (canSpeak) window.speechSynthesis.cancel();

  return new Promise((resolve, reject) => {
    const rec = new Recognition();
    rec.lang = lang;
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = maxAlternatives;

    let finals = null;
    let error = null;

    rec.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        if (res.isFinal) {
          finals = Array.from(res, (a) => cleanup(a.transcript)).filter(Boolean);
        } else if (onInterim) {
          onInterim(res[0].transcript);
        }
      }
    };
    rec.onerror = (event) => {
      error = event.error;
    };
    rec.onend = () => {
      if (active === rec) active = null;
      if (finals && finals.length) resolve([...new Set(finals)]);
      else if (error && !['no-speech', 'aborted'].includes(error)) reject(new Error(error));
      else resolve([]);
    };

    active = rec;
    try {
      rec.start();
    } catch (e) {
      active = null;
      reject(e);
    }
  });
}

function cleanup(text) {
  return text.trim().replace(/[.!?。]+$/u, '').trim();
}

/** Beendet das Zuhören und wertet das bisher Gesagte aus. */
export function stop() {
  active?.stop();
}

/** Bricht das Zuhören ohne Ergebnis ab. */
export function cancel() {
  if (active) {
    const rec = active;
    active = null;
    rec.abort();
  }
}

function pickVoice(lang) {
  const voices = window.speechSynthesis.getVoices();
  const exact = voices.filter((v) => v.lang.replace('_', '-') === lang);
  const base = lang.split('-')[0];
  const similar = voices.filter((v) => v.lang.toLowerCase().startsWith(base));
  const list = exact.length ? exact : similar;
  return list.find((v) => v.localService) ?? list[0] ?? null;
}

/** Liest einen Text vor. Das Promise wird erfüllt, sobald das Vorlesen fertig ist. */
export function speak(text, lang) {
  if (!canSpeak || !text) return Promise.resolve();
  const synth = window.speechSynthesis;
  synth.cancel();
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    const voice = pickVoice(lang);
    if (voice) u.voice = voice;
    u.rate = 0.95;
    const done = () => resolve();
    u.onend = done;
    u.onerror = done;
    // Fallback, falls onend nie feuert (kommt in manchen Browsern vor)
    setTimeout(done, 1500 + text.length * 150);
    synth.speak(u);
  });
}

if (canSpeak) {
  // Stimmen werden in Chrome asynchron geladen
  window.speechSynthesis.getVoices();
}
