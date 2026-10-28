# eParkNiyantran - Smart Parking & Revenue Management System

A production-grade, full-stack Smart Parking Management System featuring **In-Time & Out-Time Schedule Tracking**, **Instant Bill Generation at Parking Entry**, **Masters India VAHAN API Verification**, **DLT SMS Alerts**, **Razorpay Fintech Integration**, and a **10% Agency Revenue Share Model**.

---

## 🌟 Key Features & Gateway Integrations

### 1. In-Time / Out-Time Scheduling & Instant Bill Generation at Parking
- **Entry Schedule Selection:** At the time of parking, attendants/users are prompted for both **In-Time (Entry)** and **Out-Time (Planned Exit)** with quick presets (+15m, +1 hr, +1.5 hrs, +2 hrs, +3.5 hrs).
- **Instant Bill Generation:** Automatically calculates planned duration and generates a formal **eParkNiyantran Parking Bill / Tax Invoice** right at entry time with a unique Bill ID (`EPN-BILL-YYYYMMDD-XXXX`).
- **Printable Bill Slip & Advance Payment:** Attendants can print the thermal/A4 parking pass, collect cash, or allow the customer to scan the instant UPI QR code / Pay via Razorpay.
- **SMS Pass:** Dispatches an entry welcome message including bay number, in-time, out-time, bill number, and payment link directly to the driver's phone.

### 1. Masters India VAHAN API Integration (`https://api-platform.mastersindia.co/api/v2/sbt/VAHAN/`)
- **Real-Time Existence Detection:** Automatically queries the Masters India VAHAN Search API for **every vehicle** at entry to verify whether the vehicle genuinely exists on the Indian National Vehicle Registry.
- **Counterfeit Plate Detection:** Immediately detects and flags non-existent, fake, or unregistered vehicles (e.g. `FAKE99XX0000`), blocking gate access unless authorized by a supervisor exemption.
- **RTO Profile Auto-Fill:** Fetches vehicle class (Two-Wheeler vs Four-Wheeler), registered owner name, contact mobile number, maker/model (e.g. Hyundai Creta, Bajaj Pulsar), and fitness/RC expiry date.

### 2. DLT-Compliant Indian SMS Gateways
- **Multiple Gateway Providers:** Supports **Fast2SMS** (Bulk V2 API), **MSG91** (Flow API), **Custom Webhooks**, and an **In-App Virtual Smartphone Simulator**.
- **Automated Lifecycle Alerts:**
  - Welcome & Slot Assignment SMS
  - **5-Minute Reminder Alert:** Triggered 5 minutes prior to tariff tier expiration to prevent unintended parking charge increases.
  - Exit Bill & Digital Payment Link SMS.
  - Verified Payment Receipt with gate pass passkey.
  - Overdue warning and municipal impound towing notices.

### 3. Razorpay Payment Gateway Integration
- **Official Razorpay Checkout SDK:** Interactive popup supporting UPI (GPay, PhonePe, Paytm), Debit/Credit Cards, and NetBanking.
- **Orders API:** Generates live orders via `https://api.razorpay.com/v1/orders` or standard sandbox orders.
- **HMAC SHA256 Signature Verification:** Server validates payment callbacks using `crypto.createHmac('sha256', secret).update(order_id + "|" + payment_id).digest('hex')`.
- Payment status transitions only after authenticated callback, freeing the bay slot and recording reconciliation logs.

### 4. Attendant Terminal & Plate Recognition (ALPR / OCR)
- **Front & Rear Plate Capture:** Live camera support and high-fidelity Indian High Security Registration Plate (HSRP) visual rendering with the blue `IND` strip and laser hologram.
- **Human Verification & Audit Log:** Operator can review or manually correct plate characters; all corrections are permanently stored in the audit trail.

### 5. Dual-Zone Slot Allocation & IoT Hardware Layer
- **Zone A:** 12 dedicated Two-Wheeler bays (`2W-01` to `2W-12`).
- **Zone B:** 16 dedicated Four-Wheeler bays (`4W-01` to `4W-16`).
- **IoT & ESP32 Simulation:** Emulates ultrasonic distance rangefinders, MQTT broker topics (`parking/zoneA/telemetry`), and solenoid boom barrier relay pulses (5s).
- **Manual Sensor Override:** Instant hardware override toggle for any bay.

