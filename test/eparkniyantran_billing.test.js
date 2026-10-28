const test = require('node:test');
const assert = require('node:assert');
const { db } = require('../database');
const { calculateParkingCharge, formatDuration } = require('../billing');

test('eParkNiyantran: Bill generation at parking time with In-Time and Out-Time', () => {
  const plate = 'MH12EP2026';
  // Insert test vehicle to satisfy foreign key
  db.prepare(`
    INSERT OR IGNORE INTO vehicles (plate, category, owner_name, phone, make_model, color, rc_status, created_at)
    VALUES (?, '4W', 'ePark User', '+91 9988776655', 'Honda City', 'Silver', 'ACTIVE', ?)
  `).run(plate, new Date().toISOString());

  const inTime = new Date('2026-10-28T10:00:00Z').toISOString();
  const outTime = new Date('2026-10-28T12:00:00Z').toISOString(); // 2 hours = 120 min

  const plannedSeconds = Math.max(0, Math.floor((new Date(outTime).getTime() - new Date(inTime).getTime()) / 1000));
  assert.strictEqual(plannedSeconds, 7200, 'Planned duration should be 7200 seconds (2 hours)');

  const billing = calculateParkingCharge(plannedSeconds, false, '4W');
  assert.strictEqual(billing.tierLabel, 'Up to 180 minutes');
  assert.strictEqual(billing.basicCharge, 500);
  assert.strictEqual(billing.agencyShare, 50);
  assert.strictEqual(billing.facilityShare, 450);

  // Generate simulated session with bill
  const sessionId = 'TEST-EPN-' + Date.now();
  const billNumber = 'EPN-BILL-20261028-TEST1';
  const testSlot = '4W-01';

  db.prepare(`
    INSERT INTO sessions (
      session_id, vehicle_plate, slot_id, category, entry_time, expected_exit_time,
      status, tariff_version, duration_seconds, tier_label, basic_amount, fine_amount,
      total_amount, agency_share, facility_share, bill_number, is_prepaid, operator_entry_id, created_at
    )
    VALUES (?, ?, ?, '4W', ?, ?, 'ACTIVE', 'v1.0.0', ?, ?, ?, 0, ?, ?, ?, ?, 0, 'OP-TEST', ?)
  `).run(
    sessionId, plate, testSlot, inTime, outTime,
    plannedSeconds, billing.tierLabel, billing.basicCharge,
    billing.basicCharge, billing.agencyShare, billing.facilityShare,
    billNumber, new Date().toISOString()
  );

  // Verify stored session record
  const session = db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(sessionId);
  assert.ok(session, 'Session must exist');
  assert.strictEqual(session.entry_time, inTime);
  assert.strictEqual(session.expected_exit_time, outTime);
  assert.strictEqual(session.bill_number, billNumber);
  assert.strictEqual(session.total_amount, 500);
  assert.strictEqual(session.duration_seconds, 7200);

  // Clean up test session
  db.prepare('DELETE FROM sessions WHERE session_id = ?').run(sessionId);
});

test('eParkNiyantran: Pre-paid session verification at exit', () => {
  const plate = 'MH12PRE9999';
  db.prepare(`
    INSERT OR IGNORE INTO vehicles (plate, category, owner_name, phone, make_model, color, rc_status, created_at)
    VALUES (?, '4W', 'Prepaid User', '+91 9988776644', 'Tata Nexon', 'White', 'ACTIVE', ?)
  `).run(plate, new Date().toISOString());

  const inTime = new Date('2026-10-28T09:00:00Z').toISOString();
  const outTime = new Date('2026-10-28T10:00:00Z').toISOString(); // 1 hr = 60 min (₹100)
  const plannedSeconds = 3600;

  const billing = calculateParkingCharge(plannedSeconds, false, '4W');
  assert.strictEqual(billing.basicCharge, 100);

  const sessionId = 'TEST-PRE-' + Date.now();
  const billNumber = 'EPN-BILL-PRE-01';

  // Session created and paid at entry
  db.prepare(`
    INSERT INTO sessions (
      session_id, vehicle_plate, slot_id, category, entry_time, expected_exit_time,
      status, tariff_version, duration_seconds, tier_label, basic_amount, fine_amount,
      total_amount, agency_share, facility_share, bill_number, is_prepaid, operator_entry_id, created_at
    )
    VALUES (?, ?, '4W-02', '4W', ?, ?, 'ACTIVE', 'v1.0.0', ?, ?, ?, 0, ?, ?, ?, ?, 1, 'OP-TEST', ?)
  `).run(
    sessionId, plate, inTime, outTime,
    plannedSeconds, billing.tierLabel, billing.basicCharge,
    billing.basicCharge, billing.agencyShare, billing.facilityShare,
    billNumber, new Date().toISOString()
  );

  const session = db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(sessionId);
  assert.strictEqual(session.is_prepaid, 1, 'Session should be marked as pre-paid');

  // Clean up
  db.prepare('DELETE FROM sessions WHERE session_id = ?').run(sessionId);
});
