# KI-Audit & Änderungsprotokoll (Phase J — Härtung, Qualität & Barrierefreiheit)

Dieses Dokument protokolliert lückenlos alle im Rahmen des Multi-Skill-Audits (`security-and-hardening`, `ponytail-audit`, `code-review-and-quality`, `test-driven-development`, `a11y-debugging`, `performance-optimization`, `documentation-and-adrs`) durchgeführten Änderungen an `EDEKA Lagerverwaltung`.

Es ist speziell so aufgebaut, dass **jede weitere KI** oder jeder Entwickler sofort erkennt:
1. **Welche Datei** geändert wurde,
2. **Was vorher dort stand (`Vorher / Before`)**,
3. **Was jetzt dort steht (`Nachher / After`)**,
4. **Warum die Änderung notwendig war (`Grund / Reason`)**.

---

## Übersicht der geänderten Dateien

| Nr. | Datei | Kategorie | Kurzbeschreibung der Änderung |
|---|---|---|---|
| 1 | `Edeka.lager/backend/lib/validate.js` | Sicherheit & Typprüfung | Neue reine Prüffunktionen `parseNonEmptyString`, `parseUsername`, `parsePassword` und `sanitizeSpreadsheetCell` |
| 2 | `Edeka.lager/backend/routes/auth.js` | Sicherheit & Korrektheit | Schutz gegen Array-Bypass (`password.length`) und Bcrypt-DoS (Max-Länge 128); Normalisierung von `username` beim Login/Register |
| 3 | `Edeka.lager/backend/routes/users.js` | Sicherheit & Korrektheit | Typsichere Prüfung für `username`, `password` und `name` (auch bei `PUT /api/users/:id`) |
| 4 | `Edeka.lager/backend/routes/products.js` | Sicherheit & Korrektheit | Typsichere String-Prüfung für `name`, `category`, `unit`, `emoji` (verhindert `500 TypeError` bei Nicht-Strings und leere Namen bei `PUT`) |
| 5 | `Edeka.lager/backend/routes/categories.js` | Korrektheit & Validierung | Typsichere String-Prüfung für `name`; `PUT /api/categories/:id` weist reine Leerzeichen (`"   "`) mit `400` ab statt sie still zu ignorieren |
| 6 | `Edeka.lager/backend/routes/units.js` | Korrektheit & Validierung | Typsichere String-Prüfung für `name`; `PUT /api/units/:id` weist reine Leerzeichen (`"   "`) mit `400` ab statt sie still zu ignorieren |
| 7 | `Edeka.lager/backend/routes/reports.js` | Performance & Sicherheit | Atomares `Product.updateMany` statt N einzelner `findByIdAndUpdate` in `reset-stock`; Typprüfung für `scope` in `reset-logs`; bereinigtes Datum im `Content-Disposition`-Header |
| 8 | `Edeka.lager/backend/services/exportBuilder.js` | Sicherheit (OWASP) | Schutz vor Excel-Formel-Injektion (CSV/Spreadsheet Formula Injection) über `sanitizeSpreadsheetCell` |
| 9 | `Edeka.lager/frontend/assets/shared.js` | Sicherheit (OWASP) | Schutz vor CSV-Formel-Injektion in `downloadCSV` über `sanitizeCsvCell` |
| 10 | `Edeka.lager/frontend/assets/users.js` | Bugfix (Frontend) | Verwaister Selektor `[onclick*="openLogPanel"]` auf `[data-action="protokollOeffnen"]` korrigiert |
| 11 | `Edeka.lager/frontend/assets/dashboard.js` | Barrierefreiheit (a11y) | `Escape`-Taste schließt geöffnete Dialoge (`#product-modal`, `#admin-modal`, `#confirm-overlay`) |
| 12 | `Edeka.lager/frontend/assets/reports.js` | Barrierefreiheit (a11y) | `Escape`-Taste schließt geöffnete Dialoge/Drawer (`#drawer-overlay`, `#admin-modal`, `#confirm-overlay`) |
| 13 | `Edeka.lager/backend/package.json` | Plattformkompatibilität | `npm run lint` ruft `node ./backend/node_modules/eslint/bin/eslint.js .` auf (funktioniert unter Linux & Windows) |
| 14 | `Edeka.lager/backend/test/unit/sicherung-pfad.test.js` | Test-Konsistenz | `{ skip: OHNE }`-Wächter ergänzt (analog zu `abnahme.test.js`, `alarm.test.js`, `extern-sicherung.test.js`) |
| 15 | `Edeka.lager/backend/test/unit/validate.test.js` | Unit-Tests | Neue Tests für `parseNonEmptyString`, `parseUsername`, `parsePassword`, `sanitizeSpreadsheetCell` |
| 16 | `Edeka.lager/backend/test/unit/export-normalize.test.js` | Unit-Tests | Neuer Test für Formel-Entschärfung in `buildExcelWorkbook` |
| 17 | `Edeka.lager/backend/test/unit/inline-handler.test.js` | Unit-Tests | Neuer Wächter-Test gegen verwaiste `[on*...]`-Selektoren im Frontend |
| 18 | `Edeka.lager/backend/test/unit/aktionen.test.js` | Unit-Tests | Neuer Test für `sanitizeCsvCell` in `shared.js` |
| 19 | `Edeka.lager/ENTSCHEIDUNGEN.md` | Dokumentation (ADR) | Architekturentscheidungen #19 und #20 dokumentiert |

