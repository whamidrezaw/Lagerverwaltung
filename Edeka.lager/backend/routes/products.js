const express     = require('express');
const router      = express.Router();
const auth        = require('../middleware/auth');
const Product     = require('../models/Product');
const Category    = require('../models/Category');
const Unit        = require('../models/Unit');
const User        = require('../models/User');
const ActivityLog = require('../models/ActivityLog');
const { parseStock, parseNonEmptyString, parseRangeInt } = require('../lib/validate');

function benutzerAnzeigename(user) {
  if (!user) return '';
  return String(user.name || user.username || '').trim();
}

async function protokolliereAktivitaet(daten) {
  try {
    await ActivityLog.create(daten);
  } catch (err) {
    console.error('[ACTIVITY] Fehler beim Schreiben des Aktivitätsprotokolls:', err.message);
  }
}

// GET /api/products — همه محصولات فعال (هر واریانت Bio/واحد یک رکورد جداست)
router.get('/', auth, async (req, res) => {
  const filter = { isActive: true };
  if (typeof req.query.category === 'string' && req.query.category) filter.category = req.query.category;
  if (typeof req.query.unit === 'string' && req.query.unit)         filter.unit     = req.query.unit;
  if (req.query.isBio === 'true')  filter.isBio = true;
  if (req.query.isBio === 'false') filter.isBio = false;

  const products = await Product.find(filter).sort({ category: 1, name: 1, isBio: 1, unit: 1 });

  // Für ältere Produkte, die vor Phase M nur updatedBy (ObjectId) ohne
  // updatedByName gespeichert hatten, wird der Name einmalig nachgeschlagen.
  const fehlendeUserIds = [...new Set(
    products
      .filter(p => !p.updatedByName && p.updatedBy)
      .map(p => String(p.updatedBy))
  )];
  if (fehlendeUserIds.length > 0) {
    const users = await User.find({ _id: { $in: fehlendeUserIds } }).select('name username').lean();
    const namenMap = new Map(users.map(u => [String(u._id), benutzerAnzeigename(u)]));
    products.forEach(p => {
      if (!p.updatedByName && p.updatedBy) {
        p.updatedByName = namenMap.get(String(p.updatedBy)) || '';
      }
    });
  }

  res.json(products);
});

// GET /api/products/activity — آخرین تغییرات موجودی و محصولات (مرتب‌شده از جدیدترین)
// Wichtig: steht VOR allen /:id-Routen, damit Express "activity" niemals als Produkt-ID deutet.
router.get('/activity', auth, async (req, res) => {
  const limit = parseRangeInt(req.query.limit, { min: 1, max: 250, standard: 80 });
  if (limit === null) {
    return res.status(400).json({
      message: 'Ungültiger Wert für limit. Erwartet wird eine ganze Zahl von 1 bis 250.'
    });
  }
  const items = await ActivityLog.find({})
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
  res.json(items);
});

// POST /api/products — واریانت جدید یک محصول (نام + Bio + واحد باید ترکیب یکتا باشد)
router.post('/', auth, async (req, res, next) => {
  try {
    const { emoji, name, category, currentStock, unit, isBio } = req.body;
    const geprueft = parseStock(currentStock ?? 0);
    if (geprueft === null) {
      return res.status(400).json({ message: 'Ungültiger Bestandswert. Erwartet wird eine Zahl ab 0.' });
    }

    const cleanName     = parseNonEmptyString(name);
    const cleanCategory = parseNonEmptyString(category);
    const cleanUnit     = parseNonEmptyString(unit);

    if (!cleanName)
      return res.status(400).json({ message: 'Produktname erforderlich' });
    if (!cleanCategory)
      return res.status(400).json({ message: 'Kategorie erforderlich' });
    if (!cleanUnit)
      return res.status(400).json({ message: 'Einheit erforderlich' });

    const [catExists, unitExists] = await Promise.all([
      Category.findOne({ name: cleanCategory }),
      Unit.findOne({ name: cleanUnit })
    ]);
    if (!catExists)  return res.status(400).json({ message: `Unbekannte Kategorie: ${cleanCategory}` });
    if (!unitExists) return res.status(400).json({ message: `Unbekannte Einheit: ${cleanUnit}` });

    const startStock = geprueft;
    const cleanEmoji = parseNonEmptyString(emoji, { maxLength: 16 }) || '📦';
    const bioFlag    = !!isBio;

    // ── Reaktivierung gelöschter Produkte (F-001) ─────────────────
    // DELETE /api/products/:id deaktiviert Produkte standardmäßig nur
    // (isActive: false), während der Unique-Index { name, isBio, unit }
    // global gilt. Existiert bereits ein deaktivierter Eintrag für genau
    // diese Variante, wird er mit frischen Beständen (currentStock und
    // yesterdayStock = startStock) reaktiviert statt mit E11000 zu scheitern.
    const inactive = await Product.findOne({
      name:     cleanName,
      isBio:    bioFlag,
      unit:     cleanUnit,
      isActive: false
    });

    const userName = benutzerAnzeigename(req.user);

    if (inactive) {
      const reactivated = await Product.findByIdAndUpdate(
        inactive._id,
        {
          emoji:          cleanEmoji,
          category:       cleanCategory,
          currentStock:   startStock,
          yesterdayStock: startStock,
          isActive:       true,
          updatedBy:      req.user._id,
          updatedByName:  userName
        },
        { returnDocument: 'after', runValidators: true }
      );
      await protokolliereAktivitaet({
        action:      'create',
        productId:   reactivated._id,
        productName: reactivated.name,
        emoji:       reactivated.emoji,
        category:    reactivated.category,
        unit:        reactivated.unit,
        isBio:       !!reactivated.isBio,
        oldStock:    null,
        newStock:    startStock,
        userId:      req.user._id,
        userName:    userName || 'System',
        userRole:    req.user.role || 'lagerist'
      });
      return res.status(201).json(reactivated);
    }

    const product = await Product.create({
      emoji:          cleanEmoji,
      name:           cleanName,
      category:       cleanCategory,
      unit:           cleanUnit,
      isBio:          bioFlag,
      currentStock:   startStock,
      yesterdayStock: startStock,
      isActive:       true,
      updatedBy:      req.user._id,
      updatedByName:  userName
    });

    await protokolliereAktivitaet({
      action:      'create',
      productId:   product._id,
      productName: product.name,
      emoji:       product.emoji,
      category:    product.category,
      unit:        product.unit,
      isBio:       !!product.isBio,
      oldStock:    null,
      newStock:    startStock,
      userId:      req.user._id,
      userName:    userName || 'System',
      userRole:    req.user.role || 'lagerist'
    });

    res.status(201).json(product);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ message: 'Diese Variante (Name + Bio + Einheit) existiert bereits' });
    }
    next(err);
  }
});

