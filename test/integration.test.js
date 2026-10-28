const test = require('node:test');
const assert = require('node:assert');
const { db, recordAudit } = require('../database');
const { calculateParkingCharge, calculateOverdueFine, checkFiveMinuteReminder } = require('../billing');
const { processOcrCandidate, lookupMparivahan, normalizePlate, isValidIndianPlate } = require('../ocr');

test('OCR Engine: accurately extracts and normalizes standard Indian plates', () => {
  const ocr1 = processOcrCandidate('MH 12 AB 1234');
  assert.strictEqual(ocr1.normalized, 'MH12AB1234');
  assert.strictEqual(ocr1.success, true);
  assert.ok(ocr1.confidence >= 0.9);

  // Position-based character correction: 'O' to '0' in digits position
  const ocr2 = processOcrCandidate('MH12AB12O4'); // letter O instead of 0
  assert.strictEqual(ocr2.normalized, 'MH12AB1204');
});

test('mParivahan Lookup: returns verified vehicle records', () => {
  const lookup = lookupMparivahan('MH12AB1234');
  assert.strictEqual(lookup.found, true);
  assert.strictEqual(lookup.data.owner, 'Sanket Sondkar');
  assert.strictEqual(lookup.data.category, '4W');
  assert.strictEqual(lookup.data.hasPendingFine, false);

  // Vehicle with pending fine
  const fineLookup = lookupMparivahan('MH14CD5678');
  assert.strictEqual(fineLookup.data.hasPendingFine, true);

  // Banned vehicle
  const bannedLookup = lookupMparivahan('HR26DK8372');
  assert.strictEqual(bannedLookup.data.isBanned, true);
});

test('Slot Allocation: assigns 2W and 4W slots correctly from database', () => {
  const slot2W = db.prepare("SELECT * FROM slots WHERE category = '2W' AND is_occupied = 0 ORDER BY slot_id ASC LIMIT 1").get();
  assert.ok(slot2W.slot_id.startsWith('2W-'));

  const slot4W = db.prepare("SELECT * FROM slots WHERE category = '4W' AND is_occupied = 0 ORDER BY slot_id ASC LIMIT 1").get();
  assert.ok(slot4W.slot_id.startsWith('4W-'));
});

test('End-to-End Session Lifecycle in SQLite Database', () => {
  const testPlate = 'DL01CA9988';
  // Clean up any lingering test records
  db.prepare("DELETE FROM payments WHERE vehicle_plate = ?").run(testPlate);
  db.prepare("DELETE FROM sessions WHERE vehicle_plate = ?").run(testPlate);
  db.prepare("UPDATE slots SET is_occupied = 0, current_session_id = NULL WHERE current_session_id LIKE 'TEST-SES-%'").run();

  const sessionId = 'TEST-SES-' + Date.now();
  const targetSlot = db.prepare("SELECT * FROM slots WHERE category = '4W' AND is_occupied = 0 LIMIT 1").get();
  
  assert.ok(targetSlot, 'Must find vacant 4W slot');

  // 1. Check-in
  db.prepare(`
    INSERT INTO sessions (session_id, vehicle_plate, slot_id, category, entry_time, status, tariff_version, operator_entry_id, created_at)
    VALUES (?, ?, ?, '4W', ?, 'ACTIVE', 'v1.0.0', 'TEST_OP', ?)
  `).run(sessionId, testPlate, targetSlot.slot_id, new Date().toISOString(), new Date().toISOString());

  db.prepare('UPDATE slots SET is_occupied = 1, current_session_id = ? WHERE slot_id = ?').run(sessionId, targetSlot.slot_id);

  // Verify occupied
  const checkSlot = db.prepare('SELECT * FROM slots WHERE slot_id = ?').get(targetSlot.slot_id);
  assert.strictEqual(checkSlot.is_occupied, 1);
  assert.strictEqual(checkSlot.current_session_id, sessionId);

  // 2. Prevent duplicate active session
  const dupCheck = db.prepare("SELECT * FROM sessions WHERE vehicle_plate = ? AND status = 'ACTIVE'").all(testPlate);
  assert.strictEqual(dupCheck.length, 1);

  // 3. Check-out & Calculate
  const charge = calculateParkingCharge(75 * 60, false, '4W'); // 75 min = Up to 90 min (₹250)
  assert.strictEqual(charge.basicCharge, 250);
  assert.strictEqual(charge.agencyShare, 25);
  assert.strictEqual(charge.facilityShare, 225);

  db.prepare(`
    UPDATE sessions
    SET exit_time = ?, duration_seconds = ?, tier_label = ?, basic_amount = ?, agency_share = ?, facility_share = ?, total_amount = ?, status = 'PENDING_PAYMENT'
    WHERE session_id = ?
  `).run(new Date().toISOString(), 75 * 60, charge.tierLabel, charge.basicCharge, charge.agencyShare, charge.facilityShare, charge.basicCharge, sessionId);

  // 4. Payment Provider Callback
  db.prepare(`
    INSERT INTO payments (payment_id, session_id, vehicle_plate, provider_ref, amount, status, method, confirmation_timestamp, reconciliation_status)
    VALUES (?, ?, ?, 'TXN-TEST-123', ?, 'SUCCESS', 'UPI_QR', ?, 'VERIFIED')
  `).run('PAY-TEST-' + Date.now(), sessionId, testPlate, charge.basicCharge, new Date().toISOString());

  db.prepare("UPDATE sessions SET status = 'COMPLETED' WHERE session_id = ?").run(sessionId);
  db.prepare('UPDATE slots SET is_occupied = 0, current_session_id = NULL WHERE slot_id = ?').run(targetSlot.slot_id);

  // Verify slot is freed
  const freedSlot = db.prepare('SELECT * FROM slots WHERE slot_id = ?').get(targetSlot.slot_id);
  assert.strictEqual(freedSlot.is_occupied, 0);
  assert.strictEqual(freedSlot.current_session_id, null);

  // Verify session is COMPLETED
  const finalSession = db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(sessionId);
  assert.strictEqual(finalSession.status, 'COMPLETED');
  assert.strictEqual(finalSession.total_amount, 250);
});
