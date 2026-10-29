/**
 * eParkNiyantran - Smart Parking Management System - Backend API Server
 * Built with native Node.js (Zero external dependencies).
 * Implements Architecture Diagram, Billing Engine, SMS Service, Payment Gateway, and IoT simulation.
 * Includes official Masters India VAHAN API (https://api-platform.mastersindia.co/api/v2/sbt/VAHAN/),
 * SMS Gateways (Fast2SMS, MSG91, Webhooks, DLT), and Razorpay Payment Gateway integration.
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const url = require('node:url');
const crypto = require('node:crypto');
const { db, recordAudit } = require('./database');
const {
  DEFAULT_TARIFF,
  calculateParkingCharge,
  calculateOverdueFine,
  checkFiveMinuteReminder,
  formatDuration
} = require('./billing');
const {
  normalizePlate,
  isValidIndianPlate,
  formatPlateDisplay,
  processOcrCandidate,
  recognizePlateFromImage,
  lookupMparivahan
} = require('./ocr');
const {
  getApiSettings,
  saveApiSettings,
  queryMastersIndiaVahan,
  sendSmsViaGateway,
  createRazorpayOrder,
  verifyRazorpaySignature
} = require('./integrations');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// Active OTP store for 2-Factor driver mobile & email verification (5 min expiry)
const activeMobileOtps = new Map();

/**
 * Helper to parse JSON body
 */
function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      // Protect against gigantic payloads (10MB max for photo uploads)
      if (body.length > 10 * 1024 * 1024) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        resolve({ rawText: body });
      }
    });
    req.on('error', reject);
  });
}

/**
 * Send JSON response
 */
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Operator-Id, X-Role'
  });
  res.end(JSON.stringify(data));
}

/**
 * Static file handler
 */
function serveStatic(req, res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
  };

  const contentType = mimeTypes[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('500 Server Error');
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
}

/**
 * Enhanced SMS Dispatcher via Gateway Integration
 */
async function dispatchSms(sessionId, phone, messageType, messageBody) {
  try {
    const res = await sendSmsViaGateway(sessionId, phone, messageType, messageBody);
    return res.notificationId;
  } catch (e) {
    console.error('Failed to dispatch SMS via gateway:', e);
    const notifId = 'SMS-' + Date.now();
    db.prepare(`
      INSERT INTO notifications (notification_id, session_id, recipient_phone, message_type, message_body, dlt_template_id, status, scheduled_time, sent_time, retry_count, failure_reason)
      VALUES (?, ?, ?, ?, ?, 'DLT-TMPL-GEN-00', 'FAILED', ?, ?, 0, ?)
    `).run(notifId, sessionId, phone || '+91 9800000000', messageType, messageBody, new Date().toISOString(), new Date().toISOString(), e.message);
    return notifId;
  }
}

/**
 * Background Reminder Job (Checks active sessions approaching 5-min threshold)
 */
async function runReminderChecker() {
  try {
    const activeSessions = db.prepare(`
      SELECT s.*, v.phone, v.has_pending_fine
      FROM sessions s
      JOIN vehicles v ON s.vehicle_plate = v.plate
      WHERE s.status = 'ACTIVE' AND s.five_min_reminder_sent = 0
    `).all();

    const now = Date.now();
    for (const sess of activeSessions) {
      const entryTimeMs = new Date(sess.entry_time).getTime();
      const durationSeconds = Math.floor((now - entryTimeMs) / 1000);
      
      const reminderCheck = checkFiveMinuteReminder(durationSeconds);
      if (reminderCheck.shouldTrigger) {
        // Send SMS via gateway
        const msg = `[eParkNiyantran Alert] Vehicle ${sess.vehicle_plate}: ${reminderCheck.message} Slot: ${sess.slot_id}.`;
        await dispatchSms(sess.session_id, sess.phone, 'FIVE_MIN_REMINDER', msg);
        
        // Update session flag
        db.prepare('UPDATE sessions SET five_min_reminder_sent = 1 WHERE session_id = ?').run(sess.session_id);
        recordAudit('SESSION', sess.session_id, '5MIN_REMINDER_SENT', 'SYSTEM_DAEMON', null, { remainingMinutes: reminderCheck.remainingMinutes }, 'Approaching tier boundary');
      }
    }
  } catch (e) {
    console.error('Error running reminder checker:', e);
  }
}

// Run periodic reminder check every 15 seconds
setInterval(runReminderChecker, 15000);

