import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAnswer, checkBest, normalize } from '../js/compare.js';

const r = (given, expected) => checkAnswer(given, expected).result;

test('Groß-/Kleinschreibung und Satzzeichen egal', () => {
  assert.equal(r('Dog', 'dog'), 'correct');
  assert.equal(r('dog.', 'Dog'), 'correct');
  assert.equal(r("  it's  ", 'it is'), 'close');
  assert.equal(r('ice-cream', 'ice cream'), 'correct');
});

test('Artikel werden ignoriert', () => {
  assert.equal(r('Hund', 'der Hund'), 'correct');
  assert.equal(r('the dog', 'dog'), 'correct');
  assert.equal(r('to go', 'go'), 'correct');
  assert.equal(r('la maison', 'maison'), 'correct');
});

test('mehrere erlaubte Antworten', () => {
  assert.equal(r('Gebäude', 'Haus, Gebäude'), 'correct');
  assert.equal(r('big', 'large / big'), 'correct');
  assert.equal(r('Haus, Gebäude', 'Haus, Gebäude'), 'correct');
});

test('Klammern sind optional', () => {
  assert.equal(r('run', 'run (ran, run)'), 'correct');
});

test('kleine Tippfehler und Akzente = fast richtig', () => {
  assert.equal(r('cafe', 'café'), 'close');
  assert.equal(r('Strasse', 'Straße'), 'close');
  assert.equal(r('elephent', 'elephant'), 'close');
  assert.equal(r('cat', 'car'), 'wrong'); // zu kurz für Tippfehler-Toleranz
  assert.equal(r('house', 'mouse'), 'close');
  assert.equal(r('table', 'chair'), 'wrong');
});

test('leere Antwort ist falsch', () => {
  assert.equal(r('', 'dog'), 'wrong');
});

test('checkBest wählt die passende Variante der Spracherkennung', () => {
  const best = checkBest(['the dock', 'the dog', 'that dog'], 'dog');
  assert.equal(best.result, 'correct');
  assert.equal(best.text, 'the dog');
});

test('normalize', () => {
  assert.equal(normalize('  Der  Hund! '), 'hund');
  assert.equal(normalize('Der', {}), 'der');
});
