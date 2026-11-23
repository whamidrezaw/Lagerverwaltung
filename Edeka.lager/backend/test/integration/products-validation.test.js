'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const db     = require('../helpers/db');
const Category = require('../../models/Category');
const Unit     = require('../../models/Unit');
const { start, stop, req } = require('../helpers/http');
const { makeLageristToken, makeAdminToken, makeProduct } = require('../helpers/factories');

test.before(async () => { await db.connect(); await start(); });
test.after (async () => { await stop(); await db.disconnect(); });
test.beforeEach(async () => {
  await db.wipe();
  await Category.create({ name: 'Obst', emoji: '🍎' });
  await Unit.create({ name: 'Kiste' });
});

const base = { name: 'Apfel', category: 'Obst', unit: 'Kiste', emoji: '🍎' };

test('PATCH /stock weist nicht-numerische Werte ab', async () => {
  const token = await makeLageristToken();
  const p = await makeProduct();
  for (const bad of ['abc', null, {}, [], 'NaN']) {
    const r = await req(`/api/products/${p._id}/stock`, { method: 'PATCH', token, body: { currentStock: bad } });
    assert.equal(r.status, 400, `Wert ${JSON.stringify(bad)} hätte abgelehnt werden müssen`);
  }
});

test('PATCH /stock weist negative Werte ab', async () => {
  const token = await makeLageristToken();
  const p = await makeProduct();
  const r = await req(`/api/products/${p._id}/stock`, { method: 'PATCH', token, body: { currentStock: -5 } });
  assert.equal(r.status, 400);
});

test('unbekannte Kategorie wird abgewiesen', async () => {
  const token = await makeLageristToken();
  const r = await req('/api/products', { method: 'POST', token, body: { ...base, category: 'Gibtesnicht' } });
  assert.equal(r.status, 400);
});

test('dieselbe Variante zweimal anzulegen schlägt fehl', async () => {
  const token = await makeLageristToken();
  assert.equal((await req('/api/products', { method: 'POST', token, body: base })).status, 201);
  assert.equal((await req('/api/products', { method: 'POST', token, body: base })).status, 400);
});

// ── ROT: uneinheitliche Validierung (Batch A) ────────────────────────
// PATCH /stock prüft sauber auf eine endliche, nicht-negative Zahl.
// POST /products macht dagegen `Number(currentStock) || 0` — "abc" wird
// stillschweigend zu 0. Zwei Endpunkte, dasselbe Feld, zwei Regeln.
test('POST /products weist ungültigen Anfangsbestand ab statt ihn zu 0 zu machen', async () => {
  const token = await makeLageristToken();
  const r = await req('/api/products', { method: 'POST', token, body: { ...base, currentStock: 'abc' } });
  assert.equal(r.status, 400, `stattdessen ${r.status} — der Wert wurde still zu ${r.body && r.body.currentStock}`);
});

test('POST /products weist negativen Anfangsbestand ab', async () => {
  const token = await makeLageristToken();
  const r = await req('/api/products', { method: 'POST', token, body: { ...base, currentStock: -3 } });
  assert.equal(r.status, 400);
});

test('POST und PUT weisen Nicht-String-Namen und reine Leerzeichen mit 400 ab (nicht 500)', async () => {
  const token = await makeAdminToken();
  const p = await makeProduct();
  for (const badName of [123, ['Apfel'], '   ', '']) {
    const rPost = await req('/api/products', { method: 'POST', token, body: { ...base, name: badName } });
    assert.equal(rPost.status, 400, `POST /products mit name=${JSON.stringify(badName)} ergab ${rPost.status}`);
    const rPut = await req(`/api/products/${p._id}`, { method: 'PUT', token, body: { name: badName } });
    assert.equal(rPut.status, 400, `PUT /products/:id mit name=${JSON.stringify(badName)} ergab ${rPut.status}`);
  }
  const cat = await Category.findOne({ name: 'Obst' });
  const unit = await Unit.findOne({ name: 'Kiste' });
  const rCat = await req(`/api/categories/${cat._id}`, { method: 'PUT', token, body: { name: '   ' } });
  assert.equal(rCat.status, 400, 'PUT /categories/:id mit Leerzeichen muss 400 liefern');
  const rUnit = await req(`/api/units/${unit._id}`, { method: 'PUT', token, body: { name: '   ' } });
  assert.equal(rUnit.status, 400, 'PUT /units/:id mit Leerzeichen muss 400 liefern');
});