---

## Detaillierter Vorher-Nachher-Vergleich (Before / After)

### 1. `Edeka.lager/backend/lib/validate.js`

- **Grund:** `rejectMongoOperators` in `lib/sanitize.js` blockiert Schlüssel mit `$`, lässt aber Arrays (`["a"]`) und Zahlen (`123`) im JSON-Body durch. Ohne explizite String-Typprüfung führten `.trim()`, `.toLowerCase()` und `bcrypt.hash`/`bcrypt.compare` bei Nicht-Strings zu unbehandelten `500 Interner Serverfehler`-Antworten statt `400 Bad Request`. Zudem fehlte eine Obergrenze für Passwortlängen (Bcrypt-CPU-DoS) und eine Entschärfung für Tabellenkalkulations-Formeln.
- **Vorher:**
  ```js
  module.exports = { parseIsoDate, parseStock, parseRangeInt, normalizeIp, checkJwtSecret, listenHost, checkProxyConfig };
  ```
- **Nachher:**
  Vier neue, nebenwirkungsfreie Funktionen ergänzt und exportiert:
  - `parseNonEmptyString(value, { maxLength = 200 } = {})`
  - `parseUsername(value)`
  - `parsePassword(value, { minLength = 6, maxLength = 128 } = {})`
  - `sanitizeSpreadsheetCell(value)`

---

### 2. `Edeka.lager/backend/routes/auth.js`

- **Grund:**
  1. `if (!password || password.length < 6)` ließ ein Array mit 6 Elementen (`{"password": [1,2,3,4,5,6]}`) durch, woraufhin `bcrypt.hash` mit `500` abstürzte.
  2. In `POST /api/auth/login` führte `{"username": "anna", "password": [1]}` bei `bcrypt.compare` zu einem `500`-Absturz.
  3. Überlange Passwörter (> 128 Zeichen) wurden ungeprüft an `bcrypt` übergeben.
  4. `User.findOne({ username })` suchte ohne `.trim().toLowerCase()`, obwohl das `User`-Modell Benutzernamen kleingeschrieben speichert und `loginJeName` bereits `toLowerCase().trim()` verwendet.
