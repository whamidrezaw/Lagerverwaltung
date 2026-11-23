'use strict';
//
// SEC-001: JWT-Widerruf über tokenVersion (ohne Datenbank unit-getestet).
//
const test   = require('node:test');
const assert = require('node:assert/strict');
const jwt    = require('jsonwebtoken');

process.env.NODE_ENV   = 'test';
process.env.JWT_SECRET = 'unit-test-secret-mindestens-32-zeichen-lang-0123456789';

const User = require('../../models/User');
const auth = require('../../middleware/auth');

async function pruefeMitBenutzer(token, fakeUser) {
  const origFindById = User.findById;
  User.findById = () => ({ select: async () => fakeUser });
  const req = { headers: { authorization: `Bearer ${token}` } };
  const res = {
    code: null,
    body: null,
    status(c) { this.code = c; return this; },
    json(b)   { this.body = b; return this; }
  };
  let nextCalled = false;
  try {
    await auth(req, res, () => { nextCalled = true; });
  } finally {
    User.findById = origFindById;
  }
  return { req, res, nextCalled };
}

test('SEC-001: Alttoken ohne tv-Claim bleibt bei tokenVersion 0 gültig (Abwärtskompatibilität)', async () => {
  const legacyToken = jwt.sign({ id: 'u1' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const r = await pruefeMitBenutzer(legacyToken, { _id: 'u1', isActive: true, tokenVersion: 0 });
  assert.equal(r.nextCalled, true);
  assert.equal(r.res.code, null);
});

test('SEC-001: Altes Token (tv: 0) wird nach Passwortwechsel (tokenVersion: 1) mit 401 abgewiesen', async () => {
  const oldToken = jwt.sign({ id: 'u1', tv: 0 }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const r = await pruefeMitBenutzer(oldToken, { _id: 'u1', isActive: true, tokenVersion: 1 });
  assert.equal(r.nextCalled, false);
  assert.equal(r.res.code, 401);
});

test('SEC-001: Neues Token (tv: 1) wird bei tokenVersion: 1 akzeptiert', async () => {
  const freshToken = jwt.sign({ id: 'u1', tv: 1 }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const r = await pruefeMitBenutzer(freshToken, { _id: 'u1', isActive: true, tokenVersion: 1 });
  assert.equal(r.nextCalled, true);
  assert.equal(r.res.code, null);
});
