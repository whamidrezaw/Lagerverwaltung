'use strict';
//
// Reine Prüffunktionen ohne Seiteneffekte. Bewusst frei von Express und
// Mongoose, damit sie ohne Datenbank und ohne Server testbar sind.
//

/**
 * Datum im Format JJJJ-MM-TT. Gibt den geprüften String zurück, sonst null.
 *
 * Lehnt alles ab, was kein echter String ist — insbesondere Objekte wie
 * { $ne: null }. Genau dieser Wert hat in Batch B die gesamte Historie
 * gelöscht, weil er ungeprüft in einen Mongo-Filter gewandert ist.
 */
function parseIsoDate(value) {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    return null; // z. B. 2026-02-30
  }
  return s;
}

/**
 * Rundet Bestands- und Verbrauchswerte auf höchstens 3 Nachkommastellen
 * (Gramm-Genauigkeit bei kg), um IEEE-754-Gleitkommaartefakte wie
 * `0.3 - 0.1 = 0.19999999999999998` oder `2.1 - 0.5 = 1.5999999999999999`
 * in Datenbank-Snapshots, API-Antworten und Telegram-Berichten zu verhindern.
 */
function roundStock(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
}

/**
 * Bestandswert. Gibt die Zahl (auf 3 Nachkommastellen gerundet) zurück, sonst null.
 *
 * Wichtig ist die Typprüfung VOR Number(): Number([]) ist 0 und Number(["5"])
 * ist 5. Ohne diese Prüfung setzt ein leeres Array den Bestand still auf 0 —
 * so war es vor Batch A, und genau das hat der Test aufgedeckt.
 */
const MAX_STOCK = 1_000_000;

function parseStock(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0 || value > MAX_STOCK) return null;
    const rounded = roundStock(value);
    return Number.isFinite(rounded) ? rounded : null;
  }
  if (typeof value === 'string') {
    const s = value.trim();
    if (!/^\d+([.,]\d+)?$/.test(s)) return null;
    const n = Number(s.replace(',', '.'));
    if (!Number.isFinite(n) || n < 0 || n > MAX_STOCK) return null;
    const rounded = roundStock(n);
    return Number.isFinite(rounded) ? rounded : null;
  }
  return null;
}

/**
 * Client-IP normalisieren und prüfen.
 *
 * Node liefert IPv4-Clients auf einem Dual-Stack-Socket als "::ffff:1.2.3.4".
 * Diese Form wird auf die reine IPv4 zurückgeführt, damit der Login-Verlauf
 * einheitlich bleibt und alte wie neue Einträge gleich aussehen.
 */
function normalizeIp(raw) {
  let ip = String(raw ?? '').trim();
  if (ip === '' || ip.length > 45) return '';

  const mapped = ip.match(/^::ffff:((?:\d{1,3}\.){3}\d{1,3})$/i);
  if (mapped) ip = mapped[1];

  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(ip) && ip.split('.').every(o => Number(o) <= 255)) return ip;
  if (/^[0-9a-fA-F:]+$/.test(ip) && ip.includes(':')) return ip;
  return '';
}

// Werte, die als Platzhalter kursieren und niemals ein echter Schlüssel sind.
const BEISPIEL_SCHLUESSEL = [
  'ein-sehr-langer-zufaelliger-string-hier-einfuegen',
  'dein-geheimer-schluessel',
  'your-secret-key',
  'changeme', 'change-me', 'secret', 'geheim', 'test'
];

/**
 * Prüft JWT_SECRET beim Start. Gibt einen Fehlertext zurück oder null.
 * Ohne tragfähigen Schlüssel ist ein Abbruch besser als ein laufender
 * Server, dessen Tokens jeder fälschen kann.
 */
function checkJwtSecret(secret) {
  if (typeof secret !== 'string' || secret.trim() === '') {
    return 'JWT_SECRET ist nicht gesetzt.';
  }
  const s = secret.trim();
  if (BEISPIEL_SCHLUESSEL.includes(s.toLowerCase())) {
    return 'JWT_SECRET ist noch ein Beispielwert.';
  }
  if (s.length < 32) {
    return `JWT_SECRET ist zu kurz (${s.length} Zeichen, mindestens 32).`;
  }
  return null;
}

