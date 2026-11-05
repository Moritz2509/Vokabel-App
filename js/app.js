import * as srs from './srs.js';
import * as store from './store.js';
import * as speech from './speech.js';
import { checkAnswer, checkBest, normalize } from './compare.js';

const { RATING } = srs;

const LANGS = [
  ['de-DE', 'Deutsch'],
  ['en-GB', 'Englisch (UK)'],
  ['en-US', 'Englisch (US)'],
  ['fr-FR', 'Französisch'],
  ['es-ES', 'Spanisch'],
  ['it-IT', 'Italienisch'],
  ['pt-PT', 'Portugiesisch'],
  ['pt-BR', 'Portugiesisch (BR)'],
  ['nl-NL', 'Niederländisch'],
  ['sv-SE', 'Schwedisch'],
  ['da-DK', 'Dänisch'],
  ['nb-NO', 'Norwegisch'],
  ['fi-FI', 'Finnisch'],
  ['pl-PL', 'Polnisch'],
  ['cs-CZ', 'Tschechisch'],
  ['hr-HR', 'Kroatisch'],
  ['hu-HU', 'Ungarisch'],
  ['ro-RO', 'Rumänisch'],
  ['ru-RU', 'Russisch'],
  ['uk-UA', 'Ukrainisch'],
  ['el-GR', 'Griechisch'],
  ['tr-TR', 'Türkisch'],
  ['ar-SA', 'Arabisch'],
  ['he-IL', 'Hebräisch'],
  ['hi-IN', 'Hindi'],
  ['ja-JP', 'Japanisch'],
  ['ko-KR', 'Koreanisch'],
  ['zh-CN', 'Chinesisch'],
];
const langName = (code) => LANGS.find((l) => l[0] === code)?.[1] ?? code;
const langShort = (code) => langName(code).replace(/ \(.*\)$/, '');

const MODES = [
  ['smart', 'Lernen', 'Erst Auswahl, dann selbst antworten – wie bei Quizlet'],
  ['write', 'Antworten', 'Antwort einsprechen oder tippen'],
  ['cards', 'Karteikarten', 'Umdrehen und selbst bewerten'],
  ['mc', 'Multiple Choice', 'Aus 4 Antworten wählen'],
];
const DIRECTIONS = [
  ['front', 'A → B'],
  ['back', 'B → A'],
  ['mixed', 'Gemischt'],
];

const $app = document.getElementById('app');
let onKey = null;
let cleanup = null;

document.addEventListener('keydown', (e) => onKey?.(e));

// ---------- Hilfsfunktionen ----------

function esc(s) {
  return String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content;
}

function render(html) {
  $app.replaceChildren(h(html));
  window.scrollTo(0, 0);
}

const $ = (sel, root = $app) => root.querySelector(sel);
const $$ = (sel, root = $app) => [...root.querySelectorAll(sel)];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 2200);
}

function isTyping(e) {
  const t = e.target;
  return t instanceof HTMLElement && (t.matches('input, textarea, select') || t.isContentEditable);
}

function langOptions(selected) {
  return LANGS.map(
    ([code, name]) =>
      `<option value="${code}" ${code === selected ? 'selected' : ''}>${esc(name)}</option>`,
  ).join('');
}

function speakBtn(text, lang, extra = '') {
  if (!speech.canSpeak) return '';
  return `<button type="button" class="icon-btn speak ${extra}" data-say="${esc(text)}" data-lang="${esc(lang)}" title="Vorlesen" aria-label="Vorlesen">🔊</button>`;
}

// Vorlese-Buttons global behandeln
$app.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-say]');
  if (btn) {
    e.preventDefault();
    e.stopPropagation();
    speech.speak(btn.dataset.say, btn.dataset.lang);
  }
});

function deckStats(cards, now = Date.now()) {
  const levels = [0, 0, 0, 0];
  let due = 0;
  let fresh = 0;
  for (const c of cards) {
    levels[srs.mastery(c.srs)]++;
    if (c.srs.state === 'new') fresh++;
    else if (c.srs.due <= now) due++;
  }
  const learnable = due + Math.min(fresh, store.settings().newPerSession);
  return { levels, due, fresh, learnable, total: cards.length };
}

function masteryBar(levels, total) {
  if (!total) return '<div class="mastery-bar empty"></div>';
  return `<div class="mastery-bar" title="${levels
    .map((n, i) => `${srs.MASTERY_LABELS[i]}: ${n}`)
    .join(' · ')}">${levels
    .map((n, i) => (n ? `<span class="lvl${i}" style="flex:${n}"></span>` : ''))
    .join('')}</div>`;
}

function masteryLegend(levels) {
  return `<div class="legend">${levels
    .map(
      (n, i) => `<span><i class="dot lvl${i}"></i>${srs.MASTERY_LABELS[i]} <b>${n}</b></span>`,
    )
    .join('')}</div>`;
}

function relativeDue(ts) {
  const diff = ts - Date.now();
  if (diff <= 0) return 'jetzt fällig';
  return 'in ' + srs.formatInterval(diff);
}

function speechWarning() {
  if (speech.canListen) return '';
  return `<div class="notice">🎤 Dein Browser unterstützt keine Spracheingabe. Nutze <b>Chrome</b>, <b>Edge</b> oder <b>Safari</b> – oder tippe die Vokabeln einfach ein.</div>`;
}

// ---------- Router ----------

