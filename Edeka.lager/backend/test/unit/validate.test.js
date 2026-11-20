'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const { parseIsoDate, parseStock, normalizeIp, checkJwtSecret } = require('../../lib/validate');

test('parseIsoDate nimmt gültige Datumsangaben an', () => {
  assert.equal(parseIsoDate('2026-05-02'), '2026-05-02');
  assert.equal(parseIsoDate('  2026-12-31  '), '2026-12-31');
});

test('parseIsoDate lehnt Mongo-Operatoren ab', () => {
  assert.equal(parseIsoDate({ $ne: null }), null);
  assert.equal(parseIsoDate({ $gt: '' }),   null);
  assert.equal(parseIsoDate(['2026-05-02']), null);
});

test('parseIsoDate lehnt falsche Formate und unmögliche Tage ab', () => {
  assert.equal(parseIsoDate('02.05.2026'), null);
  assert.equal(parseIsoDate('2026-5-2'),   null);
  assert.equal(parseIsoDate('2026-02-30'), null);
  assert.equal(parseIsoDate('2026-13-01'), null);
  assert.equal(parseIsoDate(''),   null);
  assert.equal(parseIsoDate(null), null);
});

test('parseStock nimmt Zahlen und numerische Strings an', () => {
  assert.equal(parseStock(0),     0);
  assert.equal(parseStock(12),    12);
  assert.equal(parseStock('7'),   7);
  assert.equal(parseStock('2.5'), 2.5);
  assert.equal(parseStock('2,5'), 2.5);
});

test('parseStock lehnt genau die Werte ab, die vorher durchgerutscht sind', () => {
  assert.equal(parseStock([]),      null, 'Number([]) ist 0 — das war die Lücke');
  assert.equal(parseStock(['5']),   null, 'Number(["5"]) ist 5');
  assert.equal(parseStock({}),      null);
  assert.equal(parseStock(null),    null);
  assert.equal(parseStock(true),    null);
  assert.equal(parseStock('abc'),   null);
  assert.equal(parseStock(''),      null);
  assert.equal(parseStock(-1),      null);
  assert.equal(parseStock(Infinity),null);
  assert.equal(parseStock(NaN),     null);
});

test('normalizeIp führt IPv4-mapped auf reine IPv4 zurück', () => {
  assert.equal(normalizeIp('::ffff:127.0.0.1'),    '127.0.0.1');
  assert.equal(normalizeIp('::FFFF:192.168.1.10'), '192.168.1.10');
});

test('normalizeIp lässt gültige Adressen unverändert', () => {
  assert.equal(normalizeIp('192.168.1.10'), '192.168.1.10');
  assert.equal(normalizeIp('2001:db8::1'),  '2001:db8::1');
});

test('normalizeIp verwirft Unbrauchbares', () => {
  assert.equal(normalizeIp('999.1.1.1'),       '');
  assert.equal(normalizeIp('::ffff:999.1.1.1'),'');
  assert.equal(normalizeIp('<script>'),        '');
  assert.equal(normalizeIp(undefined),         '');
  assert.equal(normalizeIp('a:'.repeat(40)),   '');
});

test('checkJwtSecret bemängelt fehlende, kurze und Beispiel-Schlüssel', () => {
  assert.ok(checkJwtSecret(undefined));
  assert.ok(checkJwtSecret(''));
  assert.ok(checkJwtSecret('kurz'));
  assert.ok(checkJwtSecret('ein-sehr-langer-zufaelliger-string-hier-einfuegen'));
});

test('checkJwtSecret akzeptiert einen echten Schlüssel', () => {
  const echt = require('crypto').randomBytes(48).toString('base64url');
  assert.equal(checkJwtSecret(echt), null);
});

// ── Neu in C2: Bereichsprüfer für days und limit ──────────────────
const { parseRangeInt } = require('../../lib/validate');
const BEREICH = { min: 1, max: 90, standard: 14 };

test('parseRangeInt nimmt Werte im Bereich an', () => {
  assert.equal(parseRangeInt('7', BEREICH), 7);
  assert.equal(parseRangeInt(30, BEREICH), 30);
  assert.equal(parseRangeInt('90', BEREICH), 90);
  assert.equal(parseRangeInt('1', BEREICH), 1);
});

test('parseRangeInt gibt bei fehlendem Wert den Standard zurück', () => {
  assert.equal(parseRangeInt(undefined, BEREICH), 14);
  assert.equal(parseRangeInt(null, BEREICH), 14);
  assert.equal(parseRangeInt('', BEREICH), 14);
});