### 6. Configurable Billing & Tariff Boundary Engine (Section 8)
- Exact boundary decisions implemented:
  - `< 15 minutes`: **Nil (₹0)** *(or ₹50 if pending fine)*
  - `Up to 60 minutes`: **₹100** *(or ₹200 if pending fine)*
  - `Up to 90 minutes`: **₹250** *(or ₹500 if pending fine)*
  - `Up to 180 minutes`: **₹500** *(or ₹1,000 if pending fine)*
  - `> 180 minutes`: **₹1,000 + 10-day parking ban** *(or ₹2,000 + ban if pending fine)*
- **Agency Revenue Split:** **10% of basic parking charge** automatically calculated and credited to the Parking Personnel Agency (90% to College / Facility).
- **Automated Boundary Test Suite:** Live UI runner and unit tests for boundaries: `14:59`, `15:00`, `60:00`, `90:00`, and `180:00`.

### 7. Exceptions, Parking Bans & End-of-Day Clearance (11:59 PM)
- **Overdue Management:** Applies ₹100/day late fine for unpaid departed sessions.
- **10-Day Parking Ban:** Automatically blocks gate entry for vehicles with past violations.
- **End-of-Day (11:59 PM) Sweep:** One-click routine that treats missing exits as 11:59 PM departure, orders unauthorized lingering vehicles towed away, and resets vacant bays.

---

## 🚀 Quick Start Guide

### Prerequisites
- Node.js (v20+ or v26+)
- Zero external `npm` or `pip` dependencies needed! Built using native Node.js runtime and `node:sqlite`.

### Starting the Server
```bash
cd smart-parking-system
npm start
# Server runs at: http://localhost:3000
```

### Running Automated Tests
```bash
npm test
# Executes all 19 unit and integration tests (boundary tests, tariffs, VAHAN, SMS, Razorpay, and database lifecycle)
```

---

## 🏛️ System Architecture

```
[ Vehicle Entry Gate ]
       │
       ▼
[ Vehicle Capture ] ──────► [ Plate Recognition (OCR) ] ──────► [ Human Attendant Verification ]
(Front Camera / Phone)          (Confidence & Heuristics)                (Audit Logged)
                                                                               │
                                                                               ▼
[ Live Parking Grid ] ◄──── [ Parking Session Service ] ◄──── [ Masters India VAHAN API ]
(2W & 4W Bays + IoT)           (Entry Time, Slot, Status)       (https://api-platform.mastersindia.co)
       │                                     │                          (Existence Check: Yes/No)
       ▼                                     ▼
[ ESP32 Telemetry ]               [ 5-Minute Reminder Job ] ──► [ DLT SMS Gateway ]
(Ultrasonic Sensors)               (Background Daemon)          (Fast2SMS / MSG91 / Virtual Phone)
       │                                     │
       ▼                                     ▼
[ Vehicle Exit Gate ] ──────► [ Billing Engine (Section 8) ] ─► [ Razorpay Payment Gateway ]
(Rear Camera Verification)        (<15m, 60m, 90m, 180m, Ban)        (Verified HMAC SHA256 Webhook)
                                             │                                     │
                                             ▼                                     ▼
                                  [ 10% Agency Revenue Split ]          [ Slot Freed & Receipt ]
```

---

## 📂 Project Structure

```
smart-parking-system/
├── server.js            # Node.js HTTP server, REST endpoints, reminder daemon
├── integrations.js      # Masters India VAHAN client, SMS gateway, Razorpay order & HMAC verification
├── database.js          # SQLite WAL schema, table seeding & audit engine
├── billing.js           # Tariff calculations, boundary logic, 10% agency split
├── ocr.js               # Plate normalization, confidence heuristics & RTO format checker
├── package.json         # Scripts and project metadata
├── data/
│   └── smart_parking.db # Persistent SQLite database
├── test/
│   ├── billing.test.js      # 10 boundary tests (14:59, 15:00, 60:00, 90:00, 180:00)
│   ├── integrations.test.js # VAHAN existence, SMS gateway, Razorpay signature tests
│   └── integration.test.js  # Database, session lifecycle, and OCR verification tests
└── public/
    ├── index.html       # Single-Page Application with 9 operational tabs
    ├── app.js           # Frontend client logic, VAHAN checks, Razorpay checkout, live timers
    └── style.css        # Glassmorphic UI styling, HSRP plates, and phone mockup
```