function route() {
  speech.cancel();
  if (speech.canSpeak) speechSynthesis.cancel();
  onKey = null;
  cleanup?.();
  cleanup = null;

  const [path, query = ''] = location.hash.replace(/^#/, '').split('?');
  const params = new URLSearchParams(query);
  const parts = path.split('/').filter(Boolean);

  if (parts.length === 0) return viewHome();
  if (parts[0] === 'neu') return viewDeckForm(null);
  if (parts[0] === 'einstellungen') return viewSettings();
  if (parts[0] === 'stapel' && parts[1]) {
    const deck = store.getDeck(parts[1]);
    if (!deck) return go('#/');
    if (!parts[2]) return viewDeck(deck);
    if (parts[2] === 'bearbeiten') return viewDeckForm(deck);
    if (parts[2] === 'hinzufuegen') return viewAdd(deck);
    if (parts[2] === 'lernen') return viewLearn(deck, params);
  }
  go('#/');
}

function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

// ---------- Startseite ----------

function viewHome() {
  const decks = store.decks();
  const now = Date.now();
  let totalDue = 0;

  const list = decks
    .map((d) => {
      const st = deckStats(store.cardsOf(d.id), now);
      totalDue += st.due;
      return `
      <a class="deck-tile" href="#/stapel/${d.id}">
        <div class="deck-tile-head">
          <h3>${esc(d.name)}</h3>
          ${st.learnable ? `<span class="badge">${st.learnable}</span>` : '<span class="badge done">✓</span>'}
        </div>
        <div class="muted small">${esc(langShort(d.langFront))} → ${esc(langShort(d.langBack))} · ${st.total} Vokabeln</div>
        ${masteryBar(st.levels, st.total)}
      </a>`;
    })
    .join('');

  render(`
    <header class="top">
      <h1>🗣️ Vokabeltrainer</h1>
      <a class="icon-btn" href="#/einstellungen" title="Einstellungen" aria-label="Einstellungen">⚙️</a>
    </header>
    ${speechWarning()}
    ${
      decks.length
        ? `<div class="stats-row">
            <div class="stat"><b>${totalDue}</b><span>fällig</span></div>
            <div class="stat"><b>${store.reviewedToday()}</b><span>heute geübt</span></div>
            <div class="stat"><b>${store.streak()}</b><span>Tage in Folge 🔥</span></div>
          </div>
          <div class="deck-list">${list}</div>`
        : `<div class="empty">
            <div class="big-emoji">🎤📚</div>
            <h2>Willkommen!</h2>
            <p>Lege einen Stapel an, sprich deine Vokabeln einfach ein und lerne sie.
            Die App merkt sich, was du gut kannst und was nicht: Schwierige Wörter kommen öfter dran,
            gut gelernte immer seltener.</p>
          </div>`
    }
    <a class="btn primary block" href="#/neu">＋ Neuer Stapel</a>
  `);
}

// ---------- Stapel anlegen / bearbeiten ----------

function viewDeckForm(deck) {
  const isNew = !deck;
  const lastPair = store.decks().at(-1);
  const front = deck?.langFront ?? lastPair?.langFront ?? 'de-DE';
  const back = deck?.langBack ?? lastPair?.langBack ?? 'en-GB';

  render(`
    <header class="top">
      <a class="icon-btn" href="${isNew ? '#/' : `#/stapel/${deck.id}`}" aria-label="Zurück">←</a>
      <h1>${isNew ? 'Neuer Stapel' : 'Stapel bearbeiten'}</h1>
      <span></span>
    </header>
    <form id="deck-form" class="card form">
      <label>Name
        <input name="name" required maxlength="80" placeholder="z. B. Englisch Unit 3" value="${esc(deck?.name ?? '')}">
      </label>
      <div class="two">
        <label>Sprache A (Wort)
          <select name="langFront">${langOptions(front)}</select>
        </label>
        <label>Sprache B (Übersetzung)
          <select name="langBack">${langOptions(back)}</select>
        </label>
      </div>
      <p class="muted small">Die Sprachen werden für die Spracherkennung und das Vorlesen benutzt.</p>
      <button class="btn primary block">${isNew ? 'Anlegen & Vokabeln einsprechen' : 'Speichern'}</button>
    </form>
  `);

  const form = $('#deck-form');
  if (isNew) form.name.focus();
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const values = {
      name: form.name.value.trim(),
      langFront: form.langFront.value,
      langBack: form.langBack.value,
    };
    if (!values.name) return;
    if (isNew) {
      const d = store.addDeck(values);
      go(`#/stapel/${d.id}/hinzufuegen`);
    } else {
      store.updateDeck(deck.id, values);
      go(`#/stapel/${deck.id}`);
    }
  });
}

// ---------- Stapel-Übersicht ----------