// PUT /api/products/:id — ویرایش مشخصات واریانت (نام، ایموجی، دسته، واحد، Bio)
router.put('/:id', auth, async (req, res, next) => {
  try {
    const allowed = ['name', 'emoji', 'unit', 'category', 'isBio'];
    const updates = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });

    if (updates.name !== undefined) {
      const cleanName = parseNonEmptyString(updates.name);
      if (!cleanName) return res.status(400).json({ message: 'Produktname erforderlich' });
      updates.name = cleanName;
    }
    if (updates.category !== undefined) {
      const cleanCat = parseNonEmptyString(updates.category);
      if (!cleanCat) return res.status(400).json({ message: 'Kategorie erforderlich' });
      const catExists = await Category.findOne({ name: cleanCat });
      if (!catExists) return res.status(400).json({ message: `Unbekannte Kategorie: ${cleanCat}` });
      updates.category = cleanCat;
    }
    if (updates.unit !== undefined) {
      const cleanUnit = parseNonEmptyString(updates.unit);
      if (!cleanUnit) return res.status(400).json({ message: 'Einheit erforderlich' });
      const unitExists = await Unit.findOne({ name: cleanUnit });
      if (!unitExists) return res.status(400).json({ message: `Unbekannte Einheit: ${cleanUnit}` });
      updates.unit = cleanUnit;
    }
    if (updates.emoji !== undefined) {
      updates.emoji = parseNonEmptyString(updates.emoji, { maxLength: 16 }) || '📦';
    }

    const userName = benutzerAnzeigename(req.user);
    updates.updatedBy     = req.user._id;
    updates.updatedByName = userName;

    const product = await Product.findByIdAndUpdate(
      req.params.id,
      updates,
      { returnDocument: 'after', runValidators: true }
    );
    if (!product) return res.status(404).json({ message: 'Produkt nicht gefunden' });
    await protokolliereAktivitaet({
      action:      'update',
      productId:   product._id,
      productName: product.name,
      emoji:       product.emoji,
      category:    product.category,
      unit:        product.unit,
      isBio:       !!product.isBio,
      oldStock:    product.currentStock,
      newStock:    product.currentStock,
      userId:      req.user._id,
      userName:    userName || 'System',
      userRole:    req.user.role || 'lagerist'
    });
    res.json(product);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ message: 'Diese Variante (Name + Bio + Einheit) existiert bereits' });
    }
    next(err);
  }
});

