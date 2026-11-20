require('dotenv').config();
const mongoose = require('mongoose');
const app      = require('./app');
const { scheduleDailyClose, catchUpIfNeeded } = require('./services/dailyClose');

// ── Fail-fast: ohne tragfähigen JWT_SECRET nicht starten ──────────
// Ohne Schlüssel startete der Server bisher normal und brach erst beim
// ersten Login mit einem 500er ab. Mit einem schwachen oder öffentlich
// bekannten Schlüssel liefe er sogar dauerhaft weiter — dann kann jeder
// ein Admin-Token fälschen. Beides ist schlimmer als ein Startabbruch.
const { checkJwtSecret, listenHost, checkProxyConfig } = require('./lib/validate');
const jwtProblem = checkJwtSecret(process.env.JWT_SECRET);
if (jwtProblem) {
  console.error('❌ Start abgebrochen: ' + jwtProblem);
  console.error('   Neuen Schlüssel erzeugen und in .env eintragen:');
  console.error('   node -e "console.log(\'JWT_SECRET=\' + require(\'crypto\').randomBytes(48).toString(\'base64url\'))" >> .env');
  process.exit(1);
}

// ── Fail-fast: TRUST_PROXY nur hinter einem Tunnel auf DIESER Maschine ─
const proxyProblem = checkProxyConfig(process.env);
if (proxyProblem) {
  console.error('❌ Start abgebrochen: ' + proxyProblem);
  process.exit(1);
}

// ── DB + Server Start ─────────────────────────────────────────────
mongoose.connect(process.env.MONGODB_URI, {
  serverSelectionTimeoutMS: 5000
})
  .then(() => {
    console.log('✅ MongoDB verbunden');
    // War der Server um Mitternacht aus, wurde der Tag nie geschlossen.
    // Das wird hier einmalig nachgeholt — absichtlich ohne await: schlägt es
    // fehl, soll der Server trotzdem starten.
    catchUpIfNeeded().catch(err =>
      console.error('❌ Nachholen des Tagesabschlusses fehlgeschlagen:', err.message));
    const cronTask = scheduleDailyClose();   // بستن خودکار روز هر شب ۰۰:۰۰ (Europe/Berlin)
    const PORT = parseInt(process.env.PORT) || 3000;
    const HOST = listenHost(process.env);
    // Express 5 übergibt einen Fehler beim Lauschen (etwa: Port belegt) an
    // diesen Callback. Früher wurde er übergangen und trotzdem "läuft"
    // gemeldet — ein Prozess, der Erfolg vortäuscht und nichts ausliefert.
    const server = app.listen(PORT, HOST, (err) => {
      if (err) {
        console.error(`❌ Kann nicht auf ${HOST}:${PORT} lauschen: ${err.code || err.message}`);
        process.exit(1);
      }
      console.log(`✅ Server läuft auf ${HOST}:${PORT} [${process.env.NODE_ENV || 'development'}]`);
    });
    server.requestTimeout = 30000;
    server.headersTimeout = 35000;
    server.keepAliveTimeout = 65000;

    // ── Graceful Shutdown (SIGTERM / SIGINT) ────────────────────────
    // Stoppt bei systemd-Neustarts zuerst den Mitternachts-Cron, lässt
    // laufende HTTP-Anfragen sauber zu Ende laufen und schließt danach
    // die MongoDB-Verbindung, bevor der Prozess beendet wird.
    let shuttingDown = false;
    const shutdown = (signal) => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`🛑 ${signal} empfangen — fahre Server kontrolliert herunter...`);

      const forceTimer = setTimeout(() => {
        console.error('⚠️ Zeitüberschreitung beim Herunterfahren — erzwinge Prozessende');
        process.exit(1);
      }, 10000);
      if (typeof forceTimer.unref === 'function') forceTimer.unref();

      try {
        if (cronTask && typeof cronTask.stop === 'function') cronTask.stop();
      } catch {}

      server.close(() => {
        mongoose.disconnect()
          .then(() => {
            console.log('✅ Server und MongoDB-Verbindung sauber geschlossen');
            process.exit(0);
          })
          .catch(err => {
            console.error('❌ Fehler beim Schließen der MongoDB-Verbindung:', err.message);
            process.exit(1);
          });
      });
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT',  () => shutdown('SIGINT'));
  })
  .catch(err => {
    console.error('❌ MongoDB Verbindungsfehler:', err.message);
    process.exit(1);
  });

