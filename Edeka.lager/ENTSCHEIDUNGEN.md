# Entscheidungen — EDEKA Lagerverwaltung

Warum die App so gebaut ist, wie sie ist. Jede Entscheidung mit dem Anlass,
der Wahl und dem, was daraus folgt. Wer etwas davon ändern will, liest zuerst
hier nach — viele Regeln sehen umständlich aus und verhindern einen Fehler,
der schon einmal passiert ist.

Die Skripte, mit denen jede Änderung eingespielt wurde, liegen in `tools/`.

---

## 1. Gleichzeitige Bestandsänderungen: optimistische Sperre (Phase E)

**Anlass:** Zwei Geräte ändern denselben Bestand; die spätere Änderung
überschrieb die frühere unbemerkt.
**Entscheidung:** Jede Änderung schickt die Version mit, die sie gesehen hat
(`updatedAt`, Pflicht). Passt sie nicht mehr, antwortet der Server mit 409.
**Folgen:** Kein Wert geht still verloren. Der Browser zeigt einen Konflikt an
und lädt den aktuellen Stand.

## 2. Anmeldegrenzen je Benutzer, mit einer Decke je Adresse (Phase E)

**Anlass:** Eine ganze Filiale teilt sich eine öffentliche Adresse. Eine Grenze
nur je Adresse sperrt alle, sobald einer sich oft vertippt.
**Entscheidung:** Zuerst eine Grenze je Benutzername (10), dann eine hohe Decke
je Adresse (100 in 15 Minuten, `LOGIN_IP_LIMIT`).
**Folgen:** Rateversuche auf ein Konto werden gebremst, die Filiale nicht. Die
Zähler liegen im Speicher und beginnen nach einem Neustart neu — für einen
einzelnen Server annehmbar.

## 3. CORS standardmäßig geschlossen (Phase E)

**Anlass:** Die Oberfläche kommt vom selben Server und braucht keine Freigabe.
**Entscheidung:** Fremde Origins nur über `CORS_ORIGINS`, leer ist die Regel.
**Folgen:** Keine fremde Seite kann die API aus dem Browser eines angemeldeten
Nutzers heraus lesen.

## 4. Nur JSON als Eingabe (Phase E)

**Anlass:** Der Parser für Formulardaten war eingebunden, aber ungenutzt — eine
zweite, ungeprüfte Tür.
**Entscheidung:** Kein `express.urlencoded`; das Anmeldeformular sendet JSON.
**Folgen:** Eine Eingabeform weniger, die geprüft werden muss.

## 5. Bestand: Anzeige sofort, Speichern gebündelt

**Anlass:** Schnelles Klicken auf ± über eine langsame Verbindung schickte
mehrere Anfragen mit veralteter Version — der Server meldete Konflikte, die
keine waren.
**Entscheidung:** Kein Sperren der Knöpfe. Die Anzeige ändert sich sofort; nach
400 ms Ruhe geht **eine** Anfrage mit dem Endwert. Anfragen je Produkt
nacheinander, jede mit der Version der vorigen Antwort (`createBestandsschreiber`
in `shared.js`).
**Folgen:** Wer wartet, merkt nichts. Echte Konflikte mit anderen Geräten
bleiben sichtbar.

## 6. Kein JavaScript im Markup (Phase F)

**Anlass:** helmet setzt `script-src-attr 'none'`. Alle 70 `onclick="…"` der
Seiten waren deshalb von Anfang an tot. Ein Kategoriename mit Anführungszeichen
konnte außerdem aus einem `onclick`-Text ausbrechen.
**Entscheidung:** Seitenskripte in `assets/*.js`; Knöpfe tragen
`data-action="name"`, ein einziger Listener am Dokument ruft die registrierte
Funktion. Die CSP bleibt streng: `script-src-attr 'none'`, und seit G1
`script-src 'self'` ohne `'unsafe-inline'`.
**Folgen:** Eingeschleustes HTML kann keinen Code ausführen. Tests
(`inline-handler`, `csp-markup`, `csp-skripte`) halten Markup und CSP zusammen.

## 7. Alles aus Daten durch `escapeHtml` (Phasen F und G)