/**
 * Ganzzahliger Bereichsparameter aus einer Query (days, limit).
 *
 * Gibt die Zahl zurück, den Standard bei fehlendem Wert, und null bei
 * allem, was nicht hineinpasst. Vorher stand dort
 * Math.min(parseInt(days) || 14, 90): das ließ negative Werte durch, und
 * daraus wurden limit(-40) und slice(0, -5) — beides verkürzte still,
 * bis das Diagramm leer war, ohne dass jemand einen Fehler sah.
 */
function parseRangeInt(value, { min, max, standard }) {
  if (value === undefined || value === null || value === '') return standard;
  if (typeof value === 'boolean' || typeof value === 'object') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

// ── Netzwerk ──────────────────────────────────────────────────────
// Adresse, auf der der Server lauscht. Standard: nur die eigene Maschine.
// Davor sitzt ein Tunnel auf demselben Rechner; niemand soll an ihm
// vorbei direkt auf den Port der App.
function listenHost(env) {
  const h = env && typeof env.HOST === 'string' ? env.HOST.trim() : '';
  return h || '127.0.0.1';
}

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

// TRUST_PROXY=true heißt: dem Header X-Forwarded-For glauben. Sicher nur,
// wenn ausschließlich der Proxy die App erreicht. Lauscht sie im Netz, kann
// jeder Client den Header selbst setzen — die IP-Grenze beim Login wäre
// umgangen, im Log stünden erfundene Adressen.
// TRUST_PROXY wird GENAU wie in app.js gelesen (ohne trim): sonst meldete
// diese Prüfung ein Problem, wo app.js gar nichts einschaltet.
function checkProxyConfig(env) {
  const vertrauen = String((env && env.TRUST_PROXY) || '').toLowerCase() === 'true';
  if (!vertrauen) return null;
  const host = listenHost(env);
  if (LOOPBACK.has(host)) return null;
  return 'TRUST_PROXY=true, aber HOST=' + host + ': Die App wäre direkt erreichbar, ' +
    'und jeder Client könnte X-Forwarded-For fälschen. ' +
    'HOST weglassen (Standard 127.0.0.1) oder TRUST_PROXY=false.';
}

// ── Texteingaben, Zugangsdaten & Tabellenexport ──────────────────
/**
 * Nicht-leerer String mit oberer Längengrenze.
 *
 * Vorher riefen Routen wie POST/PUT /api/products, /api/categories und
 * /api/units direkt `name.trim()` auf. Schickte ein Client eine Zahl (123)
 * oder ein Array (["Apfel"]), warf Node `TypeError: name.trim is not a function`
 * und antwortete mit 500 statt 400. Außerdem wurden reine Leerzeichen ("   ")
 * bei PUT /api/categories/:id und PUT /api/units/:id still ignoriert.
 */
function parseNonEmptyString(value, { maxLength = 200 } = {}) {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (s.length === 0 || s.length > maxLength) return null;
  return s;
}

/**
 * Benutzername: echter String, getrimmt und kleingeschrieben (1..100 Zeichen).
 *
 * Das User-Schema speichert `username` zwar mit `lowercase: true, trim: true`,
 * aber `User.findOne({ username })` in Login und Registrierung übergab den
 * Rohwert bisher ohne Normalisierung — Großbuchstaben oder Randleerzeichen
 * (" Anna ") scheiterten beim Login, obwohl der Ratenbegrenzer (`loginJeName`)
 * denselben Namen bereits kleinschrieb und trimmte.
 */
function parseUsername(value) {
  const s = parseNonEmptyString(value, { maxLength: 60 });
  return s ? s.toLowerCase() : null;
}

/**
 * Passwort: echter String mit Mindest- und Höchstlänge (Standard 6..128).
 *
 * Zwei reale Schwachstellen ohne diese Prüfung:
 *   1. `if (!password || password.length < 6)` ließ ein Array mit 6 Elementen
 *      (`[1,2,3,4,5,6]`) durch (`Array.length === 6`), woraufhin `bcrypt.hash`
 *      bzw. `bcrypt.compare` mit einem unbehandelten Typfehler (500) abstürzte.
 *   2. Bcrypt verarbeitet intern nur die ersten 72 Byte, rechnet aber vorher
 *      auf dem gesamten Eingabestring — sehr lange Strings (z. B. 100 KB)
 *      blockieren die Event-Loop unnötig (CPU-DoS).
 */
function parsePassword(value, { minLength = 6, maxLength = 128 } = {}) {
  if (typeof value !== 'string') return null;
  if (value.length < minLength || value.length > maxLength) return null;
  return value;
}

/**
 * Entschärft Textwerte für Excel- (.xlsx) und CSV-Exporte gegen
 * Tabellenkalkulations-Formel-Injektion (OWASP CSV / Formula Injection).
 *
 * Jeder angemeldete Lagerist darf Produkte, Kategorien und Einheiten anlegen.
 * Beginnt ein solcher Name (auch nach führenden Leerzeichen) mit `=`, `+`,
 * `-`, `@`, Tab (`\t`) oder Wagenrücklauf (`\r`), interpretiert Excel die
 * Zelle beim Öffnen als Formel (z. B. `=HYPERLINK(...)` oder `=1+1`).
 * Ein vorangestelltes Hochkomma (`'`) zwingt Excel/LibreOffice zur Textanzeige.
 * Das einzelne Zeichen `—` (Geviertstrich für Nicht-Bio) bleibt unverändert.
 */
function sanitizeSpreadsheetCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string') return value;
  if (/^[\s]*[=+\-@]|^[\t\r]/.test(value)) {
    return "'" + value;
  }
  return value;
}

