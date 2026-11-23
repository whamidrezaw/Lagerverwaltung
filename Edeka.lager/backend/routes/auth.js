const express   = require('express');
const router    = express.Router();
const jwt       = require('jsonwebtoken');
const bcrypt    = require('bcryptjs');
const User      = require('../models/User');
const auth      = require('../middleware/auth');
const { parseUsername, parsePassword, parseNonEmptyString, normalizeIp, parseRole, parseTelegramChatId } = require('../lib/validate');

// ── Mengenbegrenzung für den Login ──────────────────────────────
// Vorher: EIN Limiter je IP. Die Begründung war richtig gedacht — er
// sollte zugleich das Durchprobieren eines Kontos und das Streuen über
// viele Konten von einer Adresse bremsen. Nicht bedacht war, dass in
// einer Filiale alle Geräte hinter EINER öffentlichen Adresse sitzen:
// zehn Tippfehler eines Kollegen sperrten die ganze Filiale aus.
//
// Jetzt zwei Stufen (lib/limits.js), die beide Ziele von damals halten:
//   loginJeName   10 Fehlversuche je Benutzername  — schützt das Konto
//   loginJeIp     hohe Decke je IP, Standard 100   — bremst das Streuen
//
// Die Reihenfolge ist wesentlich: je Name ZUERST. Andersherum zählt
// jeder bereits abgewiesene Versuch weiter auf die IP-Decke, und einer,
// der dreißigmal klickt, sperrt wieder die ganze Filiale aus. Das ist
// geprüft: test/integration/login-limit-order.test.js.
//
// index.html wartet weiterhin auf 429 mit derselben Meldung.
const { loginJeName, loginJeIp, changePasswordJeBenutzer } = require('../lib/limits');

// SEC-004: Gültiger Bcrypt-Hash (Kostenfaktor 12) für konstante Antwortzeit
// bei unbekannten oder deaktivierten Konten (Schutz vor Benutzer-Enumeration).
const DUMMY_BCRYPT_HASH = '$2b$12$x5iy2zleUE3wF6WNVmXfa.3NREBYKUV2YCLF6CdqeeZeIStpn3.Yi';

// یک IP که ظاهر IPv4/IPv6 معتبر ندارد ذخیره نمی‌شود — هدف جلوگیری از این
// است که یک مقدار جعلی/دستکاری‌شده بعداً در پنل «Login-Verlauf» رندر شود
// (دفاع در عمق؛ سمت فرانت‌اند هم escapeHtml روی این فیلد اعمال می‌شود).
// Prüfung und Normalisierung liegen in lib/validate.js und sind dort
// ohne Server unit-getestet. require() ist gecacht — kein Mehraufwand.
function safeIp(raw) {
  return normalizeIp(raw);
}

// POST /api/auth/register  — فقط admin می‌تواند کاربر بسازد
// توجه: برای ایجاد کاربر کامل (با telegramChatId و isActive) از /api/users استفاده کنید
router.post('/register', auth, async (req, res) => {
  if (req.user.role !== 'admin')
    return res.status(403).json({ message: 'Nur Admins dürfen Benutzer erstellen' });

  const { username, password, name, role, telegramChatId, isActive } = req.body;
  const cleanUser = parseUsername(username);
  const cleanName = parseNonEmptyString(name);
  const cleanRole = parseRole(role, { defaultRole: 'lagerist' });
  const cleanChat = parseTelegramChatId(telegramChatId);

  if (!cleanUser || !password || !cleanName)
    return res.status(400).json({ message: 'username, password und name sind erforderlich' });
  if (!parsePassword(password))
    return res.status(400).json({ message: 'Passwort mindestens 6 Zeichen (maximal 128 Zeichen)' });
  if (!cleanRole)
    return res.status(400).json({ message: 'Ungültige Rolle. Erlaubt: admin, lagerist' });
  if (cleanChat === undefined)
    return res.status(400).json({ message: 'Ungültige Telegram Chat-ID' });

  const exists = await User.findOne({ username: cleanUser });
  if (exists) return res.status(400).json({ message: 'Benutzername bereits vergeben' });

  const hashedPassword = await bcrypt.hash(password, 12);
  const user = await User.create({
    username: cleanUser,
    password: hashedPassword,
    name: cleanName,
    role: cleanRole,
    telegramChatId: cleanChat,
    isActive: isActive !== false  // پیش‌فرض: فعال
  });

  res.status(201).json({
    message: 'Benutzer erstellt',
    user: {
      id: user._id,
      username: user.username,
      name: user.name,
      role: user.role,
      isActive: user.isActive
    }
  });
});