**Anlass:** Rohdaten im HTML brechen die Darstellung — und sind die erste Stufe
eines Angriffs, sobald eine andere Schutzschicht fehlt. Ein Einheitenname kam
über einen Umweg ohne einziges Tag ins HTML.
**Entscheidung:** Jeder Wert in `innerHTML` ist maskiert oder nachweislich
harmlos. `test/unit/html-senken.test.js` verfolgt jeden Wert bis zur Senke —
und prüft sich selbst an absichtlich unsicheren Beispielen.
**Folgen:** Neuer Code mit Rohdaten im HTML fällt im Test auf, nicht beim Kunden.

## 8. Die App lauscht nur auf 127.0.0.1 (Phase D)

**Anlass:** Der Server lauschte auf allen Adressen. Mit `TRUST_PROXY=true` hätte
jeder Client seine Adresse selbst angeben können.
**Entscheidung:** Standard `HOST=127.0.0.1`. `TRUST_PROXY=true` zusammen mit
einer Adresse im Netz verweigert den Start. Ein Fehler beim Lauschen beendet
den Prozess, statt Erfolg zu melden.
**Folgen:** Erreichbar nur über den Proxy auf demselben Rechner. Die App sieht
die echte Adresse der Nutzer.

## 9. Betrieb über systemd (Phase D)

**Anlass:** Ein abgerissenes SSH beendete den von Hand gestarteten Server.
**Entscheidung:** Dienst `edeka-lager`: startet beim Booten nach Docker,
startet nach einem Absturz neu, gibt nach fünf Abstürzen in zwei Minuten auf.
**Folgen:** Unabhängig von jeder Sitzung. Nachgewiesen mit einem absichtlichen
`SIGKILL` und zwei echten Neustarts des Servers.

## 10. MongoDB mit benannten Volumes (Phase D)

**Anlass:** Die Daten lagen in einem namenlosen Volume. Jedes `docker rm` hätte
den nächsten Container mit einer leeren Datenbank starten lassen — am 17.09.
ist das einmal geschehen.
**Entscheidung:** Umzug nach `edeka-mongo-daten` und `edeka-mongo-config`, mit
Prüfung jeder Sammlung und automatischer Rückkehr bei jedem Fehler.
**Folgen:** Container lassen sich ersetzen, ohne Daten zu verlieren.

## 11. Sicherungen, die ihre Wiederherstellung beweisen (Phase D)

**Anlass:** Eine Sicherung, die nie zurückgespielt wurde, ist eine Hoffnung.
**Entscheidung:** Jede nächtliche Sicherung wird sofort in eine eigene Datenbank
zurückgespielt und je Sammlung verglichen — Dokumente und Indizes. Nur dann
bleibt sie liegen. Die ausgewerteten Formate stammen aus dem Quelltext von
mongo-tools 100.18.0, nicht aus dem Gedächtnis.
**Folgen:** Jede vorhandene Sicherung ist nachweislich brauchbar. Offen: eine
Kopie außerhalb des Servers.

## 12. Zugang: DuckDNS, vorhandenes nginx, Let's Encrypt (Phase D)

**Anlass:** Die Adresse des Übergangs-Tunnels änderte sich bei jedem Neustart.
**Entscheidung:** Gegen Cloudflare mit eigener Domain (Kosten) und Tailscale
(App auf jedem Gerät): kostenlos, und nginx lief schon für kural. Zertifikat
per `webroot`, damit certbot die nginx-Konfiguration nicht selbst umschreibt;
zuerst ein Probelauf gegen die Testumgebung.
**Folgen:** Feste Adresse mit HTTPS. Port 443 muss in der Oracle-Konsole und in
`iptables` offen sein.

## 13. Firewall-Regeln von Hand, nie `netfilter-persistent save` (Phase D)

**Anlass:** Auf einem Server mit Docker enthält die laufende Firewall auch
Dockers eigene Regeln.
**Entscheidung:** `rules.v4` wird um genau die nötige Zeile ergänzt — vor dem
abschließenden `REJECT` — und vorher mit `iptables-restore --test` geprüft.
**Folgen:** Nach dem Neustart gelten genau die gewollten Regeln, ohne Reste aus
dem Betrieb.

