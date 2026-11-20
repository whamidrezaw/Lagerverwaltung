'use strict';

// Guard-Test für Mobile-First-Ergonomie & Responsive-Layout (Phase K):
// 1. Touch-Ziele & Abstände in shared.css (.step-btn, .row-act, .row-acts, .form-footer, .kpi-grid-3).
// 2. Keine Inline-grid-template-columns auf #overall-kpi-grid oder #trend-kpi-grid,
//    damit Media Queries auf Smartphone-Bildschirmen greifen.
// 3. Mobile-Kartenansicht (@media (max-width: 640px)) für #product-tbody, #history-tbody, #users-tbody.

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('node:fs');
const path     = require('node:path');

const frontendDir = path.resolve(__dirname, '../../../frontend');
const sharedCss   = fs.readFileSync(path.join(frontendDir, 'assets/shared.css'), 'utf8');
const dashboardHtml = fs.readFileSync(path.join(frontendDir, 'dashboard.html'), 'utf8');
const analyticsHtml = fs.readFileSync(path.join(frontendDir, 'analytics.html'), 'utf8');

test('shared.css definiert ausreichende Abstände und Touch-Ziele für Stepper und Zeilenaktionen', () => {
  assert.match(sharedCss, /\.row-acts\s*\{[^}]*gap:\s*8px/s);
  assert.match(sharedCss, /\.stepper\s*\{[^}]*gap:\s*8px/s);
  assert.match(sharedCss, /\.form-footer\s*\{[^}]*display:\s*flex/s);
  assert.match(sharedCss, /\.kpi-grid-3\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*1fr\)/s);
});

test('shared.css enthält responsive Mobile-Card-Regeln für Produkt-, Berichts- und Benutzertabellen', () => {
  assert.match(sharedCss, /@media\s*\(max-width:\s*640px\)/);
  assert.match(sharedCss, /#product-tbody\s+tr\[data-id\]/);
  assert.match(sharedCss, /#history-tbody\s+tr:not\(:has\(td\[colspan\]\)\)/);
  assert.match(sharedCss, /#users-tbody\s+tr:not\(:has\(td\[colspan\]\)\)/);
});

test('dashboard.html und analytics.html überschreiben .kpi-grid nicht mehr mit Inline-grid-template-columns', () => {
  const overallMatch = dashboardHtml.match(/<div[^>]*id="overall-kpi-grid"[^>]*>/);
  assert.ok(overallMatch, '#overall-kpi-grid muss in dashboard.html existieren');
  assert.doesNotMatch(overallMatch[0], /grid-template-columns/);

  const trendMatch = analyticsHtml.match(/<div[^>]*id="trend-kpi-grid"[^>]*>/);
  assert.ok(trendMatch, '#trend-kpi-grid muss in analytics.html existieren');
  assert.doesNotMatch(trendMatch[0], /grid-template-columns/);
  assert.match(trendMatch[0], /kpi-grid-3/);
});

test('dashboard.html und analytics.html trennen Topbar-Titel und Aktionsknöpfe (🌓, ⚙️, Bericht senden) auf Mobilgeräten sauber in zwei Zeilen', () => {
  assert.match(dashboardHtml, /\.topbar-right\s*\{[^}]*width:\s*100%/s);
  assert.match(analyticsHtml, /\.topbar-right\s*\{[^}]*width:\s*100%/s);
  assert.match(sharedCss, /\.topbar-left\s*>\s*div\s*\{[^}]*min-width:\s*0/s);
});