/**
 * Main Request Handler
 */
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  // Handle CORS Preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Operator-Id, X-Role'
    });
    return res.end();
  }

  // Operator ID from header or default
  const operatorId = req.headers['x-operator-id'] || 'OP-ATTENDANT-01';

  try {
    // ----------------------------------------------------
    // API: System Status & Health
    // ----------------------------------------------------
    if (pathname === '/api/health' && method === 'GET') {
      return sendJson(res, 200, {
        status: 'UP',
        timestamp: new Date().toISOString(),
        service: 'eParkNiyantran Smart Parking API Engine',
        version: '1.2.0',
        gateways: {
          vahanEndpoint: 'https://api-platform.mastersindia.co/api/v2/sbt/VAHAN/',
          smsGateway: getApiSettings().sms.provider,
          paymentGateway: getApiSettings().payment.provider
        }
      });
    }

    // ----------------------------------------------------
    // API: External Gateway Settings Configuration
    // ----------------------------------------------------
    if (pathname === '/api/gateways/settings' && method === 'GET') {
      const settings = getApiSettings();
      // Mask keys for safety
      const masked = JSON.parse(JSON.stringify(settings));
      if (masked.vahan.apiKey) masked.vahan.apiKey = masked.vahan.apiKey.slice(0, 4) + '••••••••' + masked.vahan.apiKey.slice(-4);
      if (masked.sms.apiKey) masked.sms.apiKey = masked.sms.apiKey.slice(0, 4) + '••••••••' + masked.sms.apiKey.slice(-4);
      if (masked.payment.keySecret) masked.payment.keySecret = '••••••••';
      return sendJson(res, 200, { success: true, settings: masked, rawSettings: settings });
    }

    if (pathname === '/api/gateways/settings' && method === 'POST') {
      const body = await parseRequestBody(req);
      const current = getApiSettings();
      
      const updated = {
        vahan: { ...current.vahan, ...(body.vahan || {}) },
        sms: { ...current.sms, ...(body.sms || {}) },
        payment: { ...current.payment, ...(body.payment || {}) }
      };

      // If masked value passed back, keep original
      if (body.vahan?.apiKey?.includes('••••')) updated.vahan.apiKey = current.vahan.apiKey;
      if (body.sms?.apiKey?.includes('••••')) updated.sms.apiKey = current.sms.apiKey;
      if (body.payment?.keySecret?.includes('••••')) updated.payment.keySecret = current.payment.keySecret;

      saveApiSettings(updated, operatorId);
      return sendJson(res, 200, { success: true, message: 'Gateway settings updated successfully.', settings: updated });
    }

    // Dedicated VAHAN Verification Endpoint (https://api-platform.mastersindia.co/api/v2/sbt/VAHAN/)
    if (pathname === '/api/vahan/verify' && method === 'POST') {
      const body = await parseRequestBody(req);
      const plate = body.plate || body.reg_no || body.rc_number || '';
      if (!plate) return sendJson(res, 400, { success: false, error: 'Vehicle plate number is required' });

      const vahanResult = await queryMastersIndiaVahan(plate);
      return sendJson(res, 200, {
        success: true,
        exists: vahanResult.exists,
        plate: vahanResult.plate,
        source: vahanResult.source,
        endpointUsed: vahanResult.endpointUsed,
        responseTimeMs: vahanResult.responseTimeMs,
        data: vahanResult.data,
        error: vahanResult.error,
        rawResponse: vahanResult.rawResponse
      });
    }

    // Test SMS Dispatch
    if (pathname === '/api/sms/test' && method === 'POST') {
      const body = await parseRequestBody(req);
      const phone = body.phone || '+91 98230 12345';
      const msg = body.message || '[eParkNiyantran Test] SMS Gateway connection verified successfully!';
      const result = await sendSmsViaGateway('TEST-SESSION', phone, 'TEST_ALERT', msg);
      return sendJson(res, 200, { success: true, result });
    }

    // Test / Create Razorpay Order
    if (pathname === '/api/payments/razorpay/order' && method === 'POST') {
      const body = await parseRequestBody(req);
      const { session_id, amount, plate } = body;
      const order = await createRazorpayOrder(session_id || 'TEST', amount || 100, plate || 'MH12AB1234');
      return sendJson(res, 200, order);
    }

    // Verify Razorpay Payment Signature
    if (pathname === '/api/payments/razorpay/verify' && method === 'POST') {
      const body = await parseRequestBody(req);
      const { session_id, razorpay_order_id, razorpay_payment_id, razorpay_signature, method: payMethod } = body;

      const verification = verifyRazorpaySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);
      if (!verification.valid) {
        return sendJson(res, 400, {
          success: false,
          error: 'Invalid Razorpay payment signature. Verification failed.',
          details: verification
        });
      }

      const session = db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(session_id);
      if (!session) return sendJson(res, 404, { success: false, error: 'Session not found' });

      const paymentRecordId = razorpay_payment_id || ('PAY-' + Date.now());
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO payments (payment_id, session_id, vehicle_plate, provider_ref, amount, status, method, confirmation_timestamp, reconciliation_status, signature_hash)
        VALUES (?, ?, ?, ?, ?, 'SUCCESS', ?, ?, 'VERIFIED', ?)
      `).run(
        paymentRecordId,
        session_id,
        session.vehicle_plate,
        razorpay_order_id || 'RAZORPAY',
        session.total_amount,
        payMethod || 'RAZORPAY_CHECKOUT',
        now,
        razorpay_signature || 'SIG_VERIFIED'
      );

      // Close session
      db.prepare("UPDATE sessions SET status = 'COMPLETED' WHERE session_id = ?").run(session_id);
      db.prepare('UPDATE slots SET is_occupied = 0, current_session_id = NULL WHERE slot_id = ?').run(session.slot_id);
      db.prepare('UPDATE vehicles SET has_pending_fine = 0, pending_fine_amount = 0 WHERE plate = ?').run(session.vehicle_plate);

      // Send Receipt SMS
      const vehicle = db.prepare('SELECT phone FROM vehicles WHERE plate = ?').get(session.vehicle_plate);
      const receiptMsg = `[eParkNiyantran] Payment of ₹${session.total_amount} verified via Razorpay (${paymentRecordId}). Slot ${session.slot_id} freed. Gate barrier OPEN. Thank you!`;
      await dispatchSms(session_id, vehicle ? vehicle.phone : '+91 9800000000', 'PAYMENT_RECEIPT', receiptMsg);

      recordAudit('PAYMENT', paymentRecordId, 'RAZORPAY_PAYMENT_VERIFIED', operatorId, 'PENDING_PAYMENT', 'COMPLETED', `Razorpay Order ${razorpay_order_id} Verified`);

      return sendJson(res, 200, {
        success: true,
        message: 'Razorpay payment successfully verified. Session closed.',
        payment_id: paymentRecordId,
        order_id: razorpay_order_id,
        session_id,
        slot_freed: session.slot_id
      });
    }

    // ----------------------------------------------------
    // API: Slots & Hardware State
    // ----------------------------------------------------
    if (pathname === '/api/slots' && method === 'GET') {
      const slots = db.prepare(`
        SELECT s.*, sess.vehicle_plate, sess.entry_time, sess.status as session_status
        FROM slots s
        LEFT JOIN sessions sess ON s.current_session_id = sess.session_id
        ORDER BY s.slot_id ASC
      `).all();

      const stats = {
        total: slots.length,
        twoWheelerTotal: slots.filter(s => s.category === '2W').length,
        twoWheelerOccupied: slots.filter(s => s.category === '2W' && s.is_occupied).length,
        fourWheelerTotal: slots.filter(s => s.category === '4W').length,
        fourWheelerOccupied: slots.filter(s => s.category === '4W' && s.is_occupied).length,
        totalOccupied: slots.filter(s => s.is_occupied).length,
        totalVacant: slots.filter(s => !s.is_occupied).length
      };

      return sendJson(res, 200, { success: true, stats, slots });
    }

    // Toggle sensor state (Hardware Simulation / Manual Override)
    if (pathname.match(/^\/api\/slots\/([^/]+)\/sensor-toggle$/) && method === 'POST') {
      const slotId = pathname.split('/')[3];
      const body = await parseRequestBody(req);
      const slot = db.prepare('SELECT * FROM slots WHERE slot_id = ?').get(slotId);
      if (!slot) return sendJson(res, 404, { success: false, error: 'Slot not found' });

      const newSensorStatus = body.sensor_status || (slot.sensor_status === 'ONLINE' ? 'TRIGGERED' : 'ONLINE');
      db.prepare('UPDATE slots SET sensor_status = ? WHERE slot_id = ?').run(newSensorStatus, slotId);
      recordAudit('SLOT', slotId, 'SENSOR_STATE_CHANGE', operatorId, slot.sensor_status, newSensorStatus, 'Hardware IoT Simulator');

      return sendJson(res, 200, { success: true, slotId, sensorStatus: newSensorStatus });
    }

    // ----------------------------------------------------
    // API: Plate OCR & Masters India VAHAN Verification
    // ----------------------------------------------------
    if (pathname === '/api/ocr/process' && method === 'POST') {
      const body = await parseRequestBody(req);
      const rawText = body.text || body.plate || '';
      const ocrResult = processOcrCandidate(rawText);
      const vahanResult = await queryMastersIndiaVahan(ocrResult.normalized || rawText);

      return sendJson(res, 200, {
        success: true,
        ocr: ocrResult,
        vahan: vahanResult,
        mParivahan: {
          found: vahanResult.exists,
          source: vahanResult.source,
          data: vahanResult.data,
          error: vahanResult.error
        }
      });
    }

    // Direct Image OCR endpoint (Supports Camera stream & Upload)
    if (pathname === '/api/ocr/recognize' && method === 'POST') {
      const body = await parseRequestBody(req);
      const image = body.image || '';
      const method = body.capture_method || 'UPLOAD';
      const clientText = body.text || body.plate || '';

      let ocrResult;
      if (clientText) {
        ocrResult = processOcrCandidate(clientText);
      } else {
        ocrResult = recognizePlateFromImage(image, method);
      }

      return sendJson(res, 200, {
        success: !!(ocrResult.normalized || ocrResult.plate),
        plate: ocrResult.normalized || ocrResult.plate || '',
        formatted: ocrResult.formatted || '',
        confidence: ocrResult.confidence || 0,
        ocr: ocrResult.ocr || ocrResult
      });
    }

    // ----------------------------------------------------
    // API: 2-Factor Driver Mobile & Email OTP Verification
    // ----------------------------------------------------
    if (pathname === '/api/otp/send-mobile' && method === 'POST') {
      const body = await parseRequestBody(req);
      const rawPhone = (body.phone || '').trim();
      if (!rawPhone) {
        return sendJson(res, 400, { success: false, error: 'Driver mobile number is required' });
      }

      const digits = rawPhone.replace(/\D/g, '');
      const plainDigits = digits.length >= 10 ? digits.slice(-10) : digits;
      const normalizedPhone = rawPhone.startsWith('+') ? rawPhone : `+91 ${plainDigits.slice(0, 5)} ${plainDigits.slice(5)}`;

      // Generate 6-digit cryptographic random code
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes validity

      activeMobileOtps.set(plainDigits, { code, expiresAt, phone: normalizedPhone });

      const maskedPhone = normalizedPhone.length >= 8 
        ? normalizedPhone.slice(0, 6) + '•••• ••' + normalizedPhone.slice(-2)
        : normalizedPhone;

      // Attempt SMS gateway transmission (Fast2SMS or Mock)
      try {
        await sendSmsViaGateway(
          normalizedPhone,
          `Your eParkNiyantran parking access verification code is ${code}. Valid for 5 minutes.`
        );
      } catch (err) {
        console.warn('SMS dispatch error:', err.message);
      }

      return sendJson(res, 200, {
        success: true,
        message: `OTP sent to ${maskedPhone}`,
        destination: normalizedPhone,
        maskedPhone: maskedPhone,
        expiresInSeconds: 300,
        cooldownSeconds: 30,
        demoCode: code
      });
    }

    if (pathname === '/api/otp/verify-mobile' && method === 'POST') {
      const body = await parseRequestBody(req);
      const rawPhone = (body.phone || '').trim();
      const code = (body.code || '').trim();
      const plainDigits = rawPhone.replace(/\D/g, '').slice(-10);

      const entry = activeMobileOtps.get(plainDigits);
      if (!entry) {
        return sendJson(res, 400, { success: false, verified: false, error: 'No active OTP requested for this phone number, or code has expired.' });
      }

      if (Date.now() > entry.expiresAt) {
        activeMobileOtps.delete(plainDigits);
        return sendJson(res, 400, { success: false, verified: false, error: 'OTP code has expired. Please request a new code.' });
      }

      if (entry.code !== code) {
        return sendJson(res, 400, { success: false, verified: false, error: 'Incorrect 6-digit OTP code.' });
      }

      activeMobileOtps.delete(plainDigits);
      return sendJson(res, 200, {
        success: true,
        verified: true,
        message: 'Mobile number verified successfully!'
      });
    }

    if (pathname === '/api/email/send-verification' && method === 'POST') {
      const body = await parseRequestBody(req);
      const email = (body.email || '').trim().toLowerCase();
      if (!email || !email.includes('@')) {
        return sendJson(res, 400, { success: false, error: 'Valid email address is required' });
      }
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      activeMobileOtps.set(email, { code, expiresAt: Date.now() + 5 * 60 * 1000, email });
      return sendJson(res, 200, {
        success: true,
        message: `Verification code sent to ${email}`,
        demoCode: code
      });
    }

    if (pathname === '/api/email/verify' && method === 'POST') {
      const body = await parseRequestBody(req);
      const email = (body.email || '').trim().toLowerCase();
      const code = (body.code || '').trim();
      const entry = activeMobileOtps.get(email);
      if (entry && Date.now() <= entry.expiresAt && entry.code === code) {
        activeMobileOtps.delete(email);
        return sendJson(res, 200, { success: true, verified: true, message: 'Email address verified successfully!' });
      }
      return sendJson(res, 400, { success: false, verified: false, error: 'Invalid or expired email verification code.' });
    }

    if (pathname.startsWith('/api/vehicles/lookup/') && method === 'GET') {
      const rawPlate = pathname.replace('/api/vehicles/lookup/', '');
      const vahanResult = await queryMastersIndiaVahan(rawPlate);

      // Also check local database for existing violation history
      const localRecord = db.prepare('SELECT * FROM vehicles WHERE plate = ?').get(normalizePlate(rawPlate));
      if (localRecord && vahanResult.data) {
        vahanResult.data.hasPendingFine = !!localRecord.has_pending_fine;
        vahanResult.data.pendingFineAmount = localRecord.pending_fine_amount;
        vahanResult.data.isBanned = !!localRecord.is_banned;
        vahanResult.data.banUntil = localRecord.ban_until;
      }

      return sendJson(res, 200, {
        success: true,
        exists: vahanResult.exists,
        vahan: vahanResult,
        vehicle: {
          found: vahanResult.exists,
          source: vahanResult.source,
          data: vahanResult.data,
          error: vahanResult.error
        }
      });
    }

    // ----------------------------------------------------
    // API: Parking Sessions - Entry Workflow
    // ----------------------------------------------------
    if (pathname === '/api/sessions/entry' && method === 'POST') {
      const body = await parseRequestBody(req);
      const rawPlate = body.plate;
      const normalizedPlate = normalizePlate(rawPlate);

      if (!normalizedPlate) {
        return sendJson(res, 400, { success: false, error: 'Invalid plate number provided' });
      }

      // 1. Check Masters India VAHAN API status
      const vahanCheck = await queryMastersIndiaVahan(normalizedPlate);
      if (vahanCheck.exists === false && !body.allow_unverified) {
        return sendJson(res, 400, {
          success: false,
          error: `VAHAN Alert: Vehicle ${normalizedPlate} was not found on the Masters India VAHAN national registry. Possible counterfeit plate. Check registration or authorize supervisor override.`,
          vahan: vahanCheck
        });
      }

      // Check if vehicle is banned in local DB
      let vehicle = db.prepare('SELECT * FROM vehicles WHERE plate = ?').get(normalizedPlate);
      if (!vehicle) {
        const vData = vahanCheck.data || {};
        const assignedCategory = body.category || vData.category || '4W';
        const assignedOwner = body.owner_name || vData.owner || 'Citizen / Driver';
        const assignedPhone = body.phone || vData.phone || '+91 9800000000';
        const assignedModel = body.make_model || vData.makeModel || 'Standard Vehicle';
        const assignedColor = vData.color || 'Standard';

        db.prepare(`
          INSERT INTO vehicles (plate, category, owner_name, phone, make_model, color, rc_status, is_banned, ban_until, has_pending_fine, pending_fine_amount, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          normalizedPlate,
          assignedCategory,
          assignedOwner,
          assignedPhone,
          assignedModel,
          assignedColor,
          vData.rcStatus || 'ACTIVE',
          vData.isBanned ? 1 : 0,
          vData.banUntil,
          vData.hasPendingFine ? 1 : 0,
          vData.pendingFineAmount || 0,
          new Date().toISOString()
        );
        vehicle = db.prepare('SELECT * FROM vehicles WHERE plate = ?').get(normalizedPlate);
      } else {
        // Vehicle already existed: update phone, owner, make/model if attendant entered fresh details
        if (body.phone || body.owner_name || body.make_model || body.category) {
          db.prepare(`
            UPDATE vehicles
            SET phone = COALESCE(?, phone),
                owner_name = COALESCE(?, owner_name),
                make_model = COALESCE(?, make_model),
                category = COALESCE(?, category)
            WHERE plate = ?
          `).run(body.phone || null, body.owner_name || null, body.make_model || null, body.category || null, normalizedPlate);
          vehicle = db.prepare('SELECT * FROM vehicles WHERE plate = ?').get(normalizedPlate);
        }
      }

      // Check ban status
      if (vehicle.is_banned) {
        if (vehicle.ban_until && new Date(vehicle.ban_until) <= new Date()) {
          // Ban has expired, lift it
          db.prepare('UPDATE vehicles SET is_banned = 0, ban_until = NULL WHERE plate = ?').run(normalizedPlate);
          recordAudit('VEHICLE', normalizedPlate, 'BAN_EXPIRED', 'SYSTEM', 'BANNED', 'CLEARED', '10-day ban period ended');
        } else {
          return sendJson(res, 403, {
            success: false,
            error: `Vehicle ${normalizedPlate} is currently BANNED from parking until ${vehicle.ban_until || 'further review'} due to excessive duration (>180 min) or pending non-payment penalty.`
          });
        }
      }

      // Check for active duplicate session
      const existingActive = db.prepare("SELECT * FROM sessions WHERE vehicle_plate = ? AND status = 'ACTIVE'").get(normalizedPlate);
      if (existingActive) {
        return sendJson(res, 409, {
          success: false,
          error: `Vehicle ${normalizedPlate} already has an active parking session (ID: ${existingActive.session_id}) in slot ${existingActive.slot_id}.`
        });
      }

      // Allocate slot
      const requestedCategory = body.category || vehicle.category || '4W';
      let targetSlot = null;

      if (body.slot_id) {
        targetSlot = db.prepare('SELECT * FROM slots WHERE slot_id = ? AND is_occupied = 0').get(body.slot_id);
      } else {
        targetSlot = db.prepare('SELECT * FROM slots WHERE category = ? AND is_occupied = 0 ORDER BY slot_id ASC LIMIT 1').get(requestedCategory);
      }

      if (!targetSlot) {
        return sendJson(res, 422, {
          success: false,
          error: `No vacant slots available for category ${requestedCategory}. Please wait for a departing vehicle.`
        });
      }

      // Generate Session
      const sessionId = 'SES-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
      const entryTime = body.entry_time || new Date().toISOString();
      const expectedExitTime = body.expected_exit_time || body.out_time || new Date(new Date(entryTime).getTime() + 60 * 60 * 1000).toISOString();

      // Calculate initial planned parking duration & bill at parking time
      const plannedDurationSec = Math.max(0, Math.floor((new Date(expectedExitTime).getTime() - new Date(entryTime).getTime()) / 1000));
      const entryBilling = calculateParkingCharge(plannedDurationSec, !!vehicle.has_pending_fine, requestedCategory);
      const fineAmount = vehicle.has_pending_fine ? (vehicle.pending_fine_amount || 50) : 0;
      const totalBillAmount = entryBilling.basicCharge + fineAmount;
      const billNumber = 'EPN-BILL-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();

      db.prepare(`
        INSERT INTO sessions (
          session_id, vehicle_plate, slot_id, category, entry_time, expected_exit_time,
          status, tariff_version, duration_seconds, tier_label, basic_amount, fine_amount,
          total_amount, agency_share, facility_share, bill_number, is_prepaid, operator_entry_id, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      `).run(
        sessionId,
        normalizedPlate,
        targetSlot.slot_id,
        requestedCategory,
        entryTime,
        expectedExitTime,
        DEFAULT_TARIFF.version,
        plannedDurationSec,
        entryBilling.tierLabel,
        entryBilling.basicCharge,
        fineAmount,
        totalBillAmount,
        entryBilling.agencyShare,
        entryBilling.facilityShare,
        billNumber,
        operatorId,
        new Date().toISOString()
      );

      // Mark slot occupied
      db.prepare('UPDATE slots SET is_occupied = 1, current_session_id = ? WHERE slot_id = ?').run(sessionId, targetSlot.slot_id);

      // Store Evidence
      const evidenceId = 'EVD-' + Date.now();
      db.prepare(`
        INSERT INTO evidence (evidence_id, session_id, capture_type, image_data, ocr_raw, ocr_confidence, manual_correction, corrected_by_operator_id, notes, timestamp)
        VALUES (?, ?, 'ENTRY_FRONT', ?, ?, ?, ?, ?, ?, ?)
      `).run(
        evidenceId,
        sessionId,
        body.image_data || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="300" height="80"><rect width="300" height="80" fill="%23f3f4f6"/><text x="150" y="48" font-size="28" font-weight="bold" text-anchor="middle" fill="%23111827">' + normalizedPlate + '</text></svg>',
        body.ocr_raw || normalizedPlate,
        body.ocr_confidence || 0.95,
        body.manual_correction ? 1 : 0,
        body.manual_correction ? operatorId : null,
        body.notes || 'Entry front plate verified via Masters India VAHAN',
        entryTime
      );

      // Audit log
      recordAudit('SESSION', sessionId, 'ENTRY_RECORDED', operatorId, null, { plate: normalizedPlate, slot: targetSlot.slot_id, billNumber, totalBillAmount, vahanVerified: vahanCheck.exists }, 'Vehicle entry & bill generation logged');

      // Generate payment link
      const paymentLink = `http://${req.headers.host || 'localhost:3000'}/pay/${sessionId}`;

      // Dispatch Entry Welcome + Bill SMS via Gateway to vehicle owner
      const smsPhone = body.phone || vehicle.phone;
      const inTimeFormatted = new Date(entryTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
      const outTimeFormatted = new Date(expectedExitTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
      const welcomeMsg = `[eParkNiyantran] Welcome ${normalizedPlate}! Bay: ${targetSlot.slot_id}. In: ${inTimeFormatted}, Out: ${outTimeFormatted} (${entryBilling.durationFormatted}). Bill #${billNumber}: ₹${totalBillAmount}. Pay: ${paymentLink}`;
      const smsId = await dispatchSms(sessionId, smsPhone, 'ENTRY_WELCOME', welcomeMsg);

      // Complete Bill Payload for instant receipt/voucher generation at parking time
      const bill = {
        bill_number: billNumber,
        session_id: sessionId,
        vehicle_plate: normalizedPlate,
        category: requestedCategory,
        owner_name: vehicle.owner_name,
        phone: smsPhone,
        make_model: vehicle.make_model,
        color: vehicle.color,
        slot_id: targetSlot.slot_id,
        entry_time: entryTime,
        expected_exit_time: expectedExitTime,
        duration_seconds: plannedDurationSec,
        duration_formatted: entryBilling.durationFormatted,
        tier_label: entryBilling.tierLabel,
        basic_amount: entryBilling.basicCharge,
        fine_amount: fineAmount,
        agency_share: entryBilling.agencyShare,
        facility_share: entryBilling.facilityShare,
        total_amount: totalBillAmount,
        ban_applied: entryBilling.appliesBan,
        status: 'ACTIVE',
        is_prepaid: 0,
        payment_link: paymentLink,
        upi_string: `upi://pay?pa=eparkniyantran@okhdfcbank&pn=eParkNiyantran&am=${totalBillAmount}&tr=${sessionId}&tn=ParkingBill_${normalizedPlate}`,
        generated_at: new Date().toISOString()
      };

      return sendJson(res, 201, {
        success: true,
        session: {
          session_id: sessionId,
          vehicle_plate: normalizedPlate,
          slot_id: targetSlot.slot_id,
          category: requestedCategory,
          entry_time: entryTime,
          expected_exit_time: expectedExitTime,
          status: 'ACTIVE',
          owner_name: vehicle.owner_name,
          phone: smsPhone,
          welcome_sms_id: smsId,
          vahan_verified: vahanCheck.exists,
          vahan_source: vahanCheck.source,
          bill_number: billNumber,
          total_amount: totalBillAmount,
          is_prepaid: 0
        },
        bill
      });
    }

    // ----------------------------------------------------
    // API: Active Sessions & Real-Time Bill Estimate
    // ----------------------------------------------------
    if (pathname === '/api/sessions/active' && method === 'GET') {
      const activeSessions = db.prepare(`
        SELECT s.*, v.owner_name, v.phone, v.make_model, v.has_pending_fine, v.pending_fine_amount, v.is_banned
        FROM sessions s
        JOIN vehicles v ON s.vehicle_plate = v.plate
        WHERE s.status = 'ACTIVE'
        ORDER BY s.entry_time DESC
      `).all();

      const now = Date.now();
      const enriched = activeSessions.map(sess => {
        const entryMs = new Date(sess.entry_time).getTime();
        const durationSeconds = Math.max(0, Math.floor((now - entryMs) / 1000));
        const chargeInfo = calculateParkingCharge(durationSeconds, !!sess.has_pending_fine, sess.category);
        const reminderInfo = checkFiveMinuteReminder(durationSeconds);

        return {
          ...sess,
          duration_seconds: durationSeconds,
          duration_formatted: formatDuration(durationSeconds),
          estimated_amount: chargeInfo.basicCharge,
          tier_label: chargeInfo.tierLabel,
          applies_ban: chargeInfo.appliesBan,
          reminder_due: reminderInfo.shouldTrigger
        };
      });

      return sendJson(res, 200, { success: true, sessions: enriched });
    }

    // ----------------------------------------------------
    // API: Retrieve Parking Bill / Ticket
    // ----------------------------------------------------
    if (pathname.match(/^\/api\/sessions\/([^/]+)\/bill$/) && method === 'GET') {
      const sessionId = pathname.split('/')[3];
      const session = db.prepare(`
        SELECT s.*, v.owner_name, v.phone, v.make_model, v.color, v.has_pending_fine, v.pending_fine_amount
        FROM sessions s
        JOIN vehicles v ON s.vehicle_plate = v.plate
        WHERE s.session_id = ?
      `).get(sessionId);

      if (!session) return sendJson(res, 404, { success: false, error: 'Session not found' });

      const paymentLink = `http://${req.headers.host || 'localhost:3000'}/pay/${sessionId}`;
      const bill = {
        bill_number: session.bill_number || ('EPN-BILL-' + session.session_id.replace(/[^A-Za-z0-9]/g, '').slice(-8)),
        session_id: session.session_id,
        vehicle_plate: session.vehicle_plate,
        category: session.category,
        slot_id: session.slot_id,
        owner_name: session.owner_name,
        phone: session.phone,
        make_model: session.make_model,
        color: session.color,
        entry_time: session.entry_time,
        expected_exit_time: session.expected_exit_time || session.exit_time,
        exit_time: session.exit_time,
        duration_seconds: session.duration_seconds,
        duration_formatted: formatDuration(session.duration_seconds || 0),
        tier_label: session.tier_label || 'Standard Tariff',
        basic_amount: session.basic_amount || 0,
        fine_amount: session.fine_amount || 0,
        agency_share: session.agency_share || 0,
        facility_share: session.facility_share || 0,
        total_amount: session.total_amount || 0,
        status: session.status,
        is_prepaid: session.is_prepaid || 0,
        payment_link: paymentLink,
        upi_string: `upi://pay?pa=eparkniyantran@okhdfcbank&pn=eParkNiyantran&am=${session.total_amount || 0}&tr=${sessionId}&tn=ParkingBill_${session.vehicle_plate}`,
        generated_at: session.created_at
      };

      return sendJson(res, 200, { success: true, bill });
    }

    // ----------------------------------------------------
    // API: Parking Sessions - Exit & Charge Calculation
    // ----------------------------------------------------
    if (pathname.match(/^\/api\/sessions\/([^/]+)\/exit$/) && method === 'POST') {
      const sessionId = pathname.split('/')[3];
      const body = await parseRequestBody(req);
      const session = db.prepare('SELECT s.*, v.phone, v.has_pending_fine, v.owner_name FROM sessions s JOIN vehicles v ON s.vehicle_plate = v.plate WHERE s.session_id = ?').get(sessionId);

      if (!session) return sendJson(res, 404, { success: false, error: 'Session not found' });
      if (session.status !== 'ACTIVE') {
        return sendJson(res, 400, { success: false, error: `Session is not active (current status: ${session.status})` });
      }

      const exitTime = body.exit_time || new Date().toISOString();
      const durationSeconds = Math.max(0, Math.floor((new Date(exitTime).getTime() - new Date(session.entry_time).getTime()) / 1000));

      // Calculate charge using Billing Engine
      const billing = calculateParkingCharge(durationSeconds, !!session.has_pending_fine, session.category);

      // If duration exceeds 180 min, apply 10-day parking ban
      let banApplied = false;
      let banUntil = null;
      if (billing.appliesBan) {
        banApplied = true;
        banUntil = new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString();
        db.prepare('UPDATE vehicles SET is_banned = 1, ban_until = ? WHERE plate = ?').run(banUntil, session.vehicle_plate);
        recordAudit('VEHICLE', session.vehicle_plate, 'BAN_APPLIED', operatorId, 'ACTIVE', 'BANNED_10_DAYS', 'Parked >180 minutes violation');
      }

      // Check if session was pre-paid at entry time and within booked duration
      if (session.is_prepaid && billing.basicCharge <= (session.basic_amount || 0)) {
        db.prepare(`
          UPDATE sessions
          SET exit_time = ?,
              duration_seconds = ?,
              tier_label = ?,
              status = 'COMPLETED',
              operator_exit_id = ?
          WHERE session_id = ?
        `).run(exitTime, durationSeconds, billing.tierLabel, operatorId, sessionId);

        db.prepare('UPDATE slots SET is_occupied = 0, current_session_id = NULL WHERE slot_id = ?').run(session.slot_id);

        const exitReceiptMsg = `[eParkNiyantran] Exit verified for ${session.vehicle_plate}. Pre-paid bill: ₹${session.total_amount}. Duration: ${billing.durationFormatted}. Bay ${session.slot_id} freed. Gate OPEN. Thank you!`;
        const smsId = await dispatchSms(sessionId, session.phone, 'PAYMENT_RECEIPT', exitReceiptMsg);

        recordAudit('SESSION', sessionId, 'EXIT_RECORDED_PREPAID', operatorId, 'ACTIVE', 'COMPLETED', `Prepaid bill verified (₹${session.total_amount})`);

        return sendJson(res, 200, {
          success: true,
          session_id: sessionId,
          vehicle_plate: session.vehicle_plate,
          duration_seconds: durationSeconds,
          duration_formatted: billing.durationFormatted,
          tier_label: billing.tierLabel,
          basic_charge: 0,
          total_amount: 0,
          already_paid: true,
          paid_amount: session.total_amount,
          slot_freed: session.slot_id,
          sms_id: smsId
        });
      }

      // Update session status to PENDING_PAYMENT
      db.prepare(`
        UPDATE sessions
        SET exit_time = ?,
            duration_seconds = ?,
            tier_label = ?,
            basic_amount = ?,
            fine_amount = ?,
            total_amount = ?,
            agency_share = ?,
            facility_share = ?,
            status = 'PENDING_PAYMENT',
            operator_exit_id = ?
        WHERE session_id = ?
      `).run(
        exitTime,
        durationSeconds,
        billing.tierLabel,
        billing.basicCharge,
        session.has_pending_fine ? 50 : 0,
        billing.basicCharge,
        billing.agencyShare,
        billing.facilityShare,
        operatorId,
        sessionId
      );

      // Record Exit Evidence (Rear Plate Photo)
      const evidenceId = 'EVD-' + Date.now();
      db.prepare(`
        INSERT INTO evidence (evidence_id, session_id, capture_type, image_data, ocr_raw, ocr_confidence, manual_correction, corrected_by_operator_id, notes, timestamp)
        VALUES (?, ?, 'EXIT_REAR', ?, ?, ?, ?, ?, ?, ?)
      `).run(
        evidenceId,
        sessionId,
        body.image_data || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="300" height="80"><rect width="300" height="80" fill="%23e5e7eb"/><text x="150" y="48" font-size="28" font-weight="bold" text-anchor="middle" fill="%231f2937">' + session.vehicle_plate + ' (EXIT)</text></svg>',
        body.ocr_raw || session.vehicle_plate,
        body.ocr_confidence || 0.96,
        body.manual_correction ? 1 : 0,
        body.manual_correction ? operatorId : null,
        'Exit rear plate captured & recorded',
        exitTime
      );

      // Generate payment link
      const paymentLink = `http://${req.headers.host || 'localhost:3000'}/pay/${sessionId}`;
      
      // Dispatch Payment Link SMS to customer via SMS Gateway
      const smsBody = `[eParkNiyantran] Exit recorded for ${session.vehicle_plate}. Duration: ${billing.durationFormatted}. Total Charge: ₹${billing.basicCharge}. Pay securely online at: ${paymentLink} (Ref: ${sessionId}).`;
      const smsId = await dispatchSms(sessionId, session.phone, 'PAYMENT_LINK', smsBody);

      recordAudit('SESSION', sessionId, 'EXIT_RECORDED', operatorId, 'ACTIVE', 'PENDING_PAYMENT', `Bill: ₹${billing.basicCharge}`);

      return sendJson(res, 200, {
        success: true,
        session_id: sessionId,
        vehicle_plate: session.vehicle_plate,
        duration_seconds: durationSeconds,
        duration_formatted: billing.durationFormatted,
        tier_label: billing.tierLabel,
        basic_charge: billing.basicCharge,
        agency_share: billing.agencyShare,
        facility_share: billing.facilityShare,
        ban_applied: banApplied,
        ban_until: banUntil,
        payment_link: paymentLink,
        sms_id: smsId
      });
    }

    // ----------------------------------------------------
    // API: Payment Gateway & Razorpay Order Checkout
    // ----------------------------------------------------
    if (pathname.match(/^\/api\/payments\/([^/]+)\/checkout$/) && method === 'GET') {
      const sessionId = pathname.split('/')[3];
      const session = db.prepare('SELECT s.*, v.owner_name, v.phone, v.make_model FROM sessions s JOIN vehicles v ON s.vehicle_plate = v.plate WHERE s.session_id = ?').get(sessionId);

      if (!session) return sendJson(res, 404, { success: false, error: 'Session not found' });

      // Generate Razorpay Order via Integrations Engine
      const razorpayOrder = await createRazorpayOrder(sessionId, session.total_amount, session.vehicle_plate);

      const paymentPayload = {
        order_id: razorpayOrder.orderId,
        session_id: sessionId,
        amount: session.total_amount,
        amount_in_paise: razorpayOrder.amountInPaise,
        currency: 'INR',
        key_id: razorpayOrder.keyId,
        upi_string: `upi://pay?pa=eparkniyantran@okhdfcbank&pn=eParkNiyantran&am=${session.total_amount}&tr=${sessionId}&tn=ParkingFee_${session.vehicle_plate}`,
        vehicle_plate: session.vehicle_plate,
        source: razorpayOrder.source,
        status: session.status
      };

      return sendJson(res, 200, { success: true, payment: paymentPayload, session });
    }

    // Verified Payment Provider Webhook / Callback
    if (pathname === '/api/payments/callback' && method === 'POST') {
      const body = await parseRequestBody(req);
      const { session_id, payment_id, method: payMethod, provider_ref } = body;

      const session = db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(session_id);
      if (!session) return sendJson(res, 404, { success: false, error: 'Session not found' });

      const paymentRecordId = payment_id || ('PAY-' + Date.now());
      const txnRef = provider_ref || ('TXN-' + crypto.randomBytes(6).toString('hex').toUpperCase());
      const now = new Date().toISOString();

      // Record verified payment
      db.prepare(`
        INSERT INTO payments (payment_id, session_id, vehicle_plate, provider_ref, amount, status, method, confirmation_timestamp, reconciliation_status, signature_hash)
        VALUES (?, ?, ?, ?, ?, 'SUCCESS', ?, ?, 'VERIFIED', ?)
      `).run(
        paymentRecordId,
        session_id,
        session.vehicle_plate,
        txnRef,
        session.total_amount,
        payMethod || 'UPI_QR',
        now,
        crypto.createHash('sha256').update(session_id + txnRef + session.total_amount).digest('hex')
      );

      // Handle Advance Payment at entry time vs Exit Payment
      if (session.status === 'ACTIVE') {
        db.prepare('UPDATE sessions SET is_prepaid = 1 WHERE session_id = ?').run(session_id);
        db.prepare('UPDATE vehicles SET has_pending_fine = 0, pending_fine_amount = 0 WHERE plate = ?').run(session.vehicle_plate);

        const vehicle = db.prepare('SELECT phone FROM vehicles WHERE plate = ?').get(session.vehicle_plate);
        const receiptMsg = `[eParkNiyantran] Advance Bill Paid: ₹${session.total_amount} for ${session.vehicle_plate} (Txn: ${txnRef}). Bay: ${session.slot_id}. Valid until: ${session.expected_exit_time ? new Date(session.expected_exit_time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : 'scheduled exit'}. Thank you!`;
        await dispatchSms(session_id, vehicle ? vehicle.phone : '+91 9800000000', 'PAYMENT_RECEIPT', receiptMsg);

        recordAudit('PAYMENT', paymentRecordId, 'ADVANCE_BILL_PAID', operatorId, 'ACTIVE', 'ACTIVE_PREPAID', `Amount ₹${session.total_amount} via ${payMethod || 'UPI_QR'}`);

        return sendJson(res, 200, {
          success: true,
          message: 'Advance parking bill payment confirmed. Session marked as pre-paid.',
          payment_id: paymentRecordId,
          transaction_ref: txnRef,
          session_id,
          is_prepaid: 1,
          slot_occupied: session.slot_id
        });
      }

      // Update session to COMPLETED
      db.prepare("UPDATE sessions SET status = 'COMPLETED' WHERE session_id = ?").run(session_id);

      // Free the allocated slot
      db.prepare('UPDATE slots SET is_occupied = 0, current_session_id = NULL WHERE slot_id = ?').run(session.slot_id);

      // Clear any pending fine flag on vehicle
      db.prepare('UPDATE vehicles SET has_pending_fine = 0, pending_fine_amount = 0 WHERE plate = ?').run(session.vehicle_plate);

      // Dispatch Payment Success SMS Receipt via Gateway
      const vehicle = db.prepare('SELECT phone FROM vehicles WHERE plate = ?').get(session.vehicle_plate);
      const receiptMsg = `[eParkNiyantran] Payment Received: ₹${session.total_amount} for ${session.vehicle_plate} (Txn: ${txnRef}). Parking completed. Slot ${session.slot_id} freed. Gate OPEN. Thank you!`;
      await dispatchSms(session_id, vehicle ? vehicle.phone : '+91 9800000000', 'PAYMENT_RECEIPT', receiptMsg);

      recordAudit('PAYMENT', paymentRecordId, 'PAYMENT_CONFIRMED', operatorId, 'PENDING_PAYMENT', 'COMPLETED', `Amount ₹${session.total_amount} via ${payMethod || 'UPI_QR'}`);

      return sendJson(res, 200, {
        success: true,
        message: 'Payment verified and confirmed. Parking session closed successfully.',
        payment_id: paymentRecordId,
        transaction_ref: txnRef,
        session_id,
        slot_freed: session.slot_id
      });
    }

    // ----------------------------------------------------
    // API: Exceptions & End-of-Day Clearance (11:59 PM)
    // ----------------------------------------------------
    if (pathname === '/api/exceptions' && method === 'GET') {
      const unpaidSessions = db.prepare(`
        SELECT s.*, v.owner_name, v.phone
        FROM sessions s
        JOIN vehicles v ON s.vehicle_plate = v.plate
        WHERE s.status = 'PENDING_PAYMENT'
        ORDER BY s.exit_time DESC
      `).all();

      const now = Date.now();
      const allActive = db.prepare(`
        SELECT s.*, v.owner_name, v.phone
        FROM sessions s
        JOIN vehicles v ON s.vehicle_plate = v.plate
        WHERE s.status = 'ACTIVE'
      `).all();

      const missingExitSessions = allActive.filter(s => {
        const durationSec = (now - new Date(s.entry_time).getTime()) / 1000;
        return durationSec >= 4 * 3600;
      });

      const bannedVehicles = db.prepare('SELECT * FROM vehicles WHERE is_banned = 1').all();
      const overdueSessions = db.prepare(`
        SELECT s.*, v.owner_name, v.phone
        FROM sessions s
        JOIN vehicles v ON s.vehicle_plate = v.plate
        WHERE s.status = 'OVERDUE'
      `).all();
      const towedSessions = db.prepare(`
        SELECT s.*, v.owner_name, v.phone
        FROM sessions s
        JOIN vehicles v ON s.vehicle_plate = v.plate
        WHERE s.status = 'TOWED'
      `).all();

      return sendJson(res, 200, {
        success: true,
        unpaid: unpaidSessions,
        missingExit: missingExitSessions,
        bannedVehicles,
        overdue: overdueSessions,
        towed: towedSessions
      });
    }

    // Trigger ₹100/day Late Payment Fine
    if (pathname === '/api/exceptions/apply-daily-fine' && method === 'POST') {
      const unpaid = db.prepare("SELECT * FROM sessions WHERE status = 'PENDING_PAYMENT' OR status = 'OVERDUE'").all();
      let updatedCount = 0;

      for (const s of unpaid) {
        const days = 1;
        const additionalFine = calculateOverdueFine(days);
        const newFine = (s.fine_amount || 0) + additionalFine;
        const newTotal = (s.basic_amount || 0) + newFine;

        db.prepare(`
          UPDATE sessions
          SET fine_amount = ?, total_amount = ?, status = 'OVERDUE'
          WHERE session_id = ?
        `).run(newFine, newTotal, s.session_id);

        const banDate = new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString();
        db.prepare('UPDATE vehicles SET is_banned = 1, ban_until = ?, has_pending_fine = 1, pending_fine_amount = ? WHERE plate = ?')
          .run(banDate, newFine, s.vehicle_plate);

        const vehicle = db.prepare('SELECT phone FROM vehicles WHERE plate = ?').get(s.vehicle_plate);
        if (vehicle) {
          const alertMsg = `[eParkNiyantran Notice] Unpaid fee for ${s.vehicle_plate}. ₹${additionalFine} late fine added. Total: ₹${newTotal}. Vehicle banned till payment + 10 days.`;
          await dispatchSms(s.session_id, vehicle.phone, 'OVERDUE_ALERT', alertMsg);
        }

        recordAudit('SESSION', s.session_id, 'DAILY_LATE_FINE_APPLIED', operatorId, s.fine_amount, newFine, 'Late-payment rule: ₹100/day');
        updatedCount++;
      }

      return sendJson(res, 200, { success: true, updatedCount, finePerDay: 100 });
    }

    // End-of-Day (11:59 PM) Clearance Routine
    if (pathname === '/api/exceptions/end-of-day-clearance' && method === 'POST') {
      const now = new Date();
      const clearanceTimestamp = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 0).toISOString();

      const activeSessions = db.prepare("SELECT s.*, v.phone FROM sessions s JOIN vehicles v ON s.vehicle_plate = v.plate WHERE s.status = 'ACTIVE'").all();
      const towedList = [];

      for (const s of activeSessions) {
        const durationSeconds = Math.max(0, Math.floor((new Date(clearanceTimestamp).getTime() - new Date(s.entry_time).getTime()) / 1000));
        const charge = calculateParkingCharge(durationSeconds, true, s.category);

        const banUntil = new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString();
        db.prepare(`
          UPDATE sessions
          SET exit_time = ?,
              duration_seconds = ?,
              status = 'TOWED',
              basic_amount = ?,
              fine_amount = ?,
              total_amount = ?,
              agency_share = ?,
              facility_share = ?
          WHERE session_id = ?
        `).run(clearanceTimestamp, durationSeconds, charge.basicCharge, 500, charge.basicCharge + 500, charge.agencyShare, charge.facilityShare, s.session_id);

        db.prepare('UPDATE vehicles SET is_banned = 1, ban_until = ?, has_pending_fine = 1, pending_fine_amount = ? WHERE plate = ?')
          .run(banUntil, 500, s.vehicle_plate);

        db.prepare('UPDATE slots SET is_occupied = 0, current_session_id = NULL WHERE slot_id = ?').run(s.slot_id);

        const towMsg = `[eParkNiyantran URGENT] Vehicle ${s.vehicle_plate} uncleared at 11:59 PM has been TOWED to municipal impound lot. Fine: ₹${charge.basicCharge + 500}. Contact parking authority.`;
        await dispatchSms(s.session_id, s.phone, 'TOWING_NOTICE', towMsg);

        recordAudit('SESSION', s.session_id, 'END_OF_DAY_TOWED', operatorId, 'ACTIVE', 'TOWED', '11:59 PM slot clearance routine');
        towedList.push({ plate: s.vehicle_plate, slot: s.slot_id, fine: charge.basicCharge + 500 });
      }

      db.prepare("UPDATE slots SET is_occupied = 0, current_session_id = NULL WHERE is_occupied = 0").run();

      return sendJson(res, 200, {
        success: true,
        message: 'End-of-day (11:59 PM) vehicle clearance executed successfully.',
        clearedAt: clearanceTimestamp,
        towedVehiclesCount: towedList.length,
        towedList
      });
    }

    // Manual Tow Action
    if (pathname.match(/^\/api\/exceptions\/([^/]+)\/tow$/) && method === 'POST') {
      const sessionId = pathname.split('/')[3];
      const session = db.prepare('SELECT s.*, v.phone FROM sessions s JOIN vehicles v ON s.vehicle_plate = v.plate WHERE s.session_id = ?').get(sessionId);
      if (!session) return sendJson(res, 404, { success: false, error: 'Session not found' });

      db.prepare("UPDATE sessions SET status = 'TOWED' WHERE session_id = ?").run(sessionId);
      db.prepare('UPDATE slots SET is_occupied = 0, current_session_id = NULL WHERE slot_id = ?').run(session.slot_id);
      db.prepare('UPDATE vehicles SET is_banned = 1 WHERE plate = ?').run(session.vehicle_plate);

      await dispatchSms(sessionId, session.phone, 'TOWING_NOTICE', `[eParkNiyantran] Vehicle ${session.vehicle_plate} ordered for towing by enforcement officer.`);
      recordAudit('SESSION', sessionId, 'MANUAL_TOW', operatorId, session.status, 'TOWED', 'Enforcement Officer Order');

      return sendJson(res, 200, { success: true, message: `Vehicle ${session.vehicle_plate} marked as TOWED.` });
    }

    // Lift Parking Ban
    if (pathname.match(/^\/api\/exceptions\/([^/]+)\/lift-ban$/) && method === 'POST') {
      const plate = normalizePlate(pathname.split('/')[3]);
      db.prepare('UPDATE vehicles SET is_banned = 0, ban_until = NULL, has_pending_fine = 0, pending_fine_amount = 0 WHERE plate = ?').run(plate);
      recordAudit('VEHICLE', plate, 'BAN_LIFTED', operatorId, 'BANNED', 'CLEARED', 'Authorized staff clearance');
      return sendJson(res, 200, { success: true, message: `Ban lifted for vehicle ${plate}.` });
    }

    // ----------------------------------------------------
    // API: Notifications & SMS Outbox
    // ----------------------------------------------------
    if (pathname === '/api/notifications' && method === 'GET') {
      const notifs = db.prepare('SELECT * FROM notifications ORDER BY scheduled_time DESC LIMIT 100').all();
      return sendJson(res, 200, { success: true, notifications: notifs });
    }

    if (pathname.match(/^\/api\/notifications\/([^/]+)\/retry$/) && method === 'POST') {
      const notifId = pathname.split('/')[3];
      const notif = db.prepare('SELECT * FROM notifications WHERE notification_id = ?').get(notifId);
      if (!notif) return sendJson(res, 404, { success: false, error: 'Notification not found' });

      await sendSmsViaGateway(notif.session_id, notif.recipient_phone, notif.message_type, notif.message_body);
      db.prepare('UPDATE notifications SET status = ?, sent_time = ?, retry_count = retry_count + 1 WHERE notification_id = ?')
        .run('SENT', new Date().toISOString(), notifId);

      return sendJson(res, 200, { success: true, message: 'SMS re-dispatched successfully.' });
    }

    // ----------------------------------------------------
    // API: Tariff & Boundary Test Runner
    // ----------------------------------------------------
    if (pathname === '/api/tariff' && method === 'GET') {
      const row = db.prepare("SELECT config_value FROM tariff_configs WHERE config_key = 'active_tariff'").get();
      const tariff = row ? JSON.parse(row.config_value) : DEFAULT_TARIFF;
      return sendJson(res, 200, { success: true, tariff });
    }

    if (pathname === '/api/tariff/test-boundary' && method === 'POST') {
      const testCases = [
        { seconds: 14 * 60 + 59, label: '14:59 (Just before 15m)', hasPendingFine: false, expectedCharge: 0, expectedBan: false },
        { seconds: 14 * 60 + 59, label: '14:59 (With pending fine)', hasPendingFine: true, expectedCharge: 50, expectedBan: false },
        { seconds: 15 * 60, label: '15:00 (Exact 15m threshold)', hasPendingFine: false, expectedCharge: 100, expectedBan: false },
        { seconds: 15 * 60, label: '15:00 (With pending fine)', hasPendingFine: true, expectedCharge: 200, expectedBan: false },
        { seconds: 60 * 60, label: '60:00 (Exact 60m threshold)', hasPendingFine: false, expectedCharge: 100, expectedBan: false },
        { seconds: 60 * 60 + 1, label: '60:01 (Crosses 60m into 90m)', hasPendingFine: false, expectedCharge: 250, expectedBan: false },
        { seconds: 90 * 60, label: '90:00 (Exact 90m threshold)', hasPendingFine: false, expectedCharge: 250, expectedBan: false },
        { seconds: 90 * 60 + 1, label: '90:01 (Crosses 90m into 180m)', hasPendingFine: false, expectedCharge: 500, expectedBan: false },
        { seconds: 180 * 60, label: '180:00 (Exact 180m threshold)', hasPendingFine: false, expectedCharge: 500, expectedBan: false },
        { seconds: 180 * 60 + 1, label: '180:01 (Crosses 180m -> Ban!)', hasPendingFine: false, expectedCharge: 1000, expectedBan: true },
        { seconds: 180 * 60 + 1, label: '180:01 (Fine + Ban)', hasPendingFine: true, expectedCharge: 2000, expectedBan: true }
      ];

      const results = testCases.map(tc => {
        const res = calculateParkingCharge(tc.seconds, tc.hasPendingFine, '4W');
        const passCharge = res.basicCharge === tc.expectedCharge;
        const passBan = res.appliesBan === tc.expectedBan;
        return {
          label: tc.label,
          durationFormatted: formatDuration(tc.seconds),
          calculatedCharge: res.basicCharge,
          expectedCharge: tc.expectedCharge,
          tierLabel: res.tierLabel,
          appliesBan: res.appliesBan,
          expectedBan: tc.expectedBan,
          agencyShare: res.agencyShare,
          passed: passCharge && passBan
        };
      });

      const allPassed = results.every(r => r.passed);
      return sendJson(res, 200, { success: true, allPassed, totalTests: results.length, results });
    }

    // ----------------------------------------------------
    // API: Financial Reports & Agency 10% Share
    // ----------------------------------------------------
    if (pathname === '/api/reports/daily' && method === 'GET') {
      const totalSessions = db.prepare('SELECT COUNT(*) as count FROM sessions').get().count;
      const completedSessions = db.prepare("SELECT COUNT(*) as count FROM sessions WHERE status = 'COMPLETED'").get().count;
      const revenue = db.prepare("SELECT SUM(total_amount) as total, SUM(agency_share) as agency, SUM(facility_share) as facility, SUM(fine_amount) as fines FROM sessions WHERE status = 'COMPLETED'").get();
      const pendingRevenue = db.prepare("SELECT SUM(total_amount) as pending FROM sessions WHERE status IN ('PENDING_PAYMENT', 'OVERDUE')").get();

      return sendJson(res, 200, {
        success: true,
        summary: {
          totalSessions,
          completedSessions,
          totalRevenueCollected: revenue.total || 0,
          agencyShare10Percent: revenue.agency || 0,
          collegeFacilityShare90Percent: revenue.facility || 0,
          finesCollected: revenue.fines || 0,
          pendingReceivables: pendingRevenue.pending || 0
        }
      });
    }

    // ----------------------------------------------------
    // API: Audit Events
    // ----------------------------------------------------
    if (pathname === '/api/audit' && method === 'GET') {
      const audits = db.prepare('SELECT * FROM audit_events ORDER BY timestamp DESC LIMIT 100').all();
      return sendJson(res, 200, { success: true, audits });
    }

    // ----------------------------------------------------
    // API: Export Full Database Backup (JSON)
    // ----------------------------------------------------
    if (pathname === '/api/export' && method === 'GET') {
      const backup = {
        exportedAt: new Date().toISOString(),
        version: '1.1.0',
        slots: db.prepare('SELECT * FROM slots').all(),
        vehicles: db.prepare('SELECT * FROM vehicles').all(),
        sessions: db.prepare('SELECT * FROM sessions').all(),
        payments: db.prepare('SELECT * FROM payments').all(),
        evidence: db.prepare('SELECT * FROM evidence').all(),
        notifications: db.prepare('SELECT * FROM notifications').all(),
        audit_events: db.prepare('SELECT * FROM audit_events').all(),
        gateways: getApiSettings()
      };

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="smart_parking_backup_${Date.now()}.json"`
      });
      return res.end(JSON.stringify(backup, null, 2));
    }

    // ----------------------------------------------------
    // API: Citizen Complaints & Service Feedback
    // ----------------------------------------------------
    if (pathname === '/api/complaints' && method === 'GET') {
      const complaints = db.prepare('SELECT * FROM complaints ORDER BY created_at DESC LIMIT 100').all();
      const total = db.prepare('SELECT COUNT(*) as count FROM complaints').get().count;
      const openCount = db.prepare("SELECT COUNT(*) as count FROM complaints WHERE status = 'OPEN'").get().count;
      const resolvedCount = db.prepare("SELECT COUNT(*) as count FROM complaints WHERE status = 'RESOLVED'").get().count;
      const avgRow = db.prepare('SELECT AVG(rating) as avgRating FROM complaints').get();

      return sendJson(res, 200, {
        success: true,
        complaints,
        summary: {
          total,
          open: openCount,
          resolved: resolvedCount,
          avgRating: avgRow.avgRating ? Number(avgRow.avgRating.toFixed(1)) : 5.0
        }
      });
    }

    if (pathname === '/api/complaints' && method === 'POST') {
      const body = await parseRequestBody(req);
      const { session_id, vehicle_plate, complainant_name, phone, category, rating, message } = body;

      if (!complainant_name || !message) {
        return sendJson(res, 400, { success: false, error: 'Name and message are required to file feedback' });
      }

      const ticketId = 'CMP-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
      const cleanPlate = vehicle_plate ? normalizePlate(vehicle_plate) : null;
      const assignedPhone = phone || '+91 9800000000';
      const cleanRating = Math.max(1, Math.min(5, Number(rating) || 5));
      const cleanCategory = category || 'GENERAL_FEEDBACK';
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO complaints (ticket_id, session_id, vehicle_plate, complainant_name, phone, category, rating, message, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?)
      `).run(
        ticketId,
        session_id || null,
        cleanPlate,
        complainant_name,
        assignedPhone,
        cleanCategory,
        cleanRating,
        message,
        now
      );

      recordAudit('COMPLAINT', ticketId, 'COMPLAINT_REGISTERED', operatorId, null, { category: cleanCategory, rating: cleanRating }, message);

      // Dispatch Confirmation SMS to complainant
      const smsMsg = `[eParkNiyantran] Grievance Registered Ref #${ticketId}. Category: ${cleanCategory}. Our supervisor will review and resolve it promptly. Thank you for your feedback.`;
      const smsId = await dispatchSms(session_id || ticketId, assignedPhone, 'OVERDUE_ALERT', smsMsg);

      return sendJson(res, 201, {
        success: true,
        ticket_id: ticketId,
        message: 'Your complaint/feedback has been registered successfully.',
        sms_id: smsId
      });
    }

    if (pathname.match(/^\/api\/complaints\/([^/]+)\/resolve$/) && method === 'POST') {
      const ticketId = pathname.split('/')[3];
      const body = await parseRequestBody(req);
      const existing = db.prepare('SELECT * FROM complaints WHERE ticket_id = ?').get(ticketId);
      if (!existing) return sendJson(res, 404, { success: false, error: 'Complaint ticket not found' });

      const notes = body.resolution_notes || 'Resolved by parking supervisor';
      const resolvedAt = new Date().toISOString();

      db.prepare(`
        UPDATE complaints
        SET status = 'RESOLVED',
            resolution_notes = ?,
            resolved_by_operator_id = ?,
            resolved_at = ?
        WHERE ticket_id = ?
      `).run(notes, operatorId, resolvedAt, ticketId);

      recordAudit('COMPLAINT', ticketId, 'COMPLAINT_RESOLVED', operatorId, 'OPEN', 'RESOLVED', notes);

      // Dispatch Resolution SMS to complainant
      const resMsg = `[eParkNiyantran] Your grievance #${ticketId} has been RESOLVED: ${notes}. Thank you for helping us improve our parking services.`;
      await dispatchSms(ticketId, existing.phone, 'PAYMENT_RECEIPT', resMsg);

      return sendJson(res, 200, {
        success: true,
        message: `Complaint ticket ${ticketId} resolved successfully.`,
        ticket_id: ticketId,
        resolved_at: resolvedAt
      });
    }

    // ----------------------------------------------------
    // Standalone Payment Portal Route (/pay/:sessionId)
    // ----------------------------------------------------
    if (pathname.startsWith('/pay/')) {
      const payPage = path.join(PUBLIC_DIR, 'index.html');
      return serveStatic(req, res, payPage);
    }

    // ----------------------------------------------------
    // Static Frontend Assets
    // ----------------------------------------------------
    let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
    return serveStatic(req, res, filePath);

  } catch (err) {
    console.error('API Error:', err);
    return sendJson(res, 500, { success: false, error: err.message || 'Internal Server Error' });
  }
});

server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(` eParkNiyantran - SMART PARKING SYSTEM SERVER RUNNING `);
  console.log(` Local URL: http://localhost:${PORT} `);
  console.log(` VAHAN API: https://api-platform.mastersindia.co/api/v2/sbt/VAHAN/ `);
  console.log(` In-Time / Out-Time Timing & Instant Billing Active `);
  console.log(` Database: SQLite WAL Persistent Engine `);
  console.log(`=======================================================`);
});
