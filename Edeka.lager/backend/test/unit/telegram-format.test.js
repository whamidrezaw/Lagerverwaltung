'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const { escapeMarkdown, buildTelegramText, splitTelegramText } = require('../../services/telegram');

test('Markdown-Sonderzeichen werden maskiert', () => {
  assert.equal(escapeMarkdown('Bio_Apfel'),  'Bio\\_Apfel');
  assert.equal(escapeMarkdown('*Extra*'),    '\\*Extra\\*');
  assert.equal(escapeMarkdown('A[B]C'),      'A\\[B]C');
  assert.equal(escapeMarkdown('`code`'),     '\\`code\\`');
});

test('null/undefined ergeben einen leeren String, keinen Absturz', () => {
  assert.equal(escapeMarkdown(null), '');
  assert.equal(escapeMarkdown(undefined), '');
});

const product = (over = {}) => ({
  name: 'Apfel', unit: 'kg', category: 'Obst', emoji: '🍎',
  isBio: false, currentStock: 3, yesterdayStock: 5, ...over
});

test('Produktname mit Sonderzeichen wird maskiert', () => {
  const txt = buildTelegramText([product({ name: 'Apfel_Bio' })]);
  assert.match(txt, /Apfel\\_Bio/);
});

test('Verbrauch wird angezeigt, Auffüllen ergibt keine negative Zahl', () => {
  assert.match(buildTelegramText([product({ currentStock: 3, yesterdayStock: 5 })]), /\(−2\)/);
  const refill = buildTelegramText([product({ currentStock: 9, yesterdayStock: 5 })]);
  assert.doesNotMatch(refill, /−/);
});

// ── ROT: Fehler, der in Batch A behoben wird ─────────────────────────
// Jedes Feld im Telegram-Text läuft durch escapeMarkdown() — außer `emoji`.
// Ein einzelnes "*" dort erzeugt eine ungerade Zahl an Sternchen, woraufhin
// Telegram die GESAMTE Nachricht mit einem Parse-Fehler ablehnt, nicht nur
// diese eine Zeile.
test('Emoji-Feld wird ebenfalls maskiert', () => {
  const txt = buildTelegramText([product({ emoji: '*' })]);
  const stars = (txt.match(/(?<!\\)\*/g) || []).length;
  assert.equal(stars % 2, 0, `ungerade Anzahl unmaskierter "*" (${stars}) — Telegram lehnt die Nachricht ab`);
});

test('buildTelegramText mit liveOnly:true blendet Verbrauch aus und zeigt nur Aktueller Bestand (Phase M)', () => {
  const txt = buildTelegramText([
    product({ name: 'Banane', currentStock: 7, yesterdayStock: 12, updatedByName: 'Anna' }),
    product({ name: 'Birne', currentStock: 4, yesterdayStock: 4, updatedByName: null })
  ], { liveOnly: true });
  assert.doesNotMatch(txt, /Verbrauch/);
  assert.doesNotMatch(txt, /−5/);
  assert.doesNotMatch(txt, /null|undefined/);
  assert.match(txt, /\*7\*/);
  assert.match(txt, /\(Anna\)/);
});

test('BUG-003: buildTelegramText formatiert Datum und Uhrzeit in Europe/Berlin', () => {
  // 2026-07-15 22:30:00 UTC -> 16. Juli 2026, 00:30:00 MESZ
  const txt = buildTelegramText([product()], { now: new Date('2026-07-15T22:30:00.000Z') });
  assert.match(txt, /16\.\s*Juli\s*2026/);
  assert.match(txt, /00:30:00/);
});

test('BUG-003: splitTelegramText zerlegt lange Berichte sauber an Zeilenumbrüchen (<= 4000 Zeichen)', () => {
  assert.deepEqual(splitTelegramText('kurz', 4000), ['kurz']);

  const products = Array.from({ length: 140 }, (_, i) =>
    product({ name: `Bio_Produkt_${i + 1}`, category: `Kategorie_${i % 5}`, currentStock: i + 1 })
  );
  const full = buildTelegramText(products, { liveOnly: true });
  assert.ok(full.length > 4096, `Erwartet > 4096 Zeichen, erhalten ${full.length}`);

  const chunks = splitTelegramText(full, 4000);
  assert.ok(chunks.length >= 2);
  for (const c of chunks) {
    assert.ok(c.length <= 4000, `Chunk zu lang: ${c.length}`);
    const stars = (c.match(/(?<!\\)\*/g) || []).length;
    assert.equal(stars % 2, 0, 'Markdown-* darf beim Teilen nicht zerrissen werden');
  }
  assert.equal(chunks.join('\n'), full);

  // Fallback bei überlanger Einzelzeile ohne Zeilenumbruch
  const longLine = 'a'.repeat(4005);
  const parts = splitTelegramText(longLine, 4000);
  assert.equal(parts.length, 2);
  assert.equal(parts[0].length, 4000);
  assert.equal(parts[1].length, 5);
});