test('deaktiviertes Produkt (isActive: false) wird bei erneutem POST /products mit frischem Bestand reaktiviert (F-001)', async () => {
  const token = await makeAdminToken();
  const created = await req('/api/products', {
    method: 'POST',
    token,
    body: { ...base, name: 'Mango', currentStock: 15 }
  });
  assert.equal(created.status, 201);
  const prodId = created.body._id;

  // Soft-Delete (isActive: false)
  const del = await req(`/api/products/${prodId}`, { method: 'DELETE', token });
  assert.equal(del.status, 200);

  // In GET /api/products nicht mehr sichtbar
  const listBefore = await req('/api/products', { token });
  assert.equal(listBefore.body.some(p => p._id === prodId), false);

  // Erneutes Anlegen derselben Variante (Name + Bio + Einheit) mit neuem Bestand 8
  const reactivated = await req('/api/products', {
    method: 'POST',
    token,
    body: { ...base, name: 'Mango', emoji: '🥭', currentStock: 8 }
  });
  assert.equal(reactivated.status, 201, 'Muss 201 liefern statt 400 E11000 Duplicate Key');
  assert.equal(reactivated.body._id, prodId, 'Derselbe Datensatz muss reaktiviert werden');
  assert.equal(reactivated.body.isActive, true);
  assert.equal(reactivated.body.currentStock, 8);
  assert.equal(reactivated.body.yesterdayStock, 8, 'yesterdayStock muss auf den neuen Startbestand zurückgesetzt sein');
  assert.equal(reactivated.body.consumed, 0);
});

test('PUT /categories/:id und PUT /units/:id prüfen order auf ganze Zahlen (F-006)', async () => {
  const token = await makeAdminToken();
  const cat  = await Category.findOne({ name: 'Obst' });
  const unit = await Unit.findOne({ name: 'Kiste' });

  for (const badOrder of ['abc', {}, [1], 3.14, 999999]) {
    const rCat = await req(`/api/categories/${cat._id}`, { method: 'PUT', token, body: { order: badOrder } });
    assert.equal(rCat.status, 400, `Category order=${JSON.stringify(badOrder)} muss 400 liefern`);
    const rUnit = await req(`/api/units/${unit._id}`, { method: 'PUT', token, body: { order: badOrder } });
    assert.equal(rUnit.status, 400, `Unit order=${JSON.stringify(badOrder)} muss 400 liefern`);
  }

  const okCat = await req(`/api/categories/${cat._id}`, { method: 'PUT', token, body: { order: 5 } });
  assert.equal(okCat.status, 200);
  assert.equal(okCat.body.order, 5);
});

test('GET /api/products/activity liefert Server-seitiges Aktivitäts-Protokoll vor /:id und handhabt updatedBy===null sicher (Phase M)', async () => {
  const token = await makeAdminToken();
  const created = await req('/api/products', {
    method: 'POST',
    token,
    body: { ...base, name: 'Birne', currentStock: 10 }
  });
  assert.equal(created.status, 201);
  const prod = created.body;

  const patched = await req(`/api/products/${prod._id}/stock`, {
    method: 'PATCH',
    token,
    body: { currentStock: 14, updatedAt: prod.updatedAt }
  });
  assert.equal(patched.status, 200);
  assert.ok(patched.body.updatedByName, 'updatedByName muss gesetzt sein');

  // Route /api/products/activity darf nicht mit /:id kollidieren
  const act = await req('/api/products/activity?limit=10', { token });
  assert.equal(act.status, 200);
  assert.ok(Array.isArray(act.body));
  const stockEntry = act.body.find(e => e.action === 'stock' && e.productName === 'Birne');
  assert.ok(stockEntry, 'Bestandsänderung muss im Aktivitäts-Protokoll stehen');
  assert.equal(stockEntry.oldStock, 10);
  assert.equal(stockEntry.newStock, 14);
  assert.ok(stockEntry.userName);

  // Alt-Produkt ohne updatedBy (null) darf bei GET /api/products nicht abstürzen
  await makeProduct({ name: 'Altprodukt', category: 'Obst', unit: 'Kiste', updatedBy: null });
  const list = await req('/api/products', { token });
  assert.equal(list.status, 200);
  const alt = list.body.find(p => p.name === 'Altprodukt');
  assert.ok(alt);
  assert.equal(alt.updatedByName || '', '');
});

test('BUG-001: deaktiviertes Produkt (isActive: false) kann weder per PUT noch per PATCH /stock geändert werden', async () => {
  const token = await makeAdminToken();
  const created = await req('/api/products', {
    method: 'POST', token,
    body: { ...base, name: 'Kirsche', currentStock: 5 }
  });
  assert.equal(created.status, 201);
  const prod = created.body;

  assert.equal((await req(`/api/products/${prod._id}`, { method: 'DELETE', token })).status, 200);

  const rPut = await req(`/api/products/${prod._id}`, {
    method: 'PUT', token,
    body: { name: 'Kirsche Neu' }
  });
  assert.equal(rPut.status, 404);

  const rPatch = await req(`/api/products/${prod._id}/stock`, {
    method: 'PATCH', token,
    body: { currentStock: 9, updatedAt: prod.updatedAt }
  });
  assert.equal(rPatch.status, 404);
});