- **Vorher (`POST /register` & `POST /login` & `PUT /change-password`):**
  ```js
  if (!username || !password || !name)
    return res.status(400).json({ message: 'username, password und name sind erforderlich' });
  if (password.length < 6)
    return res.status(400).json({ message: 'Passwort mindestens 6 Zeichen' });
  const exists = await User.findOne({ username });
  ```
  ```js
  if (!username || !password)
    return res.status(400).json({ message: 'Benutzername und Passwort erforderlich' });
  ...
  const user = await User.findOne({ username });
  ```
- **Nachher:**
  ```js
  const cleanUser = parseUsername(username);
  const cleanName = parseNonEmptyString(name);

  if (!cleanUser || !password || !cleanName)
    return res.status(400).json({ message: 'username, password und name sind erforderlich' });
  if (!parsePassword(password))
    return res.status(400).json({ message: 'Passwort mindestens 6 Zeichen (maximal 128 Zeichen)' });

  const exists = await User.findOne({ username: cleanUser });
  ```
  Und in `POST /login`:
  ```js
  const cleanUser = parseUsername(username);

  if (!cleanUser || typeof password !== 'string' || password.length === 0)
    return res.status(400).json({ message: 'Benutzername und Passwort erforderlich' });
  if (password.length > 128)
    return res.status(401).json({
      message: 'Benutzername oder Passwort falsch',
      code: 'BAD_CREDENTIALS'
    });
  ...
  const user = await User.findOne({ username: cleanUser });
  ```

---

### 3. `Edeka.lager/backend/routes/users.js`

- **Grund:** Gleiche Typ- und Längenprüfung für `POST /api/users`, `PUT /api/users/:id` (verhindert das Überschreiben von `name` mit `""` oder Nicht-Strings) und `PUT /api/users/:id/reset-password`.
- **Vorher:**
  ```js
  if (!username || !password || !name)
    return res.status(400).json({ message: 'username, password und name sind erforderlich' });
  if (password.length < 6)
    return res.status(400).json({ message: 'Passwort mindestens 6 Zeichen' });
  const exists = await User.findOne({ username });
  ```
- **Nachher:**
  Nutzt `parseUsername(username)`, `parseNonEmptyString(name)` und `parsePassword(password)` in `POST /`, `PUT /:id` und `PUT /:id/reset-password`.

---

### 4. `Edeka.lager/backend/routes/products.js`, `categories.js`, `units.js`

- **Grund:**
  1. `if (!name || !name.trim())` warf `TypeError: name.trim is not a function` (`500`), wenn `name` kein String war.
  2. In `PUT /api/categories/:id` (`if (name !== undefined && name.trim())`) und `PUT /api/units/:id` wurde ein reiner Leerzeichen-String (`"   "`) stillschweigend ignoriert und `200 OK` zurückgegeben, statt `400` zu melden.
  3. In `PUT /api/products/:id` (`if (updates.name) updates.name = updates.name.trim()`) wurde `"   "` zu `""` getrimmt.
- **Vorher (`categories.js`):**
  ```js
  if (name !== undefined && name.trim()) updates.name = name.trim();
  ```
- **Nachher (`categories.js`):**
  ```js
  if (name !== undefined) {
    const cleanName = parseNonEmptyString(name);
    if (!cleanName) return res.status(400).json({ message: 'Name der Kategorie erforderlich' });
    updates.name = cleanName;
  }
  ```
  (Analog in `units.js` und `products.js` umgesetzt.)

---

### 5. `Edeka.lager/backend/routes/reports.js`

- **Grund:**
  1. **Performance (N+1-Problem):** `POST /api/reports/reset-stock` lud alle aktiven Produkte mit `Product.find({ isActive: true })` und führte dann in einer Schleife `Product.findByIdAndUpdate` für jedes einzelne Produkt aus.
  2. **Typsicherheit:** `POST /api/reports/reset-logs` rief `(req.body?.scope || ...).toLowerCase()` ohne Typprüfung auf.