// PATCH /api/products/:id/stock — به‌روزرسانی موجودی فعلی (همان عملکرد گزارش‌گیری روزمره)
router.patch('/:id/stock', auth, async (req, res) => {
  const { currentStock, updatedAt } = req.body;

  // Typprüfung VOR Number(): Number([]) ist 0, Number(["5"]) ist 5.
  // Ohne sie setzt ein leeres Array den Bestand still auf null.
  // Die Bestandsprüfung steht bewusst VOR der Versionsprüfung: ein
  // unsinniger Wert ist ein unsinniger Wert, egal welche Version dabei
  // liegt.
  const wert = require('../lib/validate').parseStock(currentStock);
  if (wert === null) {
    return res.status(400).json({ message: 'Ungültiger Bestandswert. Erwartet wird eine Zahl ab 0.' });
  }

  // ── Optimistische Sperre ──────────────────────────────────────
  // Das Formular nimmt eine ABSOLUTE Zählung entgegen ("ich sehe 4 im
  // Regal"), keine Bewegung. Zählen zwei Lageristen gleichzeitig, darf
  // die ältere Zählung die neuere nicht überschreiben — und schon gar
  // nicht lautlos. Beides zusammenzurechnen wäre falsch: dabei käme ein
  // dritter Wert heraus, den niemand im Regal gesehen hat.
  //
  // Als Version dient updatedAt. Mongoose pflegt es bei jedem Update
  // (timestamps: true). __v taugt nicht: findByIdAndUpdate zählt es
  // nicht hoch, es bliebe also immer gleich.
  if (updatedAt === undefined || updatedAt === null || updatedAt === '') {
    return res.status(400).json({
      message: 'Es fehlt der Stand, auf dem die Eingabe beruht (updatedAt).',
      code: 'VERSION_REQUIRED'
    });
  }
  const erwartet = new Date(updatedAt);
  if (Number.isNaN(erwartet.getTime())) {
    return res.status(400).json({ message: 'Ungültiger Wert für updatedAt.', code: 'VERSION_REQUIRED' });
  }

  const vorStand = await Product.findById(req.params.id).select('currentStock').lean();
  if (!vorStand) return res.status(404).json({ message: 'Produkt nicht gefunden' });

  const userName = benutzerAnzeigename(req.user);

  // Prüfen und Schreiben in EINER Operation: zwischen einem getrennten
  // Lesen und Schreiben passte sonst genau der Konflikt, den wir hier
  // verhindern wollen.
  const product = await Product.findOneAndUpdate(
    { _id: req.params.id, updatedAt: erwartet },
    { currentStock: wert, updatedBy: req.user._id, updatedByName: userName },
    { returnDocument: 'after', runValidators: true }
  );
  if (product) {
    await protokolliereAktivitaet({
      action:      'stock',
      productId:   product._id,
      productName: product.name,
      emoji:       product.emoji,
      category:    product.category,
      unit:        product.unit,
      isBio:       !!product.isBio,
      oldStock:    vorStand.currentStock ?? 0,
      newStock:    wert,
      userId:      req.user._id,
      userName:    userName || 'System',
      userRole:    req.user.role || 'lagerist'
    });
    return res.json(product);
  }

  // Kein Treffer heißt zweierlei: das Produkt gibt es nicht, oder
  // jemand war schneller. Die Fälle müssen unterschieden werden.
  const aktuell = await Product.findById(req.params.id).lean();
  if (!aktuell) return res.status(404).json({ message: 'Produkt nicht gefunden' });

  // Der aktuelle Stand geht mit: ohne ihn kann der Aufrufer nur
  // "Fehler" anzeigen, mit ihm kann er fragen und es erneut versuchen.
  return res.status(409).json({
    message: `Der Bestand wurde inzwischen auf ${aktuell.currentStock} geändert.`,
    code: 'STOCK_CONFLICT',
    currentStock: aktuell.currentStock,
    updatedAt: aktuell.updatedAt
  });
});

// DELETE /api/products/:id — غیرفعال‌کردن (پیش‌فرض) یا حذف کامل (?permanent=true, فقط ادمین)
router.delete('/:id', auth, async (req, res) => {
  const permanent = String(req.query.permanent || '').toLowerCase() === 'true';
  const userName  = benutzerAnzeigename(req.user);

  if (permanent) {
    if (req.user.role !== 'admin')
      return res.status(403).json({ message: 'Nur Admins dürfen Produkte endgültig löschen' });
    const deleted = await Product.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: 'Produkt nicht gefunden' });
    await protokolliereAktivitaet({
      action:      'delete',
      productId:   deleted._id,
      productName: deleted.name,
      emoji:       deleted.emoji,
      category:    deleted.category,
      unit:        deleted.unit,
      isBio:       !!deleted.isBio,
      oldStock:    deleted.currentStock ?? 0,
      newStock:    null,
      userId:      req.user._id,
      userName:    userName || 'System',
      userRole:    req.user.role || 'admin'
    });
    return res.json({ message: '🗑️ Produkt endgültig gelöscht' });
  }

  const product = await Product.findByIdAndUpdate(
    req.params.id,
    { isActive: false, updatedBy: req.user._id, updatedByName: userName },
    { returnDocument: 'after' }
  );
  if (!product) return res.status(404).json({ message: 'Produkt nicht gefunden' });
  await protokolliereAktivitaet({
    action:      'delete',
    productId:   product._id,
    productName: product.name,
    emoji:       product.emoji,
    category:    product.category,
    unit:        product.unit,
    isBio:       !!product.isBio,
    oldStock:    product.currentStock ?? 0,
    newStock:    null,
    userId:      req.user._id,
    userName:    userName || 'System',
    userRole:    req.user.role || 'lagerist'
  });
  res.json({ message: 'Produkt deaktiviert' });
});

module.exports = router;
