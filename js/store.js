// Speicherung aller Daten lokal im Browser (localStorage).

import { newSrs } from './srs.js';

const KEY = 'vokabel-app:v1';

const DEFAULT_SETTINGS = {
  newPerSession: 20,
  autoSpeak: false,
  autoListen: false,
  mode: 'smart',
  direction: 'front',
};

let data = null;

function blank() {
  return { version: 1, decks: [], cards: [], settings: { ...DEFAULT_SETTINGS }, history: {} };
}

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export function load() {
  try {
    data = JSON.parse(localStorage.getItem(KEY)) ?? blank();
  } catch {
    data = blank();
  }
  data.decks ??= [];
  data.cards ??= [];
  data.history ??= {};
  data.settings = { ...DEFAULT_SETTINGS, ...(data.settings ?? {}) };
  return data;
}

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch (e) {
    alert('Speichern fehlgeschlagen: ' + e.message);
  }
}

export const settings = () => data.settings;

export function updateSettings(patch) {
  Object.assign(data.settings, patch);
  save();
}

// ---------- Stapel ----------

export const decks = () => data.decks;
export const getDeck = (id) => data.decks.find((d) => d.id === id);

export function addDeck({ name, langFront, langBack }) {
  const deck = { id: uid(), name, langFront, langBack, createdAt: Date.now() };
  data.decks.push(deck);
  save();
  return deck;
}

export function updateDeck(id, patch) {
  Object.assign(getDeck(id), patch);
  save();
}

export function deleteDeck(id) {
  data.decks = data.decks.filter((d) => d.id !== id);
  data.cards = data.cards.filter((c) => c.deckId !== id);
  save();
}

// ---------- Karten ----------

export const cardsOf = (deckId) => data.cards.filter((c) => c.deckId === deckId);
export const getCard = (id) => data.cards.find((c) => c.id === id);

export function addCard(deckId, front, back) {
  const now = Date.now();
  const card = { id: uid(), deckId, front, back, createdAt: now, srs: newSrs(now) };
  data.cards.push(card);
  save();
  return card;
}

export function updateCard(id, patch) {
  Object.assign(getCard(id), patch);
  save();
}

export function deleteCard(id) {
  data.cards = data.cards.filter((c) => c.id !== id);
  save();
}

export function resetCard(id) {
  getCard(id).srs = newSrs();
  save();
}

// ---------- Statistik ----------

export function dayKey(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function logReview() {
  const k = dayKey();
  data.history[k] = (data.history[k] ?? 0) + 1;
  save();
}

export const reviewedToday = () => data.history[dayKey()] ?? 0;

/** Anzahl Tage in Folge, an denen gelernt wurde (heute oder gestern beginnend). */
export function streak() {
  let n = 0;
  const d = new Date();
  if (!data.history[dayKey(d)]) d.setDate(d.getDate() - 1);
  while (data.history[dayKey(d)]) {
    n += 1;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

// ---------- Import / Export ----------

export function exportJson() {
  return JSON.stringify({ ...data, exportedAt: new Date().toISOString() }, null, 2);
}

export function importJson(text) {
  const incoming = JSON.parse(text);
  if (!Array.isArray(incoming.decks) || !Array.isArray(incoming.cards)) {
    throw new Error('Ungültige Datei');
  }
  const deckIds = new Set(data.decks.map((d) => d.id));
  const cardIds = new Set(data.cards.map((c) => c.id));
  let decksAdded = 0;
  let cardsAdded = 0;
  for (const d of incoming.decks) {
    if (!deckIds.has(d.id)) {
      data.decks.push(d);
      decksAdded++;
    }
  }
  for (const c of incoming.cards) {
    if (!cardIds.has(c.id)) {
      c.srs ??= newSrs();
      data.cards.push(c);
      cardsAdded++;
    }
  }
  for (const [k, v] of Object.entries(incoming.history ?? {})) {
    data.history[k] = Math.max(data.history[k] ?? 0, v);
  }
  save();
  return { decksAdded, cardsAdded };
}

export function wipe() {
  data = blank();
  save();
}
