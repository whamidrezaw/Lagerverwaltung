'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const { normalizeFromLiveProducts, normalizeFromSnapshot, buildExcelWorkbook, buildPdfBuffer } = require('../../services/exportBuilder');

// Beide Funktionen speisen dieselben Excel-/PDF-Bauer. Weichen ihre
// Zeilenformen voneinander ab, sieht ein Live-Export anders aus als der
// Export desselben Bestands aus der Historie.
test('beide Quellen erzeugen dieselben Felder', () => {
  const live = normalizeFromLiveProducts([
    { name: 'Apfel', emoji: '🍎', category: 'Obst', unit: 'kg', isBio: true, currentStock: 4, yesterdayStock: 9 }
  ]);
  const snap = normalizeFromSnapshot([
    { productName: 'Apfel', emoji: '🍎', category: 'Obst', unit: 'kg', isBio: true, closingStock: 4, consumed: 5 }
  ]);
  assert.deepEqual(Object.keys(live[0]).sort(), Object.keys(snap[0]).sort());
  assert.deepEqual(live[0], snap[0]);
});

test('fehlende Werte bekommen Standardwerte statt undefined', () => {
  const [row] = normalizeFromLiveProducts([{ name: 'X' }]);
  assert.equal(row.emoji, '📦');
  assert.equal(row.category, 'Sonstige');
  assert.equal(row.unit, 'Kiste');
  assert.equal(row.stock, 0);
  assert.equal(row.consumed, 0);
});

test('Auffüllen ergibt Verbrauch 0, nicht negativ', () => {
  const [row] = normalizeFromLiveProducts([{ name: 'X', currentStock: 20, yesterdayStock: 5 }]);
  assert.equal(row.consumed, 0);
});

test('buildExcelWorkbook entschärft führende Formelzeichen in Kategorie, Produkt und Einheit', async () => {
  const rows = normalizeFromLiveProducts([
    { name: '=HYPERLINK("http://example.com")', emoji: '🍎', category: '+Obst', unit: '@Kiste', isBio: false, currentStock: 3, yesterdayStock: 5 }
  ]);
  const wb = await buildExcelWorkbook(rows, { subtitle: '=Untertitel', sheetName: '2026-05-02' });
  const sheet = wb.getWorksheet('2026-05-02');
  const texte = [];
  sheet.eachRow(r => {
    r.eachCell(c => {
      if (typeof c.value === 'string') texte.push(c.value);
    });
  });
  assert.ok(texte.includes("'=Untertitel"), 'Untertitel mit = muss entschärft sein');
  assert.ok(texte.includes("'+Obst"), 'Kategorie mit + muss entschärft sein');
  assert.ok(texte.includes("'=HYPERLINK(\"http://example.com\")"), 'Produktname mit = muss entschärft sein');
  assert.ok(texte.includes("'@Kiste"), 'Einheit mit @ muss entschärft sein');
});

test('normalizeFromLiveProducts rundet Dezimal-Differenzen ohne IEEE-754-Artefakte (F-004)', () => {
  const [row] = normalizeFromLiveProducts([
    { name: 'Ingwer', emoji: '🫚', category: 'Gemüse', unit: 'kg', isBio: true, currentStock: 0.1, yesterdayStock: 0.3 }
  ]);
  assert.equal(row.stock, 0.1);
  assert.equal(row.consumed, 0.2);
});

test('buildExcelWorkbook enthält nur Aktueller Bestand + Zuletzt gezählt ohne Verbrauch und ohne undefined/null (Phase M)', async () => {
  const rows = normalizeFromLiveProducts([
    { name: 'Tomaten', emoji: '🍅', category: 'Gemüse', unit: 'Kiste', isBio: false, currentStock: 12, yesterdayStock: 20, updatedByName: null }
  ]);
  const wb = await buildExcelWorkbook(rows, { sheetName: 'Live' });
  const sheet = wb.getWorksheet('Live');
  const texte = [];
  sheet.eachRow(r => r.eachCell(c => { if (typeof c.value === 'string') texte.push(c.value); }));
  assert.ok(texte.includes('Aktueller Bestand'));
  assert.ok(texte.includes('Zuletzt gezählt'));
  assert.ok(!texte.includes('Verbrauch'), 'Verbrauch-Spalte muss im Live-Export ausgeblendet sein');
  assert.ok(!texte.some(t => t.includes('undefined') || t.includes('null')), 'Null/undefined darf nie gedruckt werden');
});

test('BUG-002: buildPdfBuffer erzeugt einen vollständigen PDF-Buffer', async () => {
  const rows = normalizeFromLiveProducts([
    { name: 'Äpfel', emoji: '🍎', category: 'Obst', unit: 'Kiste', isBio: true, currentStock: 5, yesterdayStock: 7 }
  ]);
  const buf = await buildPdfBuffer(rows, { subtitle: 'Test' });
  assert.ok(Buffer.isBuffer(buf));
  assert.ok(buf.length > 100);
  assert.equal(buf.subarray(0, 5).toString('ascii'), '%PDF-');
});

test('BUG-003: formatLastCounted nutzt immer Europe/Berlin statt Server-UTC', () => {
  // 2026-07-15 22:30 UTC entspricht 2026-07-16 00:30 MESZ (Europe/Berlin)
  const [row] = normalizeFromLiveProducts([
    { name: 'Salat', currentStock: 3, updatedAt: '2026-07-15T22:30:00.000Z', updatedByName: 'Anna' }
  ]);
  assert.match(row.lastCounted, /16\.07\./);
  assert.match(row.lastCounted, /00:30/);
});
