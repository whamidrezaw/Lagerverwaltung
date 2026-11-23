const jwt  = require('jsonwebtoken');
const User = require('../models/User');

// ── Kurzzeit-Cache für Benutzerprüfung (5 Sekunden TTL) ────────────
// Beim schnellen Zählen im Kühlhaus schickt das Smartphone Dutzende
// PATCH-Anfragen kurz hintereinander. Der 5s-Cache spart wiederholte
// Datenbankabfragen für denselben Benutzer, wird bei Änderungen in
// routes/users.js sofort geleert und bleibt in Tests (NODE_ENV=test)
// aus, damit direkte DB-Schreibzugriffe in Tests ohne Verzögerung wirken.
const AUTH_CACHE_TTL_MS   = 5000;
const AUTH_CACHE_MAX_SIZE = 500;
const _userCache = new Map();

function invalidateUserCache(userId) {
  if (!userId) {
    _userCache.clear();
    return;
  }
  _userCache.delete(String(userId));
}

async function loadUserById(id) {
  const key = String(id);
  const useCache = process.env.NODE_ENV !== 'test';
  const now = Date.now();
  if (useCache) {
    const cached = _userCache.get(key);
    if (cached && cached.expiresAt > now) {
      return cached.user;
    }
    if (cached) _userCache.delete(key);
  }
  const user = await User.findById(id).select('-password -loginHistory');
  if (useCache && user) {
    if (_userCache.size >= AUTH_CACHE_MAX_SIZE) {
      for (const [k, v] of _userCache.entries()) {
        if (v.expiresAt <= now) _userCache.delete(k);
      }
      if (_userCache.size >= AUTH_CACHE_MAX_SIZE) _userCache.clear();
    }
    _userCache.set(key, { user, expiresAt: now + AUTH_CACHE_TTL_MS });
  } else if (useCache) {
    _userCache.delete(key);
  }
  return user;
}

const authMiddleware = async (req, res, next) => {
  try {
    const header = req.headers.authorization || '';
    const token  = header.startsWith('Bearer ') ? header.slice(7) : null;

    if (!token)
      return res.status(401).json({ message: 'Kein Token vorhanden' });

    // FIX #3: Ablauf-Fehler gezielt abfangen
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (jwtErr) {
      const expired = jwtErr.name === 'TokenExpiredError';
      return res.status(401).json({
        message: expired ? 'Token abgelaufen – bitte erneut einloggen' : 'Token ungültig'
      });
    }

    // FIX #1: loginHistory ausschließen (vertrauliche Daten nicht im req.user)
    const user = await loadUserById(decoded.id);

    if (!user)
      return res.status(401).json({ message: 'Benutzer nicht gefunden' });

    // FIX #2: deaktivierte Benutzer blockieren
    if (!user.isActive)
      return res.status(403).json({ message: 'Konto deaktiviert – Zugriff verweigert' });

    // SEC-001: Tokens vor Passwortänderung/-reset sofort ungültig machen
    if ((decoded.tv ?? 0) !== (user.tokenVersion ?? 0))
      return res.status(401).json({ message: 'Token abgelaufen – bitte erneut einloggen' });

    req.user = user;
    next();
  } catch (err) {
    // Hier landen nur unerwartete Fehler — abgelaufene und ungültige
    // Token werden oben einzeln behandelt. Ohne diese Zeile blieb von
    // einem echten Defekt nirgends eine Spur, der Benutzer sah nur 401.
    console.error('[AUTH] Unerwarteter Fehler bei der Token-Prüfung:', err.message);
    return res.status(401).json({ message: 'Authentifizierung fehlgeschlagen' });
  }
};

authMiddleware.invalidateUserCache = invalidateUserCache;
module.exports = authMiddleware;