## 14. Veröffentlichtes Geheimnis: austauschen statt Geschichte umschreiben (S1)

**Anlass:** Ein ZIP mit einer `.env` lag von Juli bis September öffentlich im
Repository; darin ein echter `JWT_SECRET`. Die Suche im Text hatte es nicht
gefunden — ein ZIP ist binär.
**Entscheidung:** Den Schlüssel des Servers mit dem veröffentlichten vergleichen
(nur im Speicher) und bei Gleichheit austauschen; das ZIP entfernen; versionierte
Archive und `.env`-Dateien per Test verbieten. Die Git-Geschichte bleibt, wie
sie ist — nach dem Austausch steht dort nur ein wertloser Wert. So empfiehlt es
auch GitHub: erst austauschen, dann bei Bedarf bereinigen.
**Folgen:** Kein gültiges Geheimnis im Repository. Alte Commits bleiben lesbar.

## 15. Kopie außer Haus: verschlüsselt in ein privates GitHub-Repository (H3)

**Anlass:** Alle Sicherungen lagen auf demselben Server. Mit dem Server — oder
dem kostenlosen Oracle-Konto — wären sie mit weg gewesen.
**Entscheidung:** Nach jeder erfolgreichen Sicherung schiebt
`tools/extern-sicherung.sh` jede noch fehlende geprüfte Sicherung in ein
privates GitHub-Repository, verschlüsselt mit age und einem öffentlichen
Schlüssel. Der Server kann verschlüsseln, aber nichts entschlüsseln; der
private Schlüssel liegt nur beim Betreiber. Zugang über einen Deploy-Key nur
für dieses Repository, geschoben wird nie mit Gewalt. Verworfen: Oracle Object
Storage (dasselbe Konto), Google Drive (Token mit weitem Zugriff), der eigene
Rechner (nicht immer an).
**Folgen:** Die Daten überleben den Server. Die Sicherungen enthalten
Personendaten — Namen, Anmeldeprotokolle —, GitHub sieht davon nur
Chiffretext. Ohne den privaten Schlüssel ist die Kopie wertlos; er muss an zwei
Orten liegen.

## 16. Überwachung von außen: Healthchecks.io als Totmannschalter (H2)

**Anlass:** Ein ausgefallener Server kann nicht melden, dass er ausgefallen
ist. Bis hierher hätte niemand eine gescheiterte Sicherung, eine stehende App
oder ein ablaufendes Zertifikat bemerkt.
**Entscheidung:** Der Server schickt Lebenszeichen an Healthchecks.io: nach
jeder Sicherung, nach jeder Kopie außer Haus, alle 5 Minuten über die
öffentliche Adresse — das prüft nginx, Zertifikat, DNS und App zugleich — und
täglich die Restlaufzeit des Zertifikats. Fehler meldet er sofort an `/fail`.
Benachrichtigt wird von Healthchecks.io per E-Mail und Telegram; auf dem
Server liegt kein Bot-Token. Die Prüfungen nehmen nur POST an, und vom
Protokoll der App geht nichts hinaus. Verworfen: ein Telegram-Bot auf dem
Server (kann den eigenen Ausfall nicht melden, ein weiteres Geheimnis), E-Mail
vom Server (SMTP-Zugang als Geheimnis), ntfy (öffentliche Themen).
**Folgen:** Stille fällt spätestens nach 15 Minuten auf. Fällt Healthchecks.io
selbst aus, bleiben Alarme aus — für einen einzelnen Laden hingenommen.

## 17. Bei Ubuntu 24.04 LTS bleiben (H4)

**Anlass:** Der Server meldet eine neue Ubuntu-Version (26.04).
**Entscheidung:** Kein Wechsel im laufenden Betrieb. 24.04 LTS bekommt
Sicherheitsupdates bis 2029, und die werden eingespielt. Ein Versionswechsel
ändert Node, nginx und viele Bibliotheken auf einmal — er kommt nur geplant:
mit frischer Sicherung, zuerst an einer Kopie erprobt, mit `abnahme.sh` danach.
**Folgen:** Eine ruhige Grundlage für den Laden; der Wechsel ist eine eigene
Aufgabe, spätestens 2029.