/**
 * Benutzerrolle prüfen ('admin' oder 'lagerist').
 * Gibt die gültige Rolle zurück, sonst null.
 */
const ERLAUBTE_ROLLEN = new Set(['admin', 'lagerist']);
function parseRole(value, { defaultRole = null } = {}) {
  if (value === undefined || value === null || value === '') return defaultRole;
  if (typeof value !== 'string') return null;
  const r = value.trim();
  return ERLAUBTE_ROLLEN.has(r) ? r : null;
}

/**
 * Telegram-Chat-ID normalisieren und prüfen (paritätisch zu models/User.js).
 * - null / undefined / "" / "   " → null (kein Chat hinterlegt)
 * - numerischer String oder Ganzzahl (z. B. "-100123456789", max. 64 Zeichen) → getrimmter String
 * - ungültiger Typ oder nicht-numerisch → undefined (Fehler 400)
 */
function parseTelegramChatId(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) return undefined;
    return String(value);
  }
  if (typeof value === 'string') {
    const s = value.trim();
    if (s === '') return null;
    if (s.length > 64 || !/^-?\d+$/.test(s)) return undefined;
    return s;
  }
  return undefined;
}

/**
 * Sortierreihenfolge (order) für Kategorien und Einheiten prüfen.
 * Erlaubt ganze Zahlen (oder numerische Strings) im Bereich -10000..100000.
 */
function parseOrder(value) {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= -10000 && value <= 100000 ? value : null;
  }
  if (typeof value === 'string') {
    const s = value.trim();
    if (!/^-?\d+$/.test(s)) return null;
    const n = Number(s);
    return Number.isInteger(n) && n >= -10000 && n <= 100000 ? n : null;
  }
  return null;
}

module.exports = {
  parseIsoDate,
  roundStock,
  parseStock,
  parseRangeInt,
  normalizeIp,
  checkJwtSecret,
  listenHost,
  checkProxyConfig,
  parseNonEmptyString,
  parseUsername,
  parsePassword,
  sanitizeSpreadsheetCell,
  parseRole,
  parseTelegramChatId,
  parseOrder
};
