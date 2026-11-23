'use strict';
//
// Was der Browser nach „Bericht senden“ zeigt.
//
// Ohne eingerichtetes Telegram meldet der Server telegram: "aus". Dann ist
// die Meldung grün — „Bericht gespeichert“ —, und nirgends steht „gesendet“:
// es wurde ja nichts gesendet. Nur ein echter Fehler beim Versand ist rot.
//
const test   = require('node:test');
const assert = require('node:assert/strict');
const { ladeShared, antwort } = require('../helpers/browser');

async function meldungen(status, koerper) {
  const b = ladeShared({ token: 'x', fetchStub: async () => antwort(status, koerper) });
  const gezeigt = [];
  b.sandbox.showToast = (text, art) => gezeigt.push([art, text]);
  await b.sandbox.sendReportNow();
  return gezeigt;
}

test('ohne Telegram: grün „Bericht gespeichert“ — kein Rot, kein „gesendet“', async () => {
  const m = await meldungen(201, { message: '✅ Bericht gespeichert', telegram: 'aus', log: {} });
  assert.deepEqual(m.at(-1), ['ok', '✅ Bericht gespeichert!']);
  assert.ok(!m.some(([art]) => art === 'err'), JSON.stringify(m));
  assert.ok(!m.some(([, text]) => /gesendet/.test(text)), JSON.stringify(m));
});

test('Versand gescheitert: weiterhin die Warnung', async () => {
  const m = await meldungen(207, { telegram: 'fehler', telegramError: 'Netz weg', log: {} });
  assert.deepEqual(m.at(-1), ['err', '⚠️ Bericht gespeichert, Telegram-Versand fehlgeschlagen: Netz weg']);
});

test('gesendet: grün „gesendet und gespeichert“', async () => {
  const m = await meldungen(201, { telegram: 'gesendet', log: {} });
  assert.deepEqual(m.at(-1), ['ok', '✅ Bericht gesendet und gespeichert!']);
});

test('FE-005: Doppelklick auf sendReportNow sendet nur eine Anfrage und gibt Sperre danach wieder frei', async () => {
  let aufrufe = 0;
  let aufloesen;
  const b = ladeShared({
    token: 'x',
    fetchStub: () => {
      aufrufe++;
      return new Promise(r => { aufloesen = () => r(antwort(201, { telegram: 'aus', log: {} })); });
    }
  });
  b.sandbox.showToast = () => {};

  const p1 = b.sandbox.sendReportNow();
  const p2 = b.sandbox.sendReportNow();
  assert.equal(await p2, null, 'zweiter gleichzeitiger Aufruf muss ignoriert werden');
  assert.equal(aufrufe, 1);

  aufloesen();
  await p1;

  // Nach Abschluss muss die Sperre wieder frei sein
  const p3 = b.sandbox.sendReportNow();
  assert.equal(aufrufe, 2);
  aufloesen();
  await p3;
});
