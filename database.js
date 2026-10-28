/**
 * eParkNiyantran - Smart Parking Management System - Database Layer
 * Implements persistent SQLite database via Node's native node:sqlite.
 */

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const { MOCK_MPARIVAHAN_DATABASE } = require('./ocr');
const { DEFAULT_TARIFF } = require('./billing');

const DB_PATH = path.join(__dirname, 'data', 'smart_parking.db');

// Ensure data directory exists
if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
}

const db = new DatabaseSync(DB_PATH);

// Enable WAL mode for high concurrency
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA busy_timeout = 5000;');

/**
 * Initialize Tables
 */
function initializeDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS vehicles (
      plate TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      owner_name TEXT,
      phone TEXT,
      make_model TEXT,
      color TEXT,
      rc_status TEXT DEFAULT 'ACTIVE',
      is_banned INTEGER DEFAULT 0,
      ban_until TEXT,
      has_pending_fine INTEGER DEFAULT 0,
      pending_fine_amount REAL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS slots (
      slot_id TEXT PRIMARY KEY,
      category TEXT NOT NULL, -- '2W' or '4W'
      zone TEXT NOT NULL,
      is_occupied INTEGER DEFAULT 0,
      current_session_id TEXT,
      sensor_status TEXT DEFAULT 'ONLINE',
      hardware_esp32_id TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      vehicle_plate TEXT NOT NULL,
      slot_id TEXT NOT NULL,
      category TEXT NOT NULL,
      entry_time TEXT NOT NULL,
      exit_time TEXT,
      expected_exit_time TEXT,
      status TEXT NOT NULL, -- 'ACTIVE', 'PENDING_PAYMENT', 'COMPLETED', 'OVERDUE', 'MISSING_EXIT', 'TOWED'
      tariff_version TEXT NOT NULL,
      duration_seconds INTEGER DEFAULT 0,
      tier_label TEXT,
      basic_amount REAL DEFAULT 0,
      fine_amount REAL DEFAULT 0,
      total_amount REAL DEFAULT 0,
      agency_share REAL DEFAULT 0,
      facility_share REAL DEFAULT 0,
      operator_entry_id TEXT NOT NULL,
      operator_exit_id TEXT,
      bill_number TEXT,
      is_prepaid INTEGER DEFAULT 0,
      five_min_reminder_sent INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (vehicle_plate) REFERENCES vehicles(plate),
      FOREIGN KEY (slot_id) REFERENCES slots(slot_id)
    );

    CREATE TABLE IF NOT EXISTS evidence (
      evidence_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      capture_type TEXT NOT NULL, -- 'ENTRY_FRONT', 'EXIT_REAR'
      image_data TEXT, -- Base64 or image URI
      ocr_raw TEXT,
      ocr_confidence REAL,
      manual_correction INTEGER DEFAULT 0,
      corrected_by_operator_id TEXT,
      notes TEXT,
      timestamp TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(session_id)
    );

    CREATE TABLE IF NOT EXISTS payments (
      payment_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      vehicle_plate TEXT NOT NULL,
      provider_ref TEXT,
      amount REAL NOT NULL,
      status TEXT NOT NULL, -- 'PENDING', 'SUCCESS', 'FAILED'
      method TEXT NOT NULL, -- 'UPI_QR', 'CARD', 'NETBANKING', 'CASH_ATTENDANT'
      confirmation_timestamp TEXT,
      reconciliation_status TEXT DEFAULT 'VERIFIED',
      signature_hash TEXT,
      FOREIGN KEY (session_id) REFERENCES sessions(session_id)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      notification_id TEXT PRIMARY KEY,
      session_id TEXT,
      recipient_phone TEXT NOT NULL,
      message_type TEXT NOT NULL, -- 'ENTRY_WELCOME', 'FIVE_MIN_REMINDER', 'PAYMENT_LINK', 'PAYMENT_RECEIPT', 'OVERDUE_ALERT', 'TOWING_NOTICE'
      message_body TEXT NOT NULL,
      dlt_template_id TEXT,
      status TEXT NOT NULL, -- 'QUEUED', 'SENT', 'FAILED'
      scheduled_time TEXT NOT NULL,
      sent_time TEXT,
      retry_count INTEGER DEFAULT 0,
      failure_reason TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_events (
      audit_id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      operator_id TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      reason TEXT,
      timestamp TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tariff_configs (
      config_key TEXT PRIMARY KEY,
      config_value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS complaints (
      ticket_id TEXT PRIMARY KEY,
      session_id TEXT,
      vehicle_plate TEXT,
      complainant_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      category TEXT NOT NULL, -- 'TARIFF_OVERCHARGE', 'SLOT_ISSUE', 'PAYMENT_FAILURE', 'STAFF_BEHAVIOR', 'CLEANLINESS', 'GENERAL_FEEDBACK'
      rating INTEGER DEFAULT 5, -- 1 to 5
      message TEXT NOT NULL,
      status TEXT DEFAULT 'OPEN', -- 'OPEN', 'INVESTIGATING', 'RESOLVED'
      resolution_notes TEXT,
      resolved_by_operator_id TEXT,
      resolved_at TEXT,
      created_at TEXT NOT NULL
    );
  `);

  // Migrate schema for expected_exit_time, bill_number, is_prepaid if not present
  try {
    const sessionCols = db.prepare('PRAGMA table_info(sessions)').all().map(c => c.name);
    if (!sessionCols.includes('expected_exit_time')) {
      db.exec('ALTER TABLE sessions ADD COLUMN expected_exit_time TEXT;');
    }
    if (!sessionCols.includes('bill_number')) {
      db.exec('ALTER TABLE sessions ADD COLUMN bill_number TEXT;');
    }
    if (!sessionCols.includes('is_prepaid')) {
      db.exec('ALTER TABLE sessions ADD COLUMN is_prepaid INTEGER DEFAULT 0;');
    }
  } catch (err) {
    console.warn('Migration note:', err.message);
  }

  // Seed default slots if not already populated
  const slotCount = db.prepare('SELECT COUNT(*) as count FROM slots').get().count;
  if (slotCount === 0) {
    const insertSlot = db.prepare(`
      INSERT INTO slots (slot_id, category, zone, is_occupied, current_session_id, sensor_status, hardware_esp32_id)
      VALUES (?, ?, ?, 0, NULL, 'ONLINE', ?)
    `);

    // 12 Two-Wheeler bays (Zone A)
    for (let i = 1; i <= 12; i++) {
      const slotId = `2W-${String(i).padStart(2, '0')}`;
      insertSlot.run(slotId, '2W', 'Zone A (Two-Wheelers)', `ESP32-NODE-2W-${i}`);
    }

    // 16 Four-Wheeler bays (Zone B)
    for (let i = 1; i <= 16; i++) {
      const slotId = `4W-${String(i).padStart(2, '0')}`;
      insertSlot.run(slotId, '4W', 'Zone B (Four-Wheelers)', `ESP32-NODE-4W-${i}`);
    }
  }

  // Seed initial mock vehicles
  const vehicleCount = db.prepare('SELECT COUNT(*) as count FROM vehicles').get().count;
  if (vehicleCount === 0) {
    const insertVehicle = db.prepare(`
      INSERT INTO vehicles (plate, category, owner_name, phone, make_model, color, rc_status, is_banned, ban_until, has_pending_fine, pending_fine_amount, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const [plate, v] of Object.entries(MOCK_MPARIVAHAN_DATABASE)) {
      insertVehicle.run(
        plate,
        v.category,
        v.owner,
        v.phone,
        v.makeModel,
        v.color,
        v.rcStatus,
        v.isBanned ? 1 : 0,
        v.banUntil,
        v.hasPendingFine ? 1 : 0,
        v.pendingFineAmount,
        new Date().toISOString()
      );
    }
  }

  // Seed active tariff config if not present
  const tariffConfig = db.prepare('SELECT config_value FROM tariff_configs WHERE config_key = ?').get('active_tariff');
  if (!tariffConfig) {
    db.prepare('INSERT INTO tariff_configs (config_key, config_value, updated_at) VALUES (?, ?, ?)')
      .run('active_tariff', JSON.stringify(DEFAULT_TARIFF), new Date().toISOString());
  }

  // Seed sample complaints if empty
  const complaintCount = db.prepare('SELECT COUNT(*) as count FROM complaints').get().count;
  if (complaintCount === 0) {
    const insertComplaint = db.prepare(`
      INSERT INTO complaints (ticket_id, session_id, vehicle_plate, complainant_name, phone, category, rating, message, status, resolution_notes, resolved_by_operator_id, resolved_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertComplaint.run(
      'CMP-20261028-1001',
      null,
      'MH12AB1234',
      'Sanket Sondkar',
      '+91 98230 12345',
      'GENERAL_FEEDBACK',
      5,
      'Excellent entry bill slip and fast automated barrier. Very clean parking bays in Zone B.',
      'RESOLVED',
      'Citizen feedback acknowledged and recorded.',
      'ADMIN-SUPERVISOR',
      new Date(Date.now() - 3600000).toISOString(),
      new Date(Date.now() - 7200000).toISOString()
    );

    insertComplaint.run(
      'CMP-20261028-1002',
      null,
      'MH14CD5678',
      'Amit Deshmukh',
      '+91 98901 87654',
      'TARIFF_OVERCHARGE',
      3,
      'Query regarding the ₹50 pending penalty slab applied during 15-minute grace window.',
      'OPEN',
      null,
      null,
      null,
      new Date(Date.now() - 1800000).toISOString()
    );
  }
}

/**
 * Record an audit log event
 */
function recordAudit(entityType, entityId, action, operatorId, oldValue, newValue, reason = '') {
  const auditId = 'AUD-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7);
  db.prepare(`
    INSERT INTO audit_events (audit_id, entity_type, entity_id, action, operator_id, old_value, new_value, reason, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    auditId,
    entityType,
    entityId,
    action,
    operatorId,
    typeof oldValue === 'object' ? JSON.stringify(oldValue) : String(oldValue || ''),
    typeof newValue === 'object' ? JSON.stringify(newValue) : String(newValue || ''),
    reason,
    new Date().toISOString()
  );
  return auditId;
}

initializeDatabase();

module.exports = {
  db,
  recordAudit,
  initializeDatabase
};