test('parseRangeInt lehnt ab, was nicht in den Bereich passt', () => {
  assert.equal(parseRangeInt('-5', BEREICH),  null, 'negative Werte führten zu einem leeren Diagramm');
  assert.equal(parseRangeInt('0', BEREICH),   null);
  assert.equal(parseRangeInt('91', BEREICH),  null);
  assert.equal(parseRangeInt('7.5', BEREICH), null);
  assert.equal(parseRangeInt('abc', BEREICH), null);
  assert.equal(parseRangeInt(['7'], BEREICH), null);
  assert.equal(parseRangeInt({}, BEREICH),    null);
  assert.equal(parseRangeInt(true, BEREICH),  null);
  assert.equal(parseRangeInt(Infinity, BEREICH), null);
});

// ── Texteingaben, Zugangsdaten & Tabellenexport ──────────────────
const {
  parseNonEmptyString,
  parseUsername,
  parsePassword,
  sanitizeSpreadsheetCell
} = require('../../lib/validate');

test('parseNonEmptyString trimmt gültige Strings und lehnt Nicht-Strings sowie Leerzeichen ab', () => {
  assert.equal(parseNonEmptyString('  Apfel  '), 'Apfel');
  assert.equal(parseNonEmptyString('Obst & Gemüse'), 'Obst & Gemüse');
  assert.equal(parseNonEmptyString(''), null);
  assert.equal(parseNonEmptyString('   '), null, 'reine Leerzeichen dürfen keinen Namen löschen');
  assert.equal(parseNonEmptyString(['Apfel']), null, 'Array warf vorher TypeError: name.trim is not a function');
  assert.equal(parseNonEmptyString(123), null, 'Zahl warf vorher TypeError: name.trim is not a function');
  assert.equal(parseNonEmptyString({}), null);
  assert.equal(parseNonEmptyString(null), null);
  assert.equal(parseNonEmptyString(undefined), null);
  assert.equal(parseNonEmptyString('x'.repeat(201)), null);
});

test('parseUsername normalisiert Groß-/Kleinschreibung und Randleerzeichen', () => {
  assert.equal(parseUsername('  Anna.M  '), 'anna.m');
  assert.equal(parseUsername('LAGERIST1'), 'lagerist1');
  assert.equal(parseUsername('   '), null);
  assert.equal(parseUsername(['anna']), null);
  assert.equal(parseUsername(null), null);
  assert.equal(parseUsername('a'.repeat(101)), null);
});

test('parsePassword wehrt Array-Bypass und überlange Bcrypt-Eingaben ab', () => {
  assert.equal(parsePassword('geheim123'), 'geheim123');
  assert.equal(parsePassword('123456'), '123456');
  assert.equal(parsePassword('12345'), null, 'zu kurz');
  assert.equal(parsePassword([1, 2, 3, 4, 5, 6]), null, 'Array mit Länge 6 ließ password.length < 6 passieren');
  assert.equal(parsePassword(123456), null);
  assert.equal(parsePassword(null), null);
  assert.equal(parsePassword('a'.repeat(128)), 'a'.repeat(128));
  assert.equal(parsePassword('a'.repeat(129)), null, 'Schutz gegen Bcrypt-CPU-DoS');
});