// POST /api/auth/login
router.post('/login', loginJeName, loginJeIp, async (req, res) => {
  const { username, password } = req.body;
  const cleanUser = parseUsername(username);

  if (!cleanUser || typeof password !== 'string' || password.length === 0)
    return res.status(400).json({ message: 'Benutzername und Passwort erforderlich' });
  if (password.length > 128)
    return res.status(401).json({
      message: 'Benutzername oder Passwort falsch',
      code: 'BAD_CREDENTIALS'
    });

  const ip        = safeIp(req.ip);
  const userAgent = String(req.headers['user-agent'] || '').slice(0, 300);

  const user = await User.findOne({ username: cleanUser });
  if (!user || !user.isActive) {
    await bcrypt.compare(password, DUMMY_BCRYPT_HASH);
    return res.status(401).json({
      message: 'Benutzername oder Passwort falsch',
      // Kennzeichnet einen Fehler bei den ZUGANGSDATEN, nicht bei der
      // Sitzung. Der Browser meldet sich bei einem so gekennzeichneten
      // 401 nicht ab — ein Tippfehler soll niemanden aus dem System werfen.
      code: 'BAD_CREDENTIALS'
    });
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid)
    return res.status(401).json({
      message: 'Benutzername oder Passwort falsch',
      // Kennzeichnet einen Fehler bei den ZUGANGSDATEN, nicht bei der
      // Sitzung. Der Browser meldet sich bei einem so gekennzeichneten
      // 401 nicht ab — ein Tippfehler soll niemanden aus dem System werfen.
      code: 'BAD_CREDENTIALS'
    });

  // Login-Log speichern (über die Model-Methode, wie im User-Model vorgesehen)
  user.addLoginEntry({ ip, userAgent, action: 'login' });
  await user.save();

  const token = jwt.sign(
    { id: user._id, tv: user.tokenVersion ?? 0 },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );

  res.json({
    token,
    user: {
      id: user._id,
      name: user.name,
      username: user.username,
      role: user.role
    }
  });
});

// GET /api/auth/me  — اطلاعات کاربر جاری (بدون رمز و loginHistory)
router.get('/me', auth, async (req, res) => {
  const user = await User.findById(req.user._id).select('-password -loginHistory');
  if (!user) return res.status(404).json({ message: 'Benutzer nicht gefunden' });
  res.json(user);
});

// PUT /api/auth/change-password  — تغییر رمز توسط کاربر خودش
router.put('/change-password', auth, changePasswordJeBenutzer, async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (typeof currentPassword !== 'string' || currentPassword.length === 0)
    return res.status(400).json({ message: 'Aktuelles Passwort erforderlich' });
  if (!parsePassword(newPassword))
    return res.status(400).json({ message: 'Neues Passwort muss mindestens 6 Zeichen haben' });
  if (currentPassword.length > 128)
    return res.status(401).json({
      message: 'Aktuelles Passwort falsch',
      code: 'BAD_CREDENTIALS'
    });

  const user = await User.findById(req.user._id);
  if (!user) return res.status(404).json({ message: 'Benutzer nicht gefunden' });

  const valid = await bcrypt.compare(currentPassword, user.password);
  if (!valid)
    return res.status(401).json({
      message: 'Aktuelles Passwort falsch',
      code: 'BAD_CREDENTIALS'
    });

  const hashed = await bcrypt.hash(newPassword, 12);
  await User.findByIdAndUpdate(user._id, {
    $set: { password: hashed },
    $inc: { tokenVersion: 1 }
  });
  if (typeof auth.invalidateUserCache === 'function') auth.invalidateUserCache(user._id);
  res.json({ message: '✅ Passwort erfolgreich geändert' });
});

module.exports = router;

// Nur für Tests exportiert — siehe routes/reports.js.
module.exports.__test__ = { safeIp };
