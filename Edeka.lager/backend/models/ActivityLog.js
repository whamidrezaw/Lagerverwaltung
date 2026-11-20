'use strict';
const mongoose = require('mongoose');

/**
 * Server-seitiges Aktivitäts-Protokoll (Phase M — Live-Bestandstafel).
 *
 * Hält jede Bestandsänderung und Produktaktion zentral in MongoDB fest,
 * damit die Marktleitung am Büro-PC jederzeit in Echtzeit sieht, welcher
 * Mitarbeiter wann welchen Bestand im Kühlhaus/Lager gezählt oder geändert hat.
 *
 * DSGVO & Speicherhygiene: Einträge laufen nach 90 Tagen automatisch über
 * einen MongoDB-TTL-Index ab.
 */
const activityLogSchema = new mongoose.Schema({
  action: {
    type: String,
    enum: ['stock', 'create', 'update', 'delete', 'reset'],
    required: true
  },
  productId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
  productName: { type: String, required: true, trim: true, maxlength: 120 },
  emoji:       { type: String, default: '📦', maxlength: 16 },
  category:    { type: String, default: '', maxlength: 60 },
  unit:        { type: String, default: '', maxlength: 30 },
  isBio:       { type: Boolean, default: false },
  oldStock:    { type: Number, default: null },
  newStock:    { type: Number, default: null },
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  userName:    { type: String, required: true, trim: true, maxlength: 100 },
  userRole:    { type: String, default: 'lagerist', maxlength: 30 },
  createdAt:   { type: Date, default: Date.now }
});

// Schnelle Abfrage der jüngsten Einträge + automatische Löschung nach 90 Tagen (TTL)
activityLogSchema.index({ createdAt: -1 });
activityLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

module.exports = mongoose.model('ActivityLog', activityLogSchema);