- **Vorher (`reset-stock`):**
  ```js
  const products = await Product.find({ isActive: true });

  await Promise.all(products.map(p => Product.findByIdAndUpdate(p._id, {
    currentStock: 0,
    ...(includeYesterday ? { yesterdayStock: 0 } : {}),
    updatedBy: req.user._id
  })));

  res.json({
    message: '✅ Bestände zurückgesetzt',
    count: products.length,
    yesterdayCleared: !!includeYesterday
  });
  ```
- **Nachher (`reset-stock`):**
  ```js
  const result = await Product.updateMany(
    { isActive: true },
    {
      $set: {
        currentStock: 0,
        ...(includeYesterday ? { yesterdayStock: 0 } : {}),
        updatedBy: req.user._id
      }
    }
  );

  res.json({
    message: '✅ Bestände zurückgesetzt',
    count: result.matchedCount ?? result.modifiedCount ?? 0,
    yesterdayCleared: !!includeYesterday
  });
  ```

---

### 6. `Edeka.lager/backend/services/exportBuilder.js` & `Edeka.lager/frontend/assets/shared.js`

- **Grund:** Schutz gegen Tabellenkalkulations-Formelinjektion (OWASP CSV / Formula Injection). Da jeder angemeldete Benutzer Produkte, Kategorien und Einheiten anlegen kann, könnte ein Name wie `=HYPERLINK(...)` beim Öffnen der Excel- oder CSV-Datei durch den Admin in Excel als Formel ausgeführt werden.
- **Vorher (`exportBuilder.js`):**
  ```js
  headerRow.getCell(1).value = section.category;
  ...
  const row = sheet.addRow({
    emoji:    item.emoji,
    name:     item.name,
    bio:      item.isBio ? '🌱 Bio' : '—',
    unit:     item.unit,
    stock:    item.stock,
    consumed: item.consumed
  });
  ```
- **Nachher (`exportBuilder.js`):**
  ```js
  headerRow.getCell(1).value = sanitizeSpreadsheetCell(section.category);
  ...
  const row = sheet.addRow({
    emoji:    sanitizeSpreadsheetCell(item.emoji),
    name:     sanitizeSpreadsheetCell(item.name),
    bio:      item.isBio ? '🌱 Bio' : '—',
    unit:     sanitizeSpreadsheetCell(item.unit),
    stock:    item.stock,
    consumed: item.consumed
  });
  ```
- **Vorher (`shared.js`):**
  ```js
  .map(r => r.map(v => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(','))
  ```
- **Nachher (`shared.js`):**
  ```js
  function sanitizeCsvCell(v) {
    const s = String(v ?? '');
    return (/^[\s]*[=+\-@]|^[\t\r]/.test(s) ? "'" + s : s).replace(/"/g, '""');
  }
  window.sanitizeCsvCell = sanitizeCsvCell;
  ...
  .map(r => r.map(v => '"' + sanitizeCsvCell(v) + '"').join(','))
  ```

---

### 7. `Edeka.lager/frontend/assets/users.js`, `dashboard.js`, `reports.js`

- **Grund:**
  1. In `users.js:342` stand noch der alte Selektor `[onclick*="openLogPanel"]` aus der Zeit vor Phase F. Seit Phase F trägt der Knopf jedoch `data-action="protokollOeffnen"`.
  2. Auf `users.html` ließen sich alle Dialoge mit `Escape` schließen (`users.js:332`), auf `dashboard.html` und `reports.html` fehlte die `Escape`-Unterstützung für geöffnete Dialoge und das Detail-Drawer-Panel.
- **Vorher (`users.js:342`):**
  ```js
  if (panel.classList.contains('open') && !panel.contains(e.target) && !e.target.closest('[onclick*="openLogPanel"]'))
    closeLogPanel();
  ```
- **Nachher (`users.js:342`):**
  ```js
  if (panel.classList.contains('open') && !panel.contains(e.target) && !e.target.closest('[data-action="protokollOeffnen"]'))
    closeLogPanel();
  ```
- **Nachher (`dashboard.js` & `reports.js`):**
  `Escape`-Handler ergänzt, der `closeProductModal()`, `closeDrawer()`, `closeAdminTools()` und `closeConfirm()` aufruft.