## 18. Telegram ist eine Zugabe, kein Muss (I)

**Anlass:** Telegram ist auf dem Server absichtlich nicht eingerichtet. Trotzdem
bekam jeder, der „Bericht senden“ drückte, eine rote Meldung mit den Namen von
`.env`-Variablen — jedes Mal. Wer täglich rote Meldungen sieht, übersieht bald
auch die echten.
**Entscheidung:** Nicht eingerichtet ist kein Fehler: Der Bericht wird
gespeichert, ohne Versuch und ohne Warnung (`telegram: "aus"`). Nur ein
gescheiterter Versand bei eingerichtetem Telegram bleibt eine Warnung (207).
**Folgen:** Rot heißt wieder „hier stimmt etwas nicht“. Wer Telegram später
will, trägt Bot-Token und Chat in die `.env` ein — ohne Codeänderung.

## 19. Typsichere Text- und Passwortprüfung sowie Schutz vor Tabellen-Formelinjektion (Phase J)

**Anlass:** Die Middleware `rejectMongoOperators` wehrt Objekte mit `$` ab,
lässt aber Arrays und Zahlen durch. Dadurch ließ `password.length < 6` ein
Array mit sechs Elementen (`[1,2,3,4,5,6]`) passieren, woraufhin `bcrypt.hash`
bzw. `bcrypt.compare` mit einem unbehandelten Typfehler (500) abstürzte. Ebenso
führten Nicht-String-Werte für `name` oder `scope` bei `.trim()` und
`.toLowerCase()` zu 500-Abstürzen statt zu 400-Antworten, und überlange
Passwörter konnten Bcrypt unnötig beschäftigen. Zudem wurden Produkt-,
Kategorie- und Einheitsnamen beim Excel-/CSV-Export unverändert in Zellen
geschrieben: beginnt ein solcher Name mit `=`, `+`, `-` oder `@`, wertet Excel
ihn beim Öffnen als Formel aus (OWASP CSV / Formula Injection).
**Entscheidung:** Reine Prüffunktionen in `lib/validate.js`
(`parseNonEmptyString`, `parseUsername`, `parsePassword`,
`sanitizeSpreadsheetCell`) prüfen Typ, Randleerzeichen und Längengrenzen (u. a.
Passwort maximal 128 Zeichen) vor jeder Datenbank- oder Bcrypt-Operation.
Textzellen im Excel- (`services/exportBuilder.js`) und CSV-Export
(`frontend/assets/shared.js`) erhalten bei führenden Formelzeichen ein
vorangestelltes Hochkomma (`'`).
**Folgen:** Ungültige Eingabetypen liefern durchgängig `400` statt `500`,
Benutzernamen werden beim Login genau wie im Ratenbegrenzer normalisiert, und
exportierte Tabellen führen keine eingeschleusten Formeln mehr aus.

## 20. Atomares Zurücksetzen der Bestände und vollständige Tastaturbedienung der Dialoge (Phase J)

**Anlass:** `POST /api/reports/reset-stock` lud noch alle aktiven Produkte in
den Speicher und schickte je Produkt ein einzelnes `findByIdAndUpdate` (N+1),
obwohl `closeDay` bereits in C1 auf `updateMany` umgestellt worden war. Im
Frontend suchte der Außenklick-Listener für das Verlaufs-Panel in `users.js`
noch nach `[onclick*="openLogPanel"]` statt nach
`[data-action="protokollOeffnen"]`, und die `Escape`-Taste schloss Dialoge nur
auf `users.html`, nicht aber auf `dashboard.html` und `reports.html`.
**Entscheidung:** `reset-stock` nutzt ein einziges atomares
`Product.updateMany`; `users.js` prüft `[data-action="protokollOeffnen"]`
(abgesichert durch `inline-handler.test.js`); `dashboard.js` und `reports.js`
schließen ihre Dialoge ebenfalls bei `Escape`.
**Folgen:** Ein Datenbankaufruf statt `N` beim Zurücksetzen, konsistente
Tastaturbedienung auf allen Seiten und kein verwaister `onclick`-Selektor mehr.