test('sanitizeSpreadsheetCell entschärft Formel-Injektionen für Excel und CSV', () => {
  assert.equal(sanitizeSpreadsheetCell('=1+1'), "'=1+1");
  assert.equal(sanitizeSpreadsheetCell('+SUM(A1:A5)'), "'+SUM(A1:A5)");
  assert.equal(sanitizeSpreadsheetCell('-2+3'), "'-2+3");
  assert.equal(sanitizeSpreadsheetCell('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(sanitizeSpreadsheetCell('  =cmd|...'), "'  =cmd|...");
  assert.equal(sanitizeSpreadsheetCell('\t=1+1'), "'\t=1+1");
  assert.equal(sanitizeSpreadsheetCell('\r=1+1'), "'\r=1+1");
  assert.equal(sanitizeSpreadsheetCell('Äpfel (Bio)'), 'Äpfel (Bio)');
  assert.equal(sanitizeSpreadsheetCell('—'), '—', 'Geviertstrich für Nicht-Bio bleibt unverändert');
  assert.equal(sanitizeSpreadsheetCell(42), 42);
  assert.equal(sanitizeSpreadsheetCell(null), '');
});

// ── Phase L (360° Audit): Gleitkomma-Rundung, Rollen, Telegram-Chat-ID, Order & Ops ──
const fs   = require('node:fs');
const path = require('node:path');
const {
  roundStock,
  parseRole,
  parseTelegramChatId,
  parseOrder
} = require('../../lib/validate');
const { buildTelegramText } = require('../../services/telegram');

test('roundStock beseitigt IEEE-754-Gleitkommaartefakte auf 3 Nachkommastellen (F-004)', () => {
  assert.equal(roundStock(0.3 - 0.1), 0.2, '0.3 - 0.1 darf nicht 0.19999999999999998 bleiben');
  assert.equal(roundStock(2.1 - 0.5), 1.6, '2.1 - 0.5 darf nicht 1.5999999999999999 bleiben');
  assert.equal(roundStock(0.1 + 0.2), 0.3, '0.1 + 0.2 darf nicht 0.30000000000000004 bleiben');
  assert.equal(roundStock(1.23456),   1.235);
  assert.equal(roundStock(NaN),       0);
  assert.equal(parseStock(0.1 + 0.2), 0.3);
});

test('buildTelegramText rundet Dezimal-Bestände und -Verbräuche sauber (F-004)', () => {
  const text = buildTelegramText([
    { name: 'Ingwer', emoji: '🫚', category: 'Gemüse', unit: 'kg', isBio: true, yesterdayStock: 0.3, currentStock: 0.1 }
  ]);
  assert.ok(text.includes('(−0.2)'), `Erwartet (−0.2) im Telegram-Bericht, erhalten:\n${text}`);
  assert.ok(!text.includes('0.199999'), 'Keine IEEE-754-Artefakte im Telegram-Bericht');
});

test('parseRole akzeptiert nur admin und lagerist (F-005)', () => {
  assert.equal(parseRole('admin'), 'admin');
  assert.equal(parseRole('  lagerist '), 'lagerist');
  assert.equal(parseRole(undefined, { defaultRole: 'lagerist' }), 'lagerist');
  assert.equal(parseRole('', { defaultRole: 'lagerist' }), 'lagerist');
  assert.equal(parseRole('superadmin'), null);
  assert.equal(parseRole(['admin']), null);
  assert.equal(parseRole({ $ne: 'lagerist' }), null);
});

test('parseTelegramChatId normalisiert Leerstrings zu null und weist Ungültiges ab (F-005)', () => {
  assert.equal(parseTelegramChatId(undefined), null);
  assert.equal(parseTelegramChatId(null), null);
  assert.equal(parseTelegramChatId(''), null);
  assert.equal(parseTelegramChatId('   '), null);
  assert.equal(parseTelegramChatId('  -100123456789  '), '-100123456789');
  assert.equal(parseTelegramChatId(123456789), '123456789');
  assert.equal(parseTelegramChatId('mit leerzeichen innen'), undefined);
  assert.equal(parseTelegramChatId(['12345']), undefined);
  assert.equal(parseTelegramChatId({}), undefined);
  assert.equal(parseTelegramChatId('x'.repeat(65)), undefined);
});

test('parseOrder prüft ganzzahlige Sortierwerte für Kategorien und Einheiten (F-006)', () => {
  assert.equal(parseOrder(0), 0);
  assert.equal(parseOrder(15), 15);
  assert.equal(parseOrder('-5'), -5);
  assert.equal(parseOrder('abc'), null);
  assert.equal(parseOrder(1.5), null);
  assert.equal(parseOrder([1]), null);
  assert.equal(parseOrder({}), null);
  assert.equal(parseOrder(200000), null);
});

test('services/telegram.js nutzt AbortSignal.timeout, server.js hat SIGTERM/SIGINT und .gitignore schützt .env (F-002, F-003, F-007, F-008)', () => {
  const tgSrc = fs.readFileSync(path.join(__dirname, '../../services/telegram.js'), 'utf8');
  assert.ok(tgSrc.includes('AbortSignal.timeout('), 'sendTelegram muss AbortSignal.timeout verwenden');

  const srvSrc = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');
  assert.ok(srvSrc.includes("process.on('SIGTERM'") && srvSrc.includes("process.on('SIGINT'"), 'server.js muss SIGTERM und SIGINT behandeln');
  assert.ok(srvSrc.includes('server.close(') && srvSrc.includes('mongoose.disconnect()'), 'Graceful Shutdown muss HTTP-Server und MongoDB schließen');

  const adminSrc = fs.readFileSync(path.join(__dirname, '../../createAdmin.js'), 'utf8');
  assert.ok(adminSrc.includes('parseUsername('), 'createAdmin.js muss Benutzernamen vor der Suche normalisieren');

  const rootIgnore = fs.readFileSync(path.join(__dirname, '../../../../.gitignore'), 'utf8');
  assert.ok(rootIgnore.includes('.env') && rootIgnore.includes('node_modules/'), 'Root-.gitignore muss .env und node_modules/ ausschließen');
});