---

## Phase K — Mobile-First-Ergonomie, Touch-Ziele & Responsive Kartenansicht

### 8. `Edeka.lager/frontend/assets/shared.css`

- **Grund:**
  1. `.step-btn` (`28px × 28px`, `gap: 6px`) und `.row-act` (`28px × 28px`, `gap: 4px`) waren auf Smartphones zu klein und lagen zu dicht nebeneinander (Gefahr von Fehltipps zwischen `+`, `✏️` und `🗑️`).
  2. `.form-footer` (genutzt in `users.html`) fehlte in `shared.css`, wodurch `Abbrechen` und `Speichern` ohne definierten Flex-Abstand nebeneinander klebten.
  3. `.table-wrap` hatte `overflow: hidden`, und Tabellen (`#product-tbody`, `#history-tbody`, `#users-tbody`) quetschten auf Smartphones 4 bis 8 Spalten horizontal zusammen.
  4. Eingabefelder mit `font-size: 13px` lösten unter iOS Safari beim Antippen einen automatischen Seiten-Zoom aus.
- **Vorher (`shared.css` — Stepper & Zeilenaktionen):**
  ```css
  .stepper   { display: flex; align-items: center; gap: 6px; }
  .step-btn  { width: 28px; height: 28px; ... }
  .step-val  { width: 44px; font-size: 13px; padding: 4px 0; ... }
  .row-acts  { display: flex; gap: 4px; }
  .row-act   { width: 28px; height: 28px; font-size: 13px; color: var(--color-text-faint); ... }
  ```
- **Nachher (`shared.css` — Stepper & Zeilenaktionen):**
  ```css
  .stepper   { display: inline-flex; align-items: center; gap: 8px; }
  .step-btn  { width: 36px; height: 36px; border-radius: var(--radius-md); background: var(--color-surface-2); ... }
  .step-val  { width: 54px; height: 36px; font-size: 14px; border-radius: var(--radius-md); ... }
  .row-acts  { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
  .row-act   { width: 36px; height: 36px; border-radius: var(--radius-md); border: 1px solid var(--color-border); background: var(--color-surface-2); ... }
  .form-footer { display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px; }
  ```
- **Vorher (`shared.css` — Mobile Breakpoint `@media (max-width: 600px)`):**
  ```css
  @media (max-width: 600px) {
    .kpi-grid { grid-template-columns: 1fr; }
    .topbar-date { display: none; }
  }
  ```
- **Nachher (`shared.css` — Mobile Breakpoint `@media (max-width: 640px)`):**
  - `.menu-toggle`, `.icon-btn`, `.step-btn` auf `40px × 40px`, `.step-val` auf `60px × 40px`, `.row-act` auf `38px × 38px` (`gap: 8px`).
  - `.form-ctrl`, `.search-input`, `.step-val` mit `font-size: 16px !important` (verhindert iOS-Auto-Zoom).
  - `.kpi-grid, .kpi-grid-3` mit `grid-template-columns: repeat(2, 1fr); gap: 10px;` (kompaktes 2-Spalten-Raster auf Smartphones, Fallback `1fr` unter `360px`).
  - Reine CSS-Kartenansicht für `#product-tbody tr[data-id]`, `#history-tbody tr:not(:has(td[colspan]))` und `#users-tbody tr:not(:has(td[colspan]))`: Produktname + Bearbeiten/Löschen in Zeile 1, Bestands-Stepper + Tagesverbrauch in Zeile 2.

---

### 9. `Edeka.lager/frontend/dashboard.html`, `analytics.html`, `reports.html`, `users.html`, `index.html`