## 21. Mobile-First-Ergonomie, Touch-Ziele und responsive Kartenansicht (Phase K)

**Anlass:** Die Anwendung wird im Lager primär auf Smartphones bedient und
sekundär am Desktop-Monitor. Vier konkrete Probleme erschwerten die mobile
Bedienung:
1. Zu kleine und zu eng beieinander liegende Bedienelemente: `.step-btn` (`28px`)
   und `.row-act` (`28px`, `gap: 4px`) führten beim Zählen im Gang leicht zu
   Fehltipps zwischen `+`, `✏️` und `🗑️`.
2. Inline-Stile (`style="grid-template-columns: repeat(4, 1fr)"` auf
   `#overall-kpi-grid` in `dashboard.html` und `repeat(3, 1fr)` auf
   `#trend-kpi-grid` in `analytics.html`) überschrieben die Media Queries in
   `shared.css` und quetschten 4 bzw. 3 KPI-Karten nebeneinander auf schmale
   Smartphone-Bildschirme.
3. In `users.html` fehlte die Klasse `.form-footer`, und Suchfeld + Knöpfe in
   `.topbar-right` liefen auf Smartphones über.
4. Breite Tabellen (`#product-tbody`, `#history-tbody`, `#users-tbody`) hatten
   `overflow: hidden` auf `.table-wrap` und drängten auf Smartphones alle
   Spalten in eine schmale Zeile.
**Entscheidung:**
- Touch-Ziele und Abstände in `frontend/assets/shared.css` vergrößert
  (`.step-btn` und `.row-act` `36px` am Desktop, `40px`/`38px` mobil, `gap: 8px`
  in `.stepper` und `.row-acts`, `.form-footer` definiert, `font-size: 16px` für
  Eingabefelder auf Mobilgeräten gegen ungewollten Browser-Zoom).
- Inline-`grid-template-columns` auf `#overall-kpi-grid` und `#trend-kpi-grid`
  durch `.kpi-grid` bzw. `.kpi-grid-3` ersetzt (mobil 2 kompakte Karten pro
  Zeile).
- Unter `@media (max-width: 640px)` werden die Zeilen in `#product-tbody`,
  `#history-tbody` und `#users-tbody` rein per CSS Grid/Flexbox als übersichtliche
  zweizeilige Karten dargestellt, ohne das DOM oder die JS-Templates zu ändern.
- Abgesichert durch `backend/test/unit/mobile-ui.test.js`.
**Folgen:** Sichere Einhandbedienung auf dem Smartphone ohne Fehltipps und ohne
horizontales Quetschen, bei unverändert klarem Tabellen-Layout auf Desktop- und
Laptop-Monitoren.

## 22. Produkt-Reaktivierung, Telegram-Timeout, Graceful Shutdown und Dezimalrundung (Phase L)

**Anlass:** Im Rahmen des 360°-Audits wurden fünf betriebsrelevante Lücken
identifiziert:
1. Gelöschte Produkte (`DELETE /api/products/:id` setzt `isActive: false`)
   blieben im eindeutigen Index `{ name, isBio, unit }` stehen und verhinderten
   ein späteres Wiederanlegen derselben Variante (`E11000 Duplicate Key`).
2. `sendTelegram()` rief `fetch()` ohne `AbortSignal.timeout()` auf.
3. `server.js` behandelte weder `SIGTERM` noch `SIGINT` für ein geordnetes
   Herunterfahren bei `systemd`-Neustarts.
4. Dezimale Bestandsdifferenzen (`0.3 - 0.1`) erzeugten IEEE-754-Artefakte
   (`0.19999999999999998`) in Berichten und Exporten.
5. `PUT /api/users/:id` speicherte leere `telegramChatId`-Strings als `""` statt
   `null`, `PUT /api/categories/:id` und `PUT /api/units/:id` prüften `order`
   nicht auf ganze Zahlen, und `createAdmin.js` suchte `username` vor der
   Kleinschreibung.