function viewDeck(deck) {
  const cards = store.cardsOf(deck.id);
  const st = deckStats(cards);
  const s = store.settings();
  const next = srs.nextDue(cards);

  const rows = [...cards]
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((c) => {
      const lvl = srs.mastery(c.srs);
      return `
      <li class="vocab" data-id="${c.id}" data-search="${esc(normalize(c.front + ' ' + c.back, { stripArticles: false }))}">
        <i class="dot lvl${lvl}" title="${srs.MASTERY_LABELS[lvl]}"></i>
        <div class="vocab-text">
          <div class="vocab-front">${esc(c.front)} ${speakBtn(c.front, deck.langFront, 'small')}</div>
          <div class="vocab-back">${esc(c.back)} ${speakBtn(c.back, deck.langBack, 'small')}</div>
        </div>
        <div class="vocab-meta muted small">${c.srs.state === 'new' ? 'neu' : relativeDue(c.srs.due)}</div>
        <button class="icon-btn small" data-edit="${c.id}" title="Bearbeiten" aria-label="Bearbeiten">✏️</button>
      </li>`;
    })
    .join('');

  render(`
    <header class="top">
      <a class="icon-btn" href="#/" aria-label="Zurück">←</a>
      <h1>${esc(deck.name)}</h1>
      <a class="icon-btn" href="#/stapel/${deck.id}/bearbeiten" title="Stapel bearbeiten" aria-label="Stapel bearbeiten">⚙️</a>
    </header>
    <div class="muted center">${esc(langName(deck.langFront))} → ${esc(langName(deck.langBack))}</div>

    <section class="card">
      ${masteryBar(st.levels, st.total)}
      ${masteryLegend(st.levels)}
    </section>

    ${
      cards.length
        ? `<section class="card learn-setup">
        <div class="seg" role="radiogroup" aria-label="Lernmodus">
          ${MODES.map(
            ([id, label, desc]) =>
              `<button type="button" class="${s.mode === id ? 'active' : ''}" data-mode="${id}" title="${esc(desc)}">${label}</button>`,
          ).join('')}
        </div>
        <p class="muted small center" id="mode-desc">${esc(MODES.find((m) => m[0] === s.mode)?.[2] ?? '')}</p>
        <div class="seg small" role="radiogroup" aria-label="Richtung">
          ${DIRECTIONS.map(
            ([id, label]) =>
              `<button type="button" class="${s.direction === id ? 'active' : ''}" data-dir="${id}">${label
                .replace('A', esc(langShort(deck.langFront)))
                .replace('B', esc(langShort(deck.langBack)))}</button>`,
          ).join('')}
        </div>
        ${
          st.learnable
            ? `<a class="btn primary block big" href="#/stapel/${deck.id}/lernen">▶ Lernen <span class="pill">${st.learnable}</span></a>`
            : `<div class="all-done">✅ Alles gelernt! ${next ? `Nächste Wiederholung ${relativeDue(next)}.` : ''}</div>`
        }
        <a class="btn block" href="#/stapel/${deck.id}/lernen?alle=1">🔁 Alle üben (schwächste zuerst)</a>
      </section>`
        : ''
    }

    <a class="btn ${cards.length ? '' : 'primary'} block" href="#/stapel/${deck.id}/hinzufuegen">🎤 Vokabeln einsprechen</a>

    ${
      cards.length
        ? `<section class="vocab-section">
        <div class="vocab-head">
          <h2>${cards.length} Vokabeln</h2>
          <input type="search" id="filter" placeholder="Suchen…" aria-label="Vokabeln durchsuchen">
        </div>
        <ul class="vocab-list">${rows}</ul>
      </section>`
        : `<p class="muted center">Noch keine Vokabeln in diesem Stapel.</p>`
    }
  `);

  $$('[data-mode]').forEach((b) =>
    b.addEventListener('click', () => {
      store.updateSettings({ mode: b.dataset.mode });
      $$('[data-mode]').forEach((x) => x.classList.toggle('active', x === b));
      $('#mode-desc').textContent = MODES.find((m) => m[0] === b.dataset.mode)[2];
    }),
  );
  $$('[data-dir]').forEach((b) =>
    b.addEventListener('click', () => {
      store.updateSettings({ direction: b.dataset.dir });
      $$('[data-dir]').forEach((x) => x.classList.toggle('active', x === b));
    }),
  );
  $('#filter')?.addEventListener('input', (e) => {
    const q = normalize(e.target.value, { stripArticles: false });
    $$('.vocab').forEach((li) => {
      li.hidden = q && !li.dataset.search.includes(q);
    });
  });
  $$('[data-edit]').forEach((b) =>
    b.addEventListener('click', () => editCardDialog(deck, store.getCard(b.dataset.edit))),
  );
}

// ---------- Karte bearbeiten (Dialog) ----------

function editCardDialog(deck, card) {
  const dlg = document.createElement('dialog');
  dlg.className = 'dialog';
  dlg.innerHTML = `
    <form method="dialog" class="form">
      <h2>Vokabel bearbeiten</h2>
      ${micField('front', deck.langFront, card.front)}
      ${micField('back', deck.langBack, card.back)}
      <p class="muted small">Lernstand: ${srs.MASTERY_LABELS[srs.mastery(card.srs)]}${
        card.srs.state !== 'new' ? ` · nächste Abfrage ${relativeDue(card.srs.due)}` : ''
      }${card.srs.lapses ? ` · ${card.srs.lapses}× vergessen` : ''}</p>
      <div class="row">
        <button type="button" class="btn danger" data-act="delete">Löschen</button>
        <button type="button" class="btn" data-act="reset">Lernstand zurücksetzen</button>
      </div>
      <div class="row">
        <button type="button" class="btn" data-act="cancel">Abbrechen</button>
        <button class="btn primary" data-act="save">Speichern</button>
      </div>
    </form>`;
  document.body.append(dlg);
  bindMicFields(dlg, deck);
  dlg.showModal();

  const close = () => {
    speech.cancel();
    dlg.close();
    dlg.remove();
  };
  dlg.addEventListener('cancel', () => setTimeout(() => dlg.remove(), 0));
  dlg.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const front = dlg.querySelector('[name=front]').value.trim();
    const back = dlg.querySelector('[name=back]').value.trim();
    if (!front || !back) return;
    store.updateCard(card.id, { front, back });
    close();
    route();
  });
  dlg.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'cancel') close();
    if (act === 'delete' && confirm(`„${card.front}“ wirklich löschen?`)) {
      store.deleteCard(card.id);
      close();
      route();
    }
    if (act === 'reset' && confirm('Lernstand dieser Vokabel zurücksetzen?')) {
      store.resetCard(card.id);
      close();
      route();
    }
  });
}

// ---------- Eingabefeld mit Mikrofon ----------