- **Grund:**
  1. In `dashboard.html:50` (`#overall-kpi-grid`) und `analytics.html:74` (`#trend-kpi-grid`) überschrieben Inline-Attribute `style="grid-template-columns: repeat(4, 1fr)..."` bzw. `repeat(3, 1fr)` die Media Queries in `shared.css`.
  2. In `users.html` liefen Suchfeld + `＋ Neuer Benutzer` + Theme-Knopf in `.topbar-right` auf schmalen Bildschirmen über.
  3. In `index.html` war `.brand-panel` unter `768px` komplett ausgeblendet (`display: none`), sodass auf dem Smartphone das EDEKA-Logo fehlte.
- **Vorher (`dashboard.html` & `analytics.html`):**
  ```html
  <div class="kpi-grid" id="overall-kpi-grid" style="grid-template-columns: repeat(4, 1fr); margin-bottom: 20px;"></div>
  <div class="kpi-grid" id="trend-kpi-grid" style="grid-template-columns: repeat(3, 1fr); margin-bottom:20px"></div>
  ```
- **Nachher (`dashboard.html` & `analytics.html`):**
  ```html
  <div class="kpi-grid" id="overall-kpi-grid"></div>
  <div class="kpi-grid kpi-grid-3" id="trend-kpi-grid"></div>
  ```
- **Vorher (`users.html`):**
  Kein Mobile-Umbruch für `.topbar-right` / `.search-input` (`width: 210px` fest).
- **Nachher (`users.html`, `dashboard.html`, `analytics.html`):**
  ```css
  @media (max-width: 640px) {
    .topbar { height: auto; flex-wrap: wrap; padding: 10px 14px; gap: 10px; }
    .topbar-left { flex: 1 1 100%; min-width: 0; }
    .topbar-right {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: flex-start;
      gap: 10px;
      padding-top: 8px;
      border-top: 1px solid var(--color-divider);
    }
    .topbar-right .icon-btn { width: 40px; height: 40px; flex: 0 0 40px; }
    .topbar-right .btn { flex: 1 1 auto; min-height: 40px; justify-content: center; }
  }
  ```
  *(Zudem `.topbar-left > div { min-width: 0; overflow: hidden; }` in `shared.css` und Cache-Busting `?v=2.1` für `/assets/shared.css`, damit Titel und Knöpfe `🌓`, `⚙️` und `📤 Bericht (jetzt) senden` auf Smartphones in zwei saubere Zeilen getrennt werden und sich niemals überlappen.)*
- **Vorher (`index.html`):**
  ```css
  @media (max-width: 768px) {
    .page { grid-template-columns: 1fr; }
    .brand-panel { display: none; }
    .form-panel { padding: 40px 24px; background: var(--color-bg); }
  }
  ```
- **Nachher (`index.html`):**
  Kompakter mobiler Marken-Header (`.brand-panel` zeigt Logo + Claim in einer Kopfzeile; `.brand-content`, `.brand-features`, `.brand-footer` ausgeblendet), Karten-Layout für `.login-box`, `46px`/`48px` Touch-Höhen und `font-size: 16px` für Login-Felder.
- **Guard-Test:** `Edeka.lager/backend/test/unit/mobile-ui.test.js` prüft die Abstände, `.kpi-grid-3`, die Abwesenheit von Inline-`grid-template-columns` und die mobilen Tabellen-Kartenregeln.

---

## Phase L — 360°-Audit-Härtung (Produkt-Reaktivierung, Telegram-Timeout, Graceful Shutdown & Dezimalrundung)

### 10. `Edeka.lager/backend/routes/products.js` (`F-001`)

- **Grund:** `DELETE /api/products/:id` setzt standardmäßig `isActive: false` (Soft-Delete), während der eindeutige Index `{ name: 1, isBio: 1, unit: 1 }` in `models/Product.js` global gilt. Wollte ein Lagerist ein gelöschtes Produkt später erneut anlegen, scheiterte `POST /api/products` mit `E11000 Duplicate Key`.
- **Vorher (`routes/products.js:51-61`):**
  ```js
  const product = await Product.create({
    emoji: cleanEmoji, name: cleanName, category: cleanCategory,
    unit: cleanUnit, isBio: !!isBio, currentStock: startStock,
    yesterdayStock: startStock, isActive: true, updatedBy: req.user._id
  });
  ```