**Entscheidung:**
- `POST /api/products` reaktiviert einen vorhandenen `isActive: false`-Datensatz
  derselben Variante mit zurückgesetzten Beständen (`currentStock` und
  `yesterdayStock` auf den neuen Startwert).
- `services/telegram.js` begrenzt `fetch()` mit `AbortSignal.timeout(10000)`.
- `server.js` stoppt bei `SIGTERM`/`SIGINT` zuerst den Cron-Job, schließt den
  HTTP-Server und trennt danach die MongoDB-Verbindung.
- `roundStock()` in `lib/validate.js` rundet alle Bestands- und Verbrauchswerte
  auf höchstens 3 Nachkommastellen; `parseRole`, `parseTelegramChatId` und
  `parseOrder` sichern die API-Parität.
**Folgen:** Saisonale oder versehentlich deaktivierte Produkte lassen sich
problemlos wieder anlegen, Hänger der Telegram-API blockieren keine Anfragen,
Neustarts unter `systemd` laufen unterbrechungsfrei ab, und alle Zahlen in
Berichten sind frei von Gleitkommaartefakten.

## 23. Reine Live-Bestandstafel, Kühlhaus-Fehler-UX und Server-Aktivitätsprotokoll (Phase M)

**Anlass:** Im realen Filialbetrieb gibt es keine festen Zählzeiten — die
Marktleitung schickt Mitarbeiter bei Bedarf ins Lager/Kühlhaus und will am
Büro-PC sofort sehen, wie viel aktuell von jedem Artikel vorhanden ist, wann
und von wem er zuletzt gezählt wurde. Verbrauchszahlen (`Verbrauch` / `Gestern`)
lenkten auf der Oberfläche und in Exporten ab, `localStorage`-Protokolle waren
auf anderen Geräten unsichtbar, und ein kurzer WLAN-Ausfall im Kühlhaus setzte
die gerade eingetippte Zahl im Feld zurück.
**Entscheidung:**
- **Kompatibler Kern, saubere Darstellung:** `yesterdayStock` und `consumed`
  bleiben im Datenbankschema erhalten, damit alle über 250 automatisierten
  Tests weiter greifen; Dashboard, Telegram (`liveOnly: true`), Excel und PDF
  zeigen ausschließlich `Aktueller Bestand` sowie `Zuletzt gezählt` (Uhrzeit +
  `updatedByName`, sicher gegen `null`/`undefined`).
- **Kühlhaus-Online-UX:** Keine Offline-Warteschlange; schlägt `PATCH /stock`
  wegen Funkloch fehl, bleibt die eingetippte Zahl rot im Eingabefeld mit
  `↻ Erneut senden` und wird erst nach `200 OK` grün bestätigt (`✓ Gespeichert`).
- **Server-seitiges `ActivityLog`:** Neue Collection in MongoDB mit
  90-Tage-TTL-Index (DSGVO-konform) und Route `GET /api/products/activity` (vor
  `/:id` registriert), angebunden an den neuen Drawer `📋 Protokoll`.
- **5s-Auth-Cache:** `middleware/auth.js` puffert die Benutzerprüfung 5 Sekunden
  lang im Speicher (sofort invalidiert in `routes/users.js`, deaktiviert bei
  `NODE_ENV=test`).
**Folgen:** Maximale Übersicht beim Zählen im Kühlhaus, sofortige Transparenz
am Büro-PC über alle Geräte hinweg und 100 % grüne Abwärtskompatibilität.

---

## Arbeitsweise

- **Jede Änderung als Skript** in `tools/`: prüft den Ausgangszustand, legt
  zuerst einen Test an, der rot ist, ändert alles oder nichts und zeigt den Test
  danach grün.
- **Merge-Commits statt Squash**, damit jeder Schritt einzeln nachvollziehbar
  bleibt.
- **Testergebnisse am Exit-Code ablesen, nie am Text:** Das Ausgabeformat von
  `node --test` hängt von der Node-Version ab. S1 las `# fail 0` und meldete auf
  dem Server einen grünen Test als rot.
- **Am echten Quelltext prüfen, nicht am Gedächtnis:** Formate von Werkzeugen
  aus deren Quellen, Anker am echten Repository, Wirkung im echten Browser.