function micField(side, lang, value = '') {
  return `
    <div class="mic-field" data-side="${side}">
      <label for="f-${side}">${esc(langName(lang))}</label>
      <div class="input-row">
        <input id="f-${side}" name="${side}" autocomplete="off" value="${esc(value)}" placeholder="${
          side === 'front' ? 'Wort' : 'Übersetzung'
        }" lang="${esc(lang.split('-')[0])}">
        ${
          speech.canListen
            ? `<button type="button" class="mic" data-mic="${side}" title="Einsprechen" aria-label="${esc(
                langName(lang),
              )} einsprechen">🎤</button>`
            : ''
        }
      </div>
      <div class="alts" data-alts="${side}"></div>
    </div>`;
}

/**
 * Hört auf ein Feld und trägt das Ergebnis ein.
 * Gibt die erkannten Varianten zurück (leer = nichts verstanden).
 */
async function listenInto(root, side, lang, statusEl) {
  const input = root.querySelector(`[name=${side}]`);
  const btn = root.querySelector(`[data-mic=${side}]`);
  const altsEl = root.querySelector(`[data-alts=${side}]`);
  const before = input.value;
  $$('.mic.listening', document).forEach((b) => b.classList.remove('listening'));
  btn?.classList.add('listening');
  input.classList.add('listening');
  if (statusEl) statusEl.textContent = `Sprich jetzt auf ${langShort(lang)} …`;
  try {
    const alts = await speech.listen(lang, {
      onInterim: (t) => {
        input.value = t;
      },
    });
    if (alts.length) {
      input.value = alts[0];
      altsEl.innerHTML = alts
        .slice(1, 4)
        .map((a) => `<button type="button" class="chip" data-alt="${esc(a)}">${esc(a)}</button>`)
        .join('');
      if (statusEl) statusEl.textContent = '';
    } else {
      input.value = before;
      if (statusEl) statusEl.textContent = 'Nichts verstanden – tippe auf 🎤 und versuch es nochmal.';
    }
    return alts;
  } catch (err) {
    input.value = before;
    if (statusEl) statusEl.textContent = speech.errorMessage(err);
    else toast(speech.errorMessage(err));
    return null;
  } finally {
    btn?.classList.remove('listening');
    input.classList.remove('listening');
  }
}

function bindMicFields(root, deck, { statusEl, chain = false } = {}) {
  root.querySelectorAll('[data-mic]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      if (btn.classList.contains('listening')) {
        speech.stop();
        return;
      }
      const side = btn.dataset.mic;
      const lang = side === 'front' ? deck.langFront : deck.langBack;
      const alts = await listenInto(root, side, lang, statusEl);
      // Nach dem Wort direkt die Übersetzung abfragen
      if (chain && alts?.length && side === 'front' && !root.querySelector('[name=back]').value) {
        root.querySelector('[data-mic=back]')?.click();
      }
    }),
  );
  root.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-alt]');
    if (!chip) return;
    const field = chip.closest('.mic-field');
    const input = field.querySelector('input');
    const old = input.value;
    input.value = chip.dataset.alt;
    chip.dataset.alt = old;
    chip.textContent = old;
  });
}

// ---------- Vokabeln hinzufügen ----------

function viewAdd(deck) {
  let dictating = false;
  const added = [];

  render(`
    <header class="top">
      <a class="icon-btn" href="#/stapel/${deck.id}" aria-label="Zurück">←</a>
      <h1>Vokabeln einsprechen</h1>
      <span></span>
    </header>
    ${speechWarning()}
    <form id="add-form" class="card form">
      ${micField('front', deck.langFront)}
      ${micField('back', deck.langBack)}
      <div class="status" id="status" aria-live="polite"></div>
      <button class="btn primary block">Speichern ↵</button>
    </form>

    ${
      speech.canListen
        ? `<section class="card dictate">
        <button type="button" class="btn block big" id="dictate">🎙️ Diktiermodus starten</button>
        <p class="muted small">Freihändig: Sag erst das Wort auf ${esc(langShort(deck.langFront))},
        dann die Übersetzung auf ${esc(langShort(deck.langBack))}. Die Vokabel wird automatisch gespeichert
        und es geht direkt mit der nächsten weiter. Sag <b>„Stopp“</b> oder tippe auf den Button zum Beenden.</p>
      </section>`
        : ''
    }

    <details class="card">
      <summary>📋 Liste einfügen</summary>
      <p class="muted small">Eine Vokabel pro Zeile, getrennt durch <code>=</code>, <code>-</code>, <code>;</code> oder Tab.<br>z. B. <code>Hund = dog</code></p>
      <textarea id="bulk" rows="6" placeholder="Hund = dog&#10;Katze = cat"></textarea>
      <button type="button" class="btn block" id="bulk-add">Alle hinzufügen</button>
    </details>

    <section id="added-section" hidden>
      <h2>Gerade hinzugefügt</h2>
      <ul class="vocab-list" id="added"></ul>
    </section>

    <a class="btn primary block" id="done" href="#/stapel/${deck.id}">Fertig</a>
  `);

  const form = $('#add-form');
  const status = $('#status');
  const front = form.front;
  const back = form.back;
  const existing = new Set(store.cardsOf(deck.id).map((c) => normalize(c.front)));

  bindMicFields(form, deck, { statusEl: status, chain: true });
  front.focus();

  function addOne(f, b) {
    const card = store.addCard(deck.id, f, b);
    existing.add(normalize(f));
    added.unshift(card);
    renderAdded();
    return card;
  }

  function renderAdded() {
    $('#added-section').hidden = !added.length;
    $('#added').innerHTML = added
      .map(
        (c) => `
      <li class="vocab" data-id="${c.id}">
        <div class="vocab-text">
          <div class="vocab-front">${esc(c.front)}</div>
          <div class="vocab-back">${esc(c.back)}</div>
        </div>
        <button class="icon-btn small" data-undo="${c.id}" title="Entfernen" aria-label="Entfernen">✕</button>
      </li>`,
      )
      .join('');
  }

  $('#added').addEventListener('click', (e) => {
    const id = e.target.closest('[data-undo]')?.dataset.undo;
    if (!id) return;
    store.deleteCard(id);
    const i = added.findIndex((c) => c.id === id);
    if (i >= 0) added.splice(i, 1);
    renderAdded();
  });

  function clearFields() {
    front.value = '';
    back.value = '';
    $$('.alts').forEach((a) => (a.innerHTML = ''));
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = front.value.trim();
    const b = back.value.trim();
    if (!f) return front.focus();
    if (!b) return back.focus();
    if (existing.has(normalize(f)) && !confirm(`„${f}“ ist schon im Stapel. Trotzdem hinzufügen?`)) return;
    addOne(f, b);
    clearFields();
    status.textContent = `✓ „${f}“ gespeichert`;
    front.focus();
  });

  // Enter im ersten Feld springt ins zweite
  front.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !back.value.trim()) {
      e.preventDefault();
      back.focus();
    }
  });

  // --- Diktiermodus ---
  const dictateBtn = $('#dictate');
  const STOP_WORDS = ['stopp', 'stop', 'fertig', 'ende', 'beenden', 'finish', 'done'];
  const isStop = (alts) => alts?.some((a) => STOP_WORDS.includes(normalize(a)));

  async function dictate() {
    dictating = true;
    dictateBtn.textContent = '⏹ Diktiermodus beenden';
    dictateBtn.classList.add('danger');
    let misses = 0;
    while (dictating) {
      clearFields();
      const a = await listenInto(form, 'front', deck.langFront, status);
      if (!dictating) break;
      if (a === null || isStop(a)) break;
      if (!a.length) {
        if (++misses >= 3) break;
        continue;
      }
      misses = 0;
      const b = await listenInto(form, 'back', deck.langBack, status);
      if (!dictating) break;
      if (b === null || isStop(b)) break;
      if (!b.length) {
        status.textContent = 'Übersetzung nicht verstanden – nochmal von vorn.';
        continue;
      }
      const card = addOne(front.value.trim(), back.value.trim());
      status.textContent = `✓ „${card.front}“ = „${card.back}“ gespeichert`;
      await new Promise((r) => setTimeout(r, 600));
    }
    stopDictation();
  }

  function stopDictation() {
    if (dictating) speech.cancel();
    dictating = false;
    if (!dictateBtn?.isConnected) return;
    dictateBtn.textContent = '🎙️ Diktiermodus starten';
    dictateBtn.classList.remove('danger');
    if (!status.textContent.startsWith('✓')) status.textContent = '';
  }

  dictateBtn?.addEventListener('click', () => (dictating ? stopDictation() : dictate()));
  cleanup = () => {
    dictating = false;
  };

  // --- Liste einfügen ---
  $('#bulk-add').addEventListener('click', () => {
    const lines = $('#bulk').value.split('\n');
    let n = 0;
    const skipped = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      const m = line.match(/^(.+?)\s*(?:\t|=|;| - | – |:)\s*(.+)$/);
      if (!m) {
        skipped.push(line.trim());
        continue;
      }
      addOne(m[1].trim(), m[2].trim());
      n++;
    }
    $('#bulk').value = skipped.join('\n');
    toast(`${n} Vokabeln hinzugefügt${skipped.length ? ` · ${skipped.length} Zeilen nicht erkannt` : ''}`);
  });
}

// ---------- Lernen ----------

function viewLearn(deck, params) {
  const practice = params.get('alle') === '1';
  const s = store.settings();
  const allCards = store.cardsOf(deck.id);
  const now = Date.now();

  const initial = practice
    ? srs.weakestFirst(allCards)
    : srs.dueQueue(allCards, now, s.newPerSession);

  if (!initial.length) {
    const next = srs.nextDue(allCards);
    render(`
      <header class="top">
        <a class="icon-btn" href="#/stapel/${deck.id}" aria-label="Zurück">←</a>
        <h1>${esc(deck.name)}</h1><span></span>
      </header>
      <div class="empty">
        <div class="big-emoji">🎉</div>
        <h2>Nichts mehr fällig!</h2>
        <p>${next ? `Die nächste Wiederholung ist ${relativeDue(next)}.` : 'Füge zuerst ein paar Vokabeln hinzu.'}</p>
      </div>
      ${allCards.length ? `<a class="btn primary block" href="#/stapel/${deck.id}/lernen?alle=1">🔁 Trotzdem alle üben</a>` : ''}
      <a class="btn block" href="#/stapel/${deck.id}">Zurück zum Stapel</a>
    `);
    return;
  }

  runSession(
    deck,
    initial.map((c) => c.id),
    practice,
  );
}

function runSession(deck, ids, practice) {
  const s = store.settings();
  const session = new srs.Session(ids);
  const deckSize = store.cardsOf(deck.id).length;
  let alive = true;
  let autoNextTimer = null;

  cleanup = () => {
    alive = false;
    clearTimeout(autoNextTimer);
  };

  render(`
    <div class="learn">
      <header class="learn-top">
        <a class="icon-btn" href="#/stapel/${deck.id}" aria-label="Beenden">✕</a>
        <div class="progress"><div class="progress-fill" id="progress"></div></div>
        <span class="muted small" id="counter"></span>
      </header>
      <main id="stage" class="stage"></main>
    </div>
  `);
  const stage = $('#stage');

  function modeFor(card) {
    const canMC = deckSize >= 4;
    if (s.mode === 'mc') return canMC ? 'mc' : 'cards';
    if (s.mode === 'smart') {
      const unsure = card.srs.state === 'new' || (card.srs.state === 'learning' && card.srs.streak === 0);
      return canMC && unsure ? 'mc' : 'write';
    }
    return s.mode;
  }

  function directionFor() {
    if (s.direction === 'mixed') return Math.random() < 0.5 ? 'front' : 'back';
    return s.direction;
  }

  function updateProgress() {
    $('#progress').style.width = `${Math.round(session.progress * 100)}%`;
    $('#counter').textContent = `${session.finished.size}/${session.total}`;
  }

  /** Bewertung anwenden und zur nächsten Karte. */
  function grade(card, rating) {
    clearTimeout(autoNextTimer);
    const now = Date.now();
    // Beim freien Üben werden nicht-fällige Karten nur bei Fehlern zurückgestuft
    const scheduled = !practice || card.srs.state !== 'review' || card.srs.due <= now;
    if (scheduled || rating === RATING.AGAIN) {
      card.srs = srs.review(card.srs, rating, now);
      store.save();
    }
    store.logReview();
    const stillLearning = card.srs.state === 'learning' && card.srs.due <= now + 20 * srs.MINUTE;
    const requeue = rating === RATING.AGAIN || (scheduled && stillLearning);
    session.next(rating !== RATING.AGAIN, requeue, rating === RATING.AGAIN ? 3 : Infinity);
    showNext();
  }

  function showNext() {
    if (!alive) return;
    speech.cancel();
    updateProgress();
    if (session.done) return showResults();
    const card = store.getCard(session.current);
    if (!card) {
      session.next(true, false);
      return showNext();
    }
    const dir = directionFor();
    const q = {
      card,
      prompt: dir === 'front' ? card.front : card.back,
      answer: dir === 'front' ? card.back : card.front,
      promptLang: dir === 'front' ? deck.langFront : deck.langBack,
      answerLang: dir === 'front' ? deck.langBack : deck.langFront,
      answerField: dir === 'front' ? 'back' : 'front',
    };
    const mode = modeFor(card);
    stage.innerHTML = `
      <div class="question">
        <div class="muted small">${esc(langShort(q.promptLang))} → ${esc(langShort(q.answerLang))}${
          card.srs.state === 'new' ? ' · <span class="tag">neu</span>' : ''
        }${session.mistakes.has(card.id) ? ' · <span class="tag warn">nochmal</span>' : ''}</div>
        <div class="prompt">${esc(q.prompt)}</div>
        ${speakBtn(q.prompt, q.promptLang)}
      </div>
      <div class="answer-zone" id="zone"></div>`;
    const zone = $('#zone', stage);
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();

    const speakFirst = s.autoSpeak ? speech.speak(q.prompt, q.promptLang) : Promise.resolve();
    if (mode === 'cards') showFlashcard(q, zone);
    else if (mode === 'mc') showMC(q, zone);
    else showWrite(q, zone, speakFirst);
  }

  // --- Karteikarte ---
  function showFlashcard(q, zone) {
    zone.innerHTML = `<button class="btn primary block big" id="flip">Antwort zeigen <kbd>Leertaste</kbd></button>`;
    const flip = () => {
      const times = srs.preview(q.card.srs).map(srs.formatInterval);
      zone.innerHTML = `
        <div class="solution">${esc(q.answer)} ${speakBtn(q.answer, q.answerLang)}</div>
        <p class="muted small center">Wie gut wusstest du es?</p>
        <div class="ratings">
          ${srs.RATING_LABELS.map(
            (label, r) => `
            <button class="btn rate r${r}" data-rate="${r}">
              <b>${label}</b><span>${times[r]}</span><kbd>${r + 1}</kbd>
            </button>`,
          ).join('')}
        </div>`;
      $$('[data-rate]', zone).forEach((b) =>
        b.addEventListener('click', () => grade(q.card, Number(b.dataset.rate))),
      );
      if (s.autoSpeak) speech.speak(q.answer, q.answerLang);
      onKey = (e) => {
        if (isTyping(e)) return;
        if (['1', '2', '3', '4'].includes(e.key)) grade(q.card, Number(e.key) - 1);
      };
    };
    $('#flip', zone).addEventListener('click', flip);
    onKey = (e) => {
      if (isTyping(e)) return;
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        flip();
      }
    };
  }

  // --- Multiple Choice ---
  function showMC(q, zone) {
    const field = q.answerField;
    const seen = new Set([normalize(q.answer)]);
    const distractors = [];
    for (const c of shuffle(store.cardsOf(deck.id))) {
      const n = normalize(c[field]);
      if (seen.has(n)) continue;
      seen.add(n);
      distractors.push(c[field]);
      if (distractors.length === 3) break;
    }
    const options = shuffle([q.answer, ...distractors]);
    zone.innerHTML = `
      <div class="options">
        ${options
          .map(
            (o, i) =>
              `<button class="btn option" data-i="${i}"><kbd>${i + 1}</kbd><span>${esc(o)}</span></button>`,
          )
          .join('')}
      </div>
      <button class="link-btn" id="dunno">Weiß ich nicht</button>`;

    let answered = false;
    const choose = (i) => {
      if (answered) return;
      answered = true;
      const correct = i >= 0 && options[i] === q.answer;
      $$('.option', zone).forEach((b, j) => {
        b.disabled = true;
        if (options[j] === q.answer) b.classList.add('correct');
        else if (j === i) b.classList.add('wrong');
      });
      $('#dunno', zone).remove();
      // Im Lern-Modus zählt eine richtige Auswahl erst als halber Schritt:
      // danach musst du die Antwort noch selbst wissen.
      const rating = correct ? (s.mode === 'smart' ? RATING.HARD : RATING.GOOD) : RATING.AGAIN;
      if (correct) {
        if (s.autoSpeak) speech.speak(q.answer, q.answerLang);
        autoNextTimer = setTimeout(() => grade(q.card, rating), 900);
        onKey = null;
      } else {
        zone.insertAdjacentHTML(
          'beforeend',
          `<div class="feedback wrong">Richtig ist: <b>${esc(q.answer)}</b> ${speakBtn(q.answer, q.answerLang)}</div>
           <button class="btn primary block" id="next">Weiter ↵</button>`,
        );
        $('#next', zone).addEventListener('click', () => grade(q.card, rating));
        onKey = (e) => {
          if (e.key === 'Enter' && !isTyping(e)) {
            e.preventDefault();
            grade(q.card, rating);
          }
        };
      }
    };
    $$('.option', zone).forEach((b) => b.addEventListener('click', () => choose(Number(b.dataset.i))));
    $('#dunno', zone).addEventListener('click', () => choose(-1));
    onKey = (e) => {
      if (isTyping(e)) return;
      const n = Number(e.key);
      if (n >= 1 && n <= options.length) choose(n - 1);
    };
  }

  // --- Antworten (sprechen oder tippen) ---
  function showWrite(q, zone, speakFirst) {
    zone.innerHTML = `
      <form id="answer-form" class="answer-form">
        <div class="input-row">
          <input id="answer" name="answer" autocomplete="off" autocapitalize="off" spellcheck="false"
            placeholder="Antwort auf ${esc(langShort(q.answerLang))}" lang="${esc(q.answerLang.split('-')[0])}">
          ${speech.canListen ? '<button type="button" class="mic big" id="mic" aria-label="Antwort einsprechen">🎤</button>' : ''}
        </div>
        <div class="status" id="lstatus" aria-live="polite"></div>
        <div class="row">
          <button type="button" class="btn" id="dunno">Weiß ich nicht</button>
          <button class="btn primary">Prüfen ↵</button>
        </div>
      </form>`;
    const form = $('#answer-form', zone);
    const input = form.answer;
    const mic = $('#mic', zone);
    const lstatus = $('#lstatus', zone);

    if (!s.autoListen || !speech.canListen) input.focus();

    async function listenAnswer() {
      if (mic.classList.contains('listening')) {
        speech.stop();
        return;
      }
      mic.classList.add('listening');
      input.classList.add('listening');
      lstatus.textContent = `Sprich die Antwort auf ${langShort(q.answerLang)} …`;
      try {
        const alts = await speech.listen(q.answerLang, {
          onInterim: (t) => (input.value = t),
        });
        if (!form.isConnected) return;
        if (!alts.length) {
          input.value = '';
          lstatus.textContent = 'Nichts verstanden – nochmal auf 🎤 tippen oder eintippen.';
          return;
        }
        const best = checkBest(alts, q.answer);
        input.value = best.text;
        lstatus.textContent = '';
        evaluate(best.text, best.result);
      } catch (err) {
        lstatus.textContent = speech.errorMessage(err);
      } finally {
        mic.classList.remove('listening');
        input.classList.remove('listening');
      }
    }

    mic?.addEventListener('click', listenAnswer);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const given = input.value.trim();
      if (!given) return input.focus();
      evaluate(given, checkAnswer(given, q.answer).result);
    });
    $('#dunno', zone).addEventListener('click', () => evaluate('', 'wrong'));
    onKey = (e) => {
      if (isTyping(e)) return;
      if (e.key === ' ' && mic) {
        e.preventDefault();
        listenAnswer();
      }
    };

    if (s.autoListen && speech.canListen) {
      speakFirst.then(() => {
        if (form.isConnected && alive) listenAnswer();
      });
    }

    function evaluate(given, result) {
      speech.cancel();
      const correct = result !== 'wrong';
      const rating = result === 'correct' ? RATING.GOOD : result === 'close' ? RATING.HARD : RATING.AGAIN;
      const title = {
        correct: '✅ Richtig!',
        close: '🟡 Fast richtig – achte auf die Schreibweise',
        wrong: given ? '❌ Leider falsch' : '📖 Das ist die Lösung',
      }[result];

      zone.innerHTML = `
        <div class="feedback ${correct ? 'right' : 'wrong'}">
          <div class="feedback-title">${title}</div>
          ${given && result !== 'correct' ? `<div class="muted">Deine Antwort: <s>${esc(given)}</s></div>` : ''}
          <div class="solution">${esc(q.answer)} ${speakBtn(q.answer, q.answerLang)}</div>
        </div>
        <div class="row">
          ${
            correct
              ? `<button class="btn" data-rate="${RATING.EASY}">War leicht</button>`
              : given
                ? `<button class="btn" data-rate="${RATING.GOOD}">Ich hatte recht</button>`
                : ''
          }
          <button class="btn primary" id="next" data-rate="${rating}">Weiter ↵</button>
        </div>`;
      // Schutz gegen Doppel-Enter (Prüfen + sofort Weiter)
      const shownAt = Date.now();
      $$('[data-rate]', zone).forEach((b) =>
        b.addEventListener('click', () => {
          if (Date.now() - shownAt > 250) grade(q.card, Number(b.dataset.rate));
        }),
      );
      const next = $('#next', zone);
      next.focus();
      onKey = (e) => {
        if (e.key === 'Enter' && e.target !== next && !isTyping(e)) {
          e.preventDefault();
          grade(q.card, rating);
        }
      };
      if (s.autoSpeak || (s.autoListen && !correct)) speech.speak(q.answer, q.answerLang);
      // Freihändig lernen: bei richtiger Antwort automatisch weiter
      if (s.autoListen && correct) {
        autoNextTimer = setTimeout(() => grade(q.card, rating), s.autoSpeak ? 2000 : 1200);
      }
    }
  }

  // --- Ergebnis ---
  function showResults() {
    onKey = null;
    const pct = session.total ? Math.round((session.firstTryCorrect / session.total) * 100) : 100;
    const mistakes = [...session.mistakes].map((id) => store.getCard(id)).filter(Boolean);
    const cards = store.cardsOf(deck.id);
    const next = srs.nextDue(cards);
    const st = deckStats(cards);
    stage.innerHTML = `
      <div class="results">
        <div class="big-emoji">${pct >= 90 ? '🏆' : pct >= 60 ? '🎉' : '💪'}</div>
        <h2>Runde geschafft!</h2>
        <p><b>${session.total}</b> Vokabeln · <b>${pct}%</b> beim ersten Versuch gewusst</p>
        ${masteryBar(st.levels, st.total)}
        ${masteryLegend(st.levels)}
        ${
          mistakes.length
            ? `<h3>Daran solltest du noch arbeiten</h3>
          <ul class="vocab-list">${mistakes
            .map(
              (c) => `<li class="vocab"><div class="vocab-text"><div class="vocab-front">${esc(
                c.front,
              )}</div><div class="vocab-back">${esc(c.back)}</div></div></li>`,
            )
            .join('')}</ul>
          <button class="btn primary block" id="again">🔁 Diese ${mistakes.length} nochmal üben</button>`
            : ''
        }
        ${next ? `<p class="muted">Nächste Wiederholung ${relativeDue(next)}.</p>` : ''}
        <a class="btn ${mistakes.length ? '' : 'primary'} block" href="#/stapel/${deck.id}">Zurück zum Stapel</a>
      </div>`;
    $('#progress').style.width = '100%';
    $('#again', stage)?.addEventListener('click', () => {
      cleanup?.();
      runSession(
        deck,
        mistakes.map((c) => c.id),
        true,
      );
    });
  }

  showNext();
}

// ---------- Einstellungen ----------

function viewSettings() {
  const s = store.settings();
  render(`
    <header class="top">
      <a class="icon-btn" href="#/" aria-label="Zurück">←</a>
      <h1>Einstellungen</h1><span></span>
    </header>
    <section class="card form">
      <label>Neue Vokabeln pro Lernrunde
        <input type="number" id="newPer" min="0" max="500" value="${s.newPerSession}">
      </label>
      <label class="check"><input type="checkbox" id="autoSpeak" ${s.autoSpeak ? 'checked' : ''} ${
        speech.canSpeak ? '' : 'disabled'
      }> Wörter beim Lernen automatisch vorlesen</label>
      <label class="check"><input type="checkbox" id="autoListen" ${s.autoListen ? 'checked' : ''} ${
        speech.canListen ? '' : 'disabled'
      }> Freihändig lernen: Mikrofon startet automatisch, bei richtiger Antwort geht's allein weiter</label>
    </section>

    <section class="card">
      <h2>So funktioniert das Lernen</h2>
      <p class="small">Jede Vokabel hat einen Lernstand. Wenn du sie weißt, wird der Abstand bis zur
      nächsten Abfrage immer größer (1 Tag → 3 Tage → eine Woche → …). Weißt du sie nicht, kommt sie in
      derselben Runde nach ein paar Karten nochmal dran und fängt wieder mit kurzen Abständen an.
      So übst du die schweren Wörter oft und die leichten nur noch selten.</p>
      <p class="small">Im Modus <b>Lernen</b> wählst du neue Wörter zuerst aus 4 Antworten aus und musst sie
      danach selbst sagen oder schreiben.</p>
    </section>

    <section class="card">
      <h2>Daten</h2>
      <p class="muted small">Alles wird nur auf diesem Gerät gespeichert. Mach ab und zu eine Sicherung.</p>
      <div class="row">
        <button class="btn" id="export">⬇️ Sichern</button>
        <label class="btn file-btn">⬆️ Laden<input type="file" id="import" accept="application/json,.json" hidden></label>
      </div>
      <button class="btn danger block" id="wipe">Alles löschen</button>
    </section>
    <p class="muted small center">
      Spracheingabe: ${speech.canListen ? '✅ verfügbar' : '❌ nicht verfügbar'} ·
      Vorlesen: ${speech.canSpeak ? '✅ verfügbar' : '❌ nicht verfügbar'}
    </p>
  `);

  $('#newPer').addEventListener('change', (e) => {
    const n = Math.max(0, Math.min(500, Math.round(Number(e.target.value) || 0)));
    e.target.value = n;
    store.updateSettings({ newPerSession: n });
  });
  $('#autoSpeak').addEventListener('change', (e) => store.updateSettings({ autoSpeak: e.target.checked }));
  $('#autoListen').addEventListener('change', (e) => store.updateSettings({ autoListen: e.target.checked }));

  $('#export').addEventListener('click', () => {
    const blob = new Blob([store.exportJson()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `vokabeln-${store.dayKey()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('#import').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const { decksAdded, cardsAdded } = store.importJson(await file.text());
      toast(`${decksAdded} Stapel und ${cardsAdded} Vokabeln geladen`);
    } catch (err) {
      toast('Datei konnte nicht geladen werden: ' + err.message);
    }
    e.target.value = '';
  });
  $('#wipe').addEventListener('click', () => {
    if (confirm('Wirklich ALLE Stapel und Vokabeln löschen? Das kann nicht rückgängig gemacht werden.')) {
      store.wipe();
      go('#/');
    }
  });
}

// ---------- Start ----------

store.load();
window.addEventListener('hashchange', route);
route();

navigator.storage?.persist?.().catch(() => {});
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