- **Nachher (`routes/products.js:51-82`):**
  Prüft vor `Product.create`, ob ein deaktivierter Datensatz (`isActive: false`) mit derselben Variante (`name + isBio + unit`) existiert. Falls ja, wird dieser Datensatz per `findByIdAndUpdate` mit `isActive: true` und zurückgesetzten Beständen (`currentStock: startStock, yesterdayStock: startStock`) reaktiviert und mit Status `201` zurückgegeben.

### 11. `Edeka.lager/backend/services/telegram.js` (`F-002`)

- **Grund:** `fetch(url, ...)` zur Telegram-API hatte kein Zeitlimit (`AbortSignal.timeout`). Bei Netzwerkstörungen zu `api.telegram.org` konnte der Aufruf hängen bleiben.
- **Vorher (`services/telegram.js:24-32`):**
  ```js
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: target, text, parse_mode: 'Markdown' })
  });
  ```
- **Nachher (`services/telegram.js:24-45`):**
  `signal: AbortSignal.timeout(timeoutMs)` (Standard `10000` ms) ergänzt und `TimeoutError`/`AbortError` sauber in eine klare Fehlermeldung übersetzt, sodass `POST /api/reports/send-now` nach spätestens 10 Sekunden kontrolliert mit Status `207` antwortet.

### 12. `Edeka.lager/backend/server.js` & `services/dailyClose.js` (`F-003`)

- **Grund:** Bei `systemctl restart edeka-lager.service` (`SIGTERM`) beendete Node den Prozess sofort, ohne den Cron-Task zu stoppen, laufende HTTP-Anfragen abzuschließen oder die MongoDB-Verbindung geordnet zu trennen.
- **Vorher (`server.js:38-50`):**
  ```js
  scheduleDailyClose();
  app.listen(PORT, HOST, (err) => { ... });
  ```
- **Nachher (`server.js:38-89` & `dailyClose.js:154-167`):**
  `scheduleDailyClose()` gibt den `cronTask` zurück; `server.js` setzt Timeouts (`requestTimeout = 30000`, `headersTimeout = 35000`, `keepAliveTimeout = 65000`) und registriert `SIGTERM`-/`SIGINT`-Handler für geordnetes Herunterfahren (`cronTask.stop()` → `server.close()` → `mongoose.disconnect()` mit 10-Sekunden-Sicherheits-Timer).

### 13. `Edeka.lager/backend/lib/validate.js`, `models/Product.js`, `routes/reports.js`, `services/dailyClose.js`, `services/telegram.js`, `services/exportBuilder.js` (`F-004`)

- **Grund:** Bei Dezimalschritten (`0.1` / `0.5` kg) erzeugte IEEE-754-Arithmetik Artefakte wie `0.3 - 0.1 = 0.19999999999999998` oder `2.1 - 0.5 = 1.5999999999999999`.
- **Nachher:** Hilfsfunktion `roundStock(value)` (Rundung auf 3 Nachkommastellen) in `lib/validate.js` eingeführt und durchgängig in `parseStock`, `Product.consumed`, `dailyClose`, `reports`, `telegram` und `exportBuilder` angewendet.

### 14. `Edeka.lager/backend/routes/auth.js`, `routes/users.js`, `routes/categories.js`, `routes/units.js`, `createAdmin.js`, `.gitignore` (`F-005`–`F-009`)

- **Nachher:**
  - `parseRole` (`admin` | `lagerist`) und `parseTelegramChatId` (Leerstring → `null`, Typ- und Längenprüfung) in `auth.js` und `users.js` eingesetzt (`F-005`).
  - `parseOrder` (ganze Zahl `-10000..100000`) in `PUT /api/categories/:id` und `PUT /api/units/:id` ergänzt (`F-006`).
  - `parseUsername` in `createAdmin.js` vor `User.findOne({ username })` ergänzt (`F-007`).
  - `.gitignore` und `Edeka.lager/backend/.gitignore` mit Regeln für `node_modules/`, `.env`, `*.log`, `*.bak` und `coverage/` gefüllt (`F-008`).
  - ESLint-Warnungen auf Test-Strings in `test/unit/html-senken.test.js` bereinigt (`0 errors, 0 warnings`) (`F-009`).

---

## Phase M — Reine Live-Bestandstafel (`Aktueller Bestand`), Kühlhaus-Fehler-UX & Server-Protokoll

### 15. `Edeka.lager/backend/models/ActivityLog.js`, `models/Product.js`, `routes/products.js` & `middleware/auth.js`

- **Grund:** Die Marktleitung benötigt im Büro jederzeit in Echtzeit den tatsächlichen Bestand (`Aktueller Bestand`), den genauen Zeitpunkt sowie den Namen des letzten Zählers (`updatedByName`) — ohne ablenkende Verbrauchsspalten. Zudem muss jede Zählung zentral in MongoDB protokolliert werden (`DSGVO`-konform mit 90-Tage-TTL-Index), und schnelle Klickfolgen im Kühlhaus profitieren von einem kurzen 5-Sekunden-Auth-Cache.
- **Nachher:**
  - `models/Product.js`: Feld `updatedByName` ergänzt; alte Datenbankfelder (`yesterdayStock`, `consumed`) bleiben aus Abwärtskompatibilitäts-Gründen für alle 255+ Tests erhalten.
  - `models/ActivityLog.js`: Neue Collection mit 90-Tage-TTL-Index auf `createdAt`.
  - `routes/products.js`: Route `GET /api/products/activity` bewusst **vor** allen `/:id`-Routen registriert (kein `CastError`-Konflikt); protokolliert `stock`, `create`, `update`, `delete` und `reset` mit `oldStock` → `newStock` und `userName`; fällt bei alten Produkten mit `updatedBy === null` sauber ohne `"null"`/`"undefined"` zurück.
  - `middleware/auth.js` & `routes/users.js`: 5s-In-Memory-User-Cache (in `NODE_ENV=test` deaktiviert) mit sofortiger Invalidierung (`invalidateUserCache`).
  - `backend/README.md`: `GET /api/products/activity` dokumentiert (`doku.test.js`).

### 16. `services/telegram.js`, `services/exportBuilder.js`, `routes/reports.js` & Frontend (`shared.js`, `shared.css`, `dashboard.*`, `reports.*`, `analytics.*`, `KURZANLEITUNG.md`)

- **Nachher:**
  - **Telegram (`liveOnly: true`):** Blendet `Verbrauch seit Mitternacht` und `(−X)` aus und zeigt nur `Gesamtbestand`, aktuellen Produktbestand und ggf. den Zählernamen.
  - **Excel & PDF:** Spalte `Verbrauch` entfernt; neue Spalten `Aktueller Bestand` und `Zuletzt gezählt` (ohne `undefined`/`null`).
  - **Online-Kühlhaus-Speicher-UX (`shared.js` + `dashboard.js` + `shared.css`):** Schlägt das Speichern mangels WLAN im Kühlhaus fehl, bleibt die getippte Zahl als `fehlerWert` rot markiert im Eingabefeld mit Warnung `⚠️ Nicht gespeichert` und Knopf `↻ Erneut senden`; erst nach `200 OK` erscheint `✓ Gespeichert`.
  - **Live-Protokoll-Drawer (`dashboard.html` + `dashboard.js`):** Knopf `📋 Protokoll` in der Topbar lädt `GET /api/products/activity` in Echtzeit (alles über `escapeHtml()`, `fmtTime()`, `fmtRelative()`, `fmtNum()` maskiert für `html-senken.test.js`).
  - **Cache-Busting:** CSS-Links auf `/assets/shared.css?v=2.2` aktualisiert.
