/**
 * eParkNiyantran - Smart Parking Management System - Frontend Application Logic
 * Integrations: Masters India VAHAN API, DLT SMS Gateways & Razorpay Payment Gateway.
 */

let currentOperator = 'OP-ATTENDANT-01';
let activeSessionsCache = [];
let slotsCache = [];
let currentPaymentSessionId = null;
let currentSelectedSessionForExit = null;
let currentVahanVerified = true;
let currentGeneratedBill = null;

// Initialize on DOM loaded
document.addEventListener('DOMContentLoaded', () => {
  initIcons();
  initClock();
  initThemeToggle();
  initTabs();
  initPresetButtons();
  initEntryWorkflow();
  initExitWorkflow();
  initPaymentModal();
  initBillModal();
  initComplaintWorkflow();
  initExceptionsActions();
  initBoundaryTestRunner();
  initIoTSimulator();
  initGatewaysTab();
  initExportAction();

  // Load initial data
  loadSlots();
  loadActiveSessions();
  loadExceptions();
  loadNotifications();
  loadReports();
  loadComplaints();
  loadGatewaySettings();

  // Trigger initial RTO lookup for default plate
  verifyRtoPlate('MH12AB1234');

  // Background polling intervals for real-time reactivity
  setInterval(loadSlots, 5000);
  setInterval(loadActiveSessions, 2000);
  setInterval(loadNotifications, 5000);
  setInterval(loadReports, 10000);
  setInterval(loadComplaints, 6000);
});

function initIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

// Live IST Clock
function initClock() {
  const clockEl = document.getElementById('liveClock');
  function updateTime() {
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
    const timeStr = now.toLocaleTimeString('en-IN', { hour12: false });
    clockEl.textContent = `${dateStr} • ${timeStr} IST`;
  }
  updateTime();
  setInterval(updateTime, 1000);

  // Operator select change
  document.getElementById('operatorSelect').addEventListener('change', (e) => {
    currentOperator = e.target.value;
  });
}

// Tab Switching
function initTabs() {
  const tabs = document.querySelectorAll('.tab-btn');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => {
        t.classList.remove('active', 'bg-blue-600', 'text-white');
        t.classList.add('text-slate-400');
      });
      tab.classList.add('active', 'bg-blue-600', 'text-white');
      tab.classList.remove('text-slate-400');

      const targetTabId = tab.getAttribute('data-tab');
      document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.add('hidden');
      });
      const activeContent = document.getElementById(targetTabId);
      if (activeContent) {
        activeContent.classList.remove('hidden');
      }

      initIcons();

      // Refresh specific tab data on activation
      if (targetTabId === 'tab-slots') loadSlots();
      if (targetTabId === 'tab-active-sessions') loadActiveSessions();
      if (targetTabId === 'tab-exceptions') loadExceptions();
      if (targetTabId === 'tab-sms') loadNotifications();
      if (targetTabId === 'tab-reports') loadReports();
      if (targetTabId === 'tab-feedback') loadComplaints();
      if (targetTabId === 'tab-gateways') loadGatewaySettings();
    });
  });
}

// Format Plate
function formatPlateDisplay(plate) {
  if (!plate) return '';
  const clean = plate.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (clean.length >= 8) {
    const st = clean.substring(0, 2);
    const rto = clean.substring(2, 4);
    const rest = clean.substring(4);
    const num = rest.slice(-4);
    const series = rest.slice(0, -4);
    return `${st} ${rto} ${series ? series + ' ' : ''}${num}`.trim();
  }
  return clean;
}

// Preset Plate Buttons
function initPresetButtons() {
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const plate = btn.getAttribute('data-plate');
      const category = btn.getAttribute('data-category');
      
      document.getElementById('inputEntryPlate').value = plate;
      document.getElementById('selectVehicleCategory').value = category;
      
      updatePlateVisual(plate);
      verifyRtoPlate(plate);
    });
  });
}

function updatePlateVisual(plate) {
  const display = formatPlateDisplay(plate) || 'MH 12 AB 1234';
  document.getElementById('plateNumberDisplay').textContent = display;
}

// Format local Date object to YYYY-MM-DDTHH:mm for datetime-local inputs
function toLocalISOString(date) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// Live Bill & Duration Preview in Entry Card
function updateEntryBillPreview() {
  const inInput = document.getElementById('inputEntryTime');
  const outInput = document.getElementById('inputExitTime');
  if (!inInput || !outInput) return;

  const inVal = inInput.value ? new Date(inInput.value).getTime() : Date.now();
  let outVal = outInput.value ? new Date(outInput.value).getTime() : (inVal + 60 * 60 * 1000);

  if (outVal <= inVal) {
    outVal = inVal + 15 * 60 * 1000;
    outInput.value = toLocalISOString(new Date(outVal));
  }

  const durationSec = Math.max(0, Math.floor((outVal - inVal) / 1000));
  const minutes = Math.ceil(durationSec / 60);
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const durationText = hrs > 0 ? `${hrs} hr ${mins} min` : `${mins} mins`;

  // Tariff calculation
  let basicCharge = 0;
  let tierLabel = '';
  let appliesBan = false;

  if (durationSec < 15 * 60) {
    basicCharge = 0;
    tierLabel = '< 15 minutes (Free)';
  } else if (durationSec <= 60 * 60) {
    basicCharge = 100;
    tierLabel = 'Up to 60 minutes';
  } else if (durationSec <= 90 * 60) {
    basicCharge = 250;
    tierLabel = 'Up to 90 minutes';
  } else if (durationSec <= 180 * 60) {
    basicCharge = 500;
    tierLabel = 'Up to 180 minutes';
  } else {
    basicCharge = 1000;
    tierLabel = '> 180 minutes (Ban Risk)';
    appliesBan = true;
  }

  // Pending fine check from current RTO display
  const hasFine = document.getElementById('rtoFineStatus')?.textContent?.includes('₹500') || false;
  const total = basicCharge + (hasFine ? 50 : 0);
  const agencyShare = Math.round(total * 0.1);
  const facilityShare = total - agencyShare;

  const durationEl = document.getElementById('previewDurationText');
  if (durationEl) durationEl.textContent = durationText;

  const tierBadgeEl = document.getElementById('previewTierBadge');
  if (tierBadgeEl) {
    tierBadgeEl.textContent = tierLabel;
    if (appliesBan) {
      tierBadgeEl.className = 'px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 text-[10px] font-bold border border-rose-500/40 animate-pulse';
    } else {
      tierBadgeEl.className = 'px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 text-[10px] font-semibold border border-blue-500/30';
    }
  }

  const totalBillEl = document.getElementById('previewTotalBill');
  if (totalBillEl) totalBillEl.textContent = `₹${total}`;

  const agencyEl = document.getElementById('previewAgencyShare');
  if (agencyEl) agencyEl.textContent = `₹${agencyShare}`;

  const facilityEl = document.getElementById('previewFacilityShare');
  if (facilityEl) facilityEl.textContent = `₹${facilityShare}`;
}

// Entry Workflow Setup (eParkNiyantran)
function initEntryWorkflow() {
  const inputPlate = document.getElementById('inputEntryPlate');
  const inputEntryTime = document.getElementById('inputEntryTime');
  const inputExitTime = document.getElementById('inputExitTime');

  // Initialize In-Time and Out-Time default values
  if (inputEntryTime && !inputEntryTime.value) {
    inputEntryTime.value = toLocalISOString(new Date());
  }
  if (inputExitTime && !inputExitTime.value) {
    inputExitTime.value = toLocalISOString(new Date(Date.now() + 60 * 60 * 1000));
  }

  // Initial preview calculation
  updateEntryBillPreview();

  // Listen for In-Time & Out-Time adjustments
  if (inputEntryTime) {
    inputEntryTime.addEventListener('change', () => {
      const inVal = new Date(inputEntryTime.value).getTime();
      const outVal = new Date(inputExitTime.value).getTime();
      if (outVal <= inVal) {
        inputExitTime.value = toLocalISOString(new Date(inVal + 60 * 60 * 1000));
      }
      updateEntryBillPreview();
    });
  }

  if (inputExitTime) {
    inputExitTime.addEventListener('change', updateEntryBillPreview);
    inputExitTime.addEventListener('input', updateEntryBillPreview);
  }

  // Set In-Time to current time
  const btnSetNow = document.getElementById('btnSetInTimeToNow');
  if (btnSetNow) {
    btnSetNow.addEventListener('click', () => {
      const now = new Date();
      inputEntryTime.value = toLocalISOString(now);
      inputExitTime.value = toLocalISOString(new Date(now.getTime() + 60 * 60 * 1000));
      updateEntryBillPreview();
    });
  }

  // Preset quick duration buttons (+15m, +1hr, +1.5hrs, +2hrs, +3.5hrs)
  document.querySelectorAll('.btn-duration-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      const mins = parseInt(btn.getAttribute('data-minutes') || '60', 10);
      const inVal = inputEntryTime.value ? new Date(inputEntryTime.value).getTime() : Date.now();
      const outDate = new Date(inVal + mins * 60 * 1000);
      inputExitTime.value = toLocalISOString(outDate);
      updateEntryBillPreview();
    });
  });

  inputPlate.addEventListener('input', () => {
    updatePlateVisual(inputPlate.value);
  });

  document.getElementById('btnVerifyPlate').addEventListener('click', () => {
    verifyRtoPlate(inputPlate.value);
  });

  document.getElementById('selectVehicleCategory').addEventListener('change', (e) => {
    populateSlotSelector(e.target.value);
    updateEntryBillPreview();
  });

  const chkOverride = document.getElementById('chkOverrideVahan');
  if (chkOverride) {
    chkOverride.addEventListener('change', () => {
      const entryBtn = document.getElementById('btnConfirmEntry');
      if (chkOverride.checked) {
        entryBtn.disabled = false;
        entryBtn.classList.remove('opacity-50', 'cursor-not-allowed');
      } else if (!currentVahanVerified) {
        entryBtn.disabled = true;
        entryBtn.classList.add('opacity-50', 'cursor-not-allowed');
      }
    });
  }

  document.getElementById('btnConfirmEntry').addEventListener('click', async () => {
    const rawPlate = inputPlate.value.trim();
    if (!rawPlate) {
      alert('Please enter a vehicle registration plate number.');
      return;
    }

    const isOverridden = chkOverride ? chkOverride.checked : false;
    if (!currentVahanVerified && !isOverridden) {
      alert('❌ Entry Blocked: Vehicle does not exist in the official Masters India VAHAN database.\n\nTo allow entry, check "Supervisor Exemption: Allow Entry for Unverified Vehicle".');
      return;
    }

    const category = document.getElementById('selectVehicleCategory').value;
    const slotId = document.getElementById('selectSlotAssignment').value;
    const inTime = inputEntryTime.value ? new Date(inputEntryTime.value).toISOString() : new Date().toISOString();
    const outTime = inputExitTime.value ? new Date(inputExitTime.value).toISOString() : new Date(Date.now() + 60 * 60 * 1000).toISOString();

    if (new Date(outTime) <= new Date(inTime)) {
      alert('⚠️ Out-Time must be scheduled after In-Time.');
      return;
    }

    const payload = {
      plate: rawPlate,
      category,
      slot_id: slotId || undefined,
      entry_time: inTime,
      expected_exit_time: outTime,
      out_time: outTime,
      ocr_raw: rawPlate,
      ocr_confidence: 0.96,
      manual_correction: false,
      allow_unverified: isOverridden
    };

    try {
      const res = await fetch('/api/sessions/entry', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Operator-Id': currentOperator
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to register vehicle entry');
        return;
      }

      // Update background data
      loadSlots();
      loadActiveSessions();
      loadNotifications();
      loadReports();

      // Show welcome in virtual phone
      const inTimeStr = new Date(inTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const outTimeStr = new Date(outTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      appendVirtualPhoneSms('ePark', `[eParkNiyantran] Welcome ${data.session.vehicle_plate}! Bay: ${data.session.slot_id}. In: ${inTimeStr}, Out: ${outTimeStr}. Bill #${data.session.bill_number}: ₹${data.session.total_amount}.`);

      // POP UP GENERATED BILL MODAL IMMEDIATELY
      if (data.bill) {
        showBillModal(data.bill);
      } else {
        alert(`✅ Vehicle ${data.session.vehicle_plate} parked!\nAllocated Bay: ${data.session.slot_id}\nBill #${data.session.bill_number}: ₹${data.session.total_amount}`);
      }

    } catch (err) {
      alert('Network or server error during entry registration');
    }
  });
}

// Verify Plate via Masters India VAHAN API
async function verifyRtoPlate(plate) {
  if (!plate) return;
  try {
    const res = await fetch(`/api/vehicles/lookup/${encodeURIComponent(plate)}`);
    const data = await res.json();
    
    const banner = document.getElementById('vahanStatusBanner');
    const bannerText = document.getElementById('vahanStatusText');
    const notFoundBox = document.getElementById('vahanNotFoundAlertBox');
    const entryBtn = document.getElementById('btnConfirmEntry');
    const chkOverride = document.getElementById('chkOverrideVahan');
    if (chkOverride) chkOverride.checked = false;

    // Check if vehicle exists on VAHAN
    if (data.exists && data.vehicle && data.vehicle.data) {
      currentVahanVerified = true;
      const v = data.vehicle.data;

      // Update banner to Verified
      if (banner) {
        banner.className = 'p-2 rounded-lg text-xs font-semibold flex items-center justify-between bg-emerald-500/10 text-emerald-400 border border-emerald-500/30';
        banner.innerHTML = `
          <div class="flex items-center space-x-1.5">
            <i data-lucide="check-circle-2" class="w-4 h-4 text-emerald-400"></i>
            <span id="vahanStatusText">VAHAN VERIFIED: Vehicle Exists in National Registry (${data.vehicle.source || 'Masters India'})</span>
          </div>
          <span class="text-[10px] font-mono text-slate-400">api-platform.mastersindia.co</span>
        `;
        initIcons();
      }
      if (notFoundBox) notFoundBox.classList.add('hidden');

      document.getElementById('rtoOwner').textContent = v.owner || 'Registered Citizen';
      document.getElementById('rtoModel').textContent = v.makeModel || 'Standard Vehicle';
      document.getElementById('rtoPhone').textContent = v.phone || '+91 98230 12345';
      document.getElementById('rtoRcStatus').textContent = v.rcStatus || 'ACTIVE';
      
      const categoryBadge = document.getElementById('rtoCategoryBadge');
      if (v.category === '2W') {
        categoryBadge.textContent = '2-Wheeler (Motorcycle/Scooter)';
        categoryBadge.className = 'px-2 py-0.5 bg-blue-500/20 text-blue-300 font-semibold rounded text-[10px]';
        document.getElementById('selectVehicleCategory').value = '2W';
      } else {
        categoryBadge.textContent = '4-Wheeler (Car/SUV)';
        categoryBadge.className = 'px-2 py-0.5 bg-indigo-500/20 text-indigo-300 font-semibold rounded text-[10px]';
        document.getElementById('selectVehicleCategory').value = '4W';
      }

      // Fine Status
      const fineEl = document.getElementById('rtoFineStatus');
      if (v.hasPendingFine) {
        fineEl.textContent = `Pending Fine: ₹${v.pendingFineAmount || 500}`;
        fineEl.className = 'text-amber-400 font-bold';
      } else {
        fineEl.textContent = 'None (₹0)';
        fineEl.className = 'text-emerald-400 font-medium';
      }

      // Ban Alert Box
      const banBox = document.getElementById('banAlertBox');
      if (v.isBanned) {
        banBox.classList.remove('hidden');
        entryBtn.disabled = true;
        entryBtn.classList.add('opacity-50', 'cursor-not-allowed');
      } else {
        banBox.classList.add('hidden');
        entryBtn.disabled = false;
        entryBtn.classList.remove('opacity-50', 'cursor-not-allowed');
      }

      populateSlotSelector(v.category || '4W');
      updateEntryBillPreview();

    } else {
      // VEHICLE DOES NOT EXIST ON VAHAN!
      currentVahanVerified = false;

      if (banner) {
        banner.className = 'p-2 rounded-lg text-xs font-semibold flex items-center justify-between bg-rose-500/20 text-rose-300 border border-rose-500/50';
        banner.innerHTML = `
          <div class="flex items-center space-x-1.5">
            <i data-lucide="alert-octagon" class="w-4 h-4 text-rose-400"></i>
            <span id="vahanStatusText">VAHAN ALERT: Vehicle Does NOT Exist on Masters India Registry!</span>
          </div>
          <span class="text-[10px] font-mono text-slate-400">api-platform.mastersindia.co</span>
        `;
        initIcons();
      }
      if (notFoundBox) notFoundBox.classList.remove('hidden');

      document.getElementById('rtoOwner').textContent = 'UNVERIFIED / UNREGISTERED';
      document.getElementById('rtoModel').textContent = 'Unknown / Counterfeit';
      document.getElementById('rtoPhone').textContent = '--';
      document.getElementById('rtoRcStatus').textContent = 'NOT_FOUND';
      
      const fineEl = document.getElementById('rtoFineStatus');
      fineEl.textContent = 'Unregistered';
      fineEl.className = 'text-rose-400 font-medium';

      entryBtn.disabled = true;
      entryBtn.classList.add('opacity-50', 'cursor-not-allowed');
    }
  } catch (err) {
    console.error('Failed to lookup VAHAN:', err);
  }
}

// Populate Slot Selector
function populateSlotSelector(category) {
  const select = document.getElementById('selectSlotAssignment');
  select.innerHTML = '<option value="">Auto-Assign Best Slot</option>';
  const matchingSlots = slotsCache.filter(s => s.category === category && !s.is_occupied);
  matchingSlots.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.slot_id;
    opt.textContent = `${s.slot_id} (${s.zone})`;
    select.appendChild(opt);
  });
}

// Load Slots Grid
async function loadSlots() {
  try {
    const res = await fetch('/api/slots');
    const data = await res.json();
    if (!data.success) return;

    slotsCache = data.slots;

    // Update KPI metrics
    document.getElementById('metricTotalBays').textContent = data.stats.total;
    document.getElementById('metricVacantBays').textContent = data.stats.totalVacant;
    document.getElementById('metricOccupiedBays').textContent = data.stats.totalOccupied;

    document.getElementById('zoneAStats').textContent = `${data.stats.twoWheelerOccupied} / ${data.stats.twoWheelerTotal} Occupied`;
    document.getElementById('zoneBStats').textContent = `${data.stats.fourWheelerOccupied} / ${data.stats.fourWheelerTotal} Occupied`;

    // Render Zone A
    const zoneAContainer = document.getElementById('gridZoneA');
    zoneAContainer.innerHTML = '';
    const zoneASlots = slotsCache.filter(s => s.category === '2W');
    zoneASlots.forEach(slot => {
      zoneAContainer.appendChild(createSlotCard(slot));
    });

    // Render Zone B
    const zoneBContainer = document.getElementById('gridZoneB');
    zoneBContainer.innerHTML = '';
    const zoneBSlots = slotsCache.filter(s => s.category === '4W');
    zoneBSlots.forEach(slot => {
      zoneBContainer.appendChild(createSlotCard(slot));
    });

    initIcons();
  } catch (err) {
    console.error('Failed to load slots:', err);
  }
}

function createSlotCard(slot) {
  const card = document.createElement('div');
  const isOccupied = !!slot.is_occupied;
  
  card.className = `parking-slot-card p-3 rounded-xl border flex flex-col justify-between h-28 ${
    isOccupied ? 'slot-occupied' : 'slot-vacant'
  }`;

  const iconName = slot.category === '2W' ? 'bike' : 'car';

  card.innerHTML = `
    <div class="flex items-center justify-between">
      <span class="font-mono font-bold text-xs ${isOccupied ? 'text-rose-300' : 'text-emerald-300'}">${slot.slot_id}</span>
      <i data-lucide="${iconName}" class="w-4 h-4 ${isOccupied ? 'text-rose-400' : 'text-emerald-400'}"></i>
    </div>
    <div class="my-auto">
      ${isOccupied 
        ? `<div class="font-mono text-xs font-bold text-white tracking-wide truncate">${formatPlateDisplay(slot.vehicle_plate)}</div>
           <div class="text-[10px] text-slate-400 flex items-center space-x-1 mt-0.5">
             <i data-lucide="clock" class="w-2.5 h-2.5 text-blue-400"></i>
             <span class="slot-timer" data-entry="${slot.entry_time}">--</span>
           </div>`
        : `<div class="text-xs text-emerald-400 font-medium">VACANT</div>
           <div class="text-[9px] text-slate-500">Sensor: ${slot.sensor_status}</div>`
      }
    </div>
    <div class="flex items-center justify-between pt-1 border-t border-slate-800/60 text-[9px]">
      <span class="text-slate-500">${slot.category === '2W' ? '2-Wheeler' : '4-Wheeler'}</span>
      <button class="sensor-toggle-btn text-slate-400 hover:text-white" title="Toggle IoT Sensor" data-slot="${slot.slot_id}">
        <i data-lucide="radio" class="w-3 h-3 text-slate-400"></i>
      </button>
    </div>
  `;

  // Click card to open exit checkout if occupied or entry if vacant
  card.addEventListener('click', (e) => {
    if (e.target.closest('.sensor-toggle-btn')) return;
    if (isOccupied && slot.current_session_id) {
      document.querySelector('[data-tab="tab-attendant"]').click();
      document.getElementById('selectExitSession').value = slot.current_session_id;
      handleExitSessionSelect(slot.current_session_id);
    } else {
      document.querySelector('[data-tab="tab-attendant"]').click();
      document.getElementById('selectSlotAssignment').value = slot.slot_id;
    }
  });

  // Sensor Toggle handler
  const sensorBtn = card.querySelector('.sensor-toggle-btn');
  sensorBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      const res = await fetch(`/api/slots/${slot.slot_id}/sensor-toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (data.success) {
        loadSlots();
      }
    } catch (err) {
      console.error(err);
    }
  });

  return card;
}

// Load Active Sessions & Update Real-Time Bill Accrual
async function loadActiveSessions() {
  try {
    const res = await fetch('/api/sessions/active');
    const data = await res.json();
    if (!data.success) return;

    activeSessionsCache = data.sessions;

    // Update Exit Dropdown
    const exitSelect = document.getElementById('selectExitSession');
    const currentVal = exitSelect.value;
    exitSelect.innerHTML = '<option value="">-- Choose active session or enter plate below --</option>';
    activeSessionsCache.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.session_id;
      opt.textContent = `${formatPlateDisplay(s.vehicle_plate)} (Slot: ${s.slot_id}) - ${s.duration_formatted} [₹${s.estimated_amount}]`;
      exitSelect.appendChild(opt);
    });
    if (currentVal) exitSelect.value = currentVal;

    // Filter active sessions by search query if any
    const searchVal = (document.getElementById('searchSessionsInput')?.value || '').trim().toLowerCase();
    const filteredSessions = searchVal ? activeSessionsCache.filter(s =>
      (s.vehicle_plate && s.vehicle_plate.toLowerCase().includes(searchVal)) ||
      (s.slot_id && s.slot_id.toLowerCase().includes(searchVal)) ||
      (s.owner_name && s.owner_name.toLowerCase().includes(searchVal)) ||
      (s.session_id && s.session_id.toLowerCase().includes(searchVal))
    ) : activeSessionsCache;

    // Update Active Sessions Table
    const tbody = document.getElementById('activeSessionsTableBody');
    tbody.innerHTML = '';

    if (filteredSessions.length === 0) {
      tbody.innerHTML = `<tr><td colspan="11" class="p-6 text-center text-slate-500 font-medium">${searchVal ? 'No vehicles match your search query.' : 'No active vehicles currently parked — parking bays are open.'}</td></tr>`;
      return;
    }

    filteredSessions.forEach(s => {
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-slate-900/60 transition';
      const inTimeFormatted = new Date(s.entry_time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
      const outTimeFormatted = s.expected_exit_time ? new Date(s.expected_exit_time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '--:--';
      const billAmount = s.total_amount || s.estimated_amount;

      tr.innerHTML = `
        <td class="p-3 font-mono font-medium text-slate-300 text-[11px]">${s.session_id}</td>
        <td class="p-3 font-mono font-bold text-white">${formatPlateDisplay(s.vehicle_plate)}</td>
        <td class="p-3 font-mono text-blue-400 font-semibold">${s.slot_id}</td>
        <td class="p-3"><span class="px-2 py-0.5 rounded bg-slate-800 text-[10px] font-semibold text-slate-300">${s.category}</span></td>
        <td class="p-3 text-slate-300">${s.owner_name} <br><span class="text-[10px] text-slate-500 font-mono">${s.phone}</span></td>
        <td class="p-3 text-slate-300 font-mono text-[11px]">${inTimeFormatted}</td>
        <td class="p-3 text-slate-300 font-mono text-[11px]">${outTimeFormatted}</td>
        <td class="p-3 font-mono text-amber-300 font-bold">${s.duration_formatted}</td>
        <td class="p-3 text-slate-300 text-[11px]">${s.tier_label}</td>
        <td class="p-3 font-mono font-bold text-emerald-400 text-sm">
          ₹${billAmount}
          ${s.is_prepaid ? '<span class="ml-1 text-[9px] px-1 py-0.2 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded font-normal">PAID</span>' : ''}
        </td>
        <td class="p-3 text-right space-x-1 whitespace-nowrap">
          <button class="view-session-bill-btn px-2 py-1 bg-blue-600/20 hover:bg-blue-600/40 text-blue-300 border border-blue-500/30 rounded text-xs font-semibold" data-id="${s.session_id}">
            View Bill
          </button>
          <button class="checkout-session-btn px-2 py-1 bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 border border-emerald-500/30 rounded text-xs font-semibold" data-id="${s.session_id}">
            Exit &amp; Pay
          </button>
        </td>
      `;

      tr.querySelector('.view-session-bill-btn').addEventListener('click', async () => {
        try {
          const res = await fetch(`/api/sessions/${s.session_id}/bill`);
          const data = await res.json();
          if (data.success && data.bill) {
            showBillModal(data.bill);
          } else {
            alert(data.error || 'Failed to retrieve parking bill');
          }
        } catch (e) {
          alert('Network error retrieving parking bill');
        }
      });

      tr.querySelector('.checkout-session-btn').addEventListener('click', () => {
        document.querySelector('[data-tab="tab-attendant"]').click();
        exitSelect.value = s.session_id;
        handleExitSessionSelect(s.session_id);
      });

      tbody.appendChild(tr);
    });

    // Update Live slot timers on grid
    document.querySelectorAll('.slot-timer').forEach(el => {
      const entry = el.getAttribute('data-entry');
      if (entry) {
        const sec = Math.floor((Date.now() - new Date(entry).getTime()) / 1000);
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        el.textContent = `${m}m ${s}s`;
      }
    });

  } catch (err) {
    console.error('Failed to load active sessions:', err);
  }
}

// Exit Workflow Setup
function initExitWorkflow() {
  const exitSelect = document.getElementById('selectExitSession');
  exitSelect.addEventListener('change', () => {
    handleExitSessionSelect(exitSelect.value);
  });

  document.getElementById('btnConfirmExit').addEventListener('click', async () => {
    if (!currentSelectedSessionForExit) {
      alert('Please select an active parked vehicle for exit checkout.');
      return;
    }

    try {
      const res = await fetch(`/api/sessions/${currentSelectedSessionForExit.session_id}/exit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Operator-Id': currentOperator
        },
        body: JSON.stringify({
          exit_time: new Date().toISOString()
        })
      });

      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to process vehicle exit');
        return;
      }

      // If session was pre-paid at entry time and completed without balance due
      if (data.already_paid) {
        showReceiptModal('PREPAID-' + data.session_id.slice(-6), data.vehicle_plate, data.paid_amount, data.slot_freed);
        appendVirtualPhoneSms('ePark', `[eParkNiyantran] Exit verified for ${data.vehicle_plate}. Pre-paid bill ₹${data.paid_amount} cleared. Bay freed. Gate barrier OPEN.`);
        return;
      }

      // Success: open Digital Payment Modal immediately
      openPaymentModal(data.session_id, data.vehicle_plate, data.duration_formatted, data.tier_label, data.basic_charge);

      // Trigger Virtual Phone Alert
      appendVirtualPhoneSms('ePark', `[eParkNiyantran] Exit logged for ${data.vehicle_plate}. Duration: ${data.duration_formatted}. Total: ₹${data.basic_charge}. Pay online: ${data.payment_link}`);

      // Refresh data
      loadSlots();
      loadActiveSessions();
      loadExceptions();
      loadNotifications();
      loadReports();

    } catch (err) {
      alert('Error recording vehicle exit');
    }
  });
}

function handleExitSessionSelect(sessionId) {
  if (!sessionId) {
    currentSelectedSessionForExit = null;
    document.getElementById('exitPlateDisplay').textContent = '-- SELECT --';
    document.getElementById('billTierLabel').textContent = '--';
    document.getElementById('billDuration').textContent = '0m 0s';
    document.getElementById('billSlot').textContent = '--';
    document.getElementById('billBaseFee').textContent = '₹0';
    document.getElementById('billFineFee').textContent = '₹0';
    document.getElementById('billAgencyShare').textContent = '₹0';
    document.getElementById('billFacilityShare').textContent = '₹0';
    document.getElementById('billTotalAmount').textContent = '₹0';
    document.getElementById('over180BanNotice').classList.add('hidden');
    return;
  }

  const session = activeSessionsCache.find(s => s.session_id === sessionId);
  if (!session) return;

  currentSelectedSessionForExit = session;
  document.getElementById('exitPlateDisplay').textContent = formatPlateDisplay(session.vehicle_plate);
  document.getElementById('billTierLabel').textContent = session.tier_label;
  document.getElementById('billDuration').textContent = session.duration_formatted;
  document.getElementById('billSlot').textContent = session.slot_id;
  document.getElementById('billBaseFee').textContent = `₹${session.estimated_amount}`;
  document.getElementById('billFineFee').textContent = session.has_pending_fine ? `₹${session.pending_fine_amount || 50}` : '₹0';
  
  const agency = Math.round(session.estimated_amount * 0.10);
  document.getElementById('billAgencyShare').textContent = `₹${agency}`;
  document.getElementById('billFacilityShare').textContent = `₹${session.estimated_amount - agency}`;
  document.getElementById('billTotalAmount').textContent = `₹${session.estimated_amount}`;

  if (session.applies_ban) {
    document.getElementById('over180BanNotice').classList.remove('hidden');
  } else {
    document.getElementById('over180BanNotice').classList.add('hidden');
  }
}

// Payment Modal Logic & Provider Verification Callback
function initPaymentModal() {
  const modal = document.getElementById('paymentModal');
  const closeBtn = document.getElementById('closePaymentModalBtn');
  closeBtn.addEventListener('click', () => modal.classList.add('hidden'));

  // Official Razorpay Checkout Button
  document.getElementById('btnLaunchRazorpayCheckout').addEventListener('click', async () => {
    if (!currentPaymentSessionId) return;

    try {
      const res = await fetch(`/api/payments/${currentPaymentSessionId}/checkout`);
      const checkoutData = await res.json();
      if (!checkoutData.success) {
        alert('Failed to generate Razorpay order');
        return;
      }

      // Check if Razorpay script is loaded in browser
      if (typeof window.Razorpay === 'function') {
        const options = {
          key: checkoutData.payment.key_id,
          amount: checkoutData.payment.amount_in_paise,
          currency: 'INR',
          name: 'eParkNiyantran',
          description: `Parking Fee for ${checkoutData.session.vehicle_plate}`,
          order_id: checkoutData.payment.order_id,
          handler: async function (response) {
            // Verify signature on backend
            const verifyRes = await fetch('/api/payments/razorpay/verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Operator-Id': currentOperator },
              body: JSON.stringify({
                session_id: currentPaymentSessionId,
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
                method: 'RAZORPAY_CHECKOUT'
              })
            });
            const vData = await verifyRes.json();
            if (vData.success) {
              modal.classList.add('hidden');
              showReceiptModal(vData.payment_id, checkoutData.session.vehicle_plate, checkoutData.payment.amount, vData.slot_freed);
            } else {
              alert('Signature verification failed: ' + vData.error);
            }
          },
          prefill: {
            name: checkoutData.session.owner_name,
            contact: checkoutData.session.phone
          },
          theme: { color: '#2563eb' }
        };

        const rzp = new window.Razorpay(options);
        rzp.open();
      } else {
        // Fallback simulation in environments where external checkout iframe is blocked
        await processPaymentCallback('RAZORPAY_SANDBOX');
      }
    } catch (err) {
      console.error(err);
      await processPaymentCallback('RAZORPAY_SANDBOX');
    }
  });

  // Verified Payment Provider Webhook / Callback Simulator
  document.getElementById('btnSimulateSuccessCallback').addEventListener('click', async () => {
    if (!currentPaymentSessionId) return;
    await processPaymentCallback('UPI_QR');
  });

  // Cash backup
  document.getElementById('btnSimulateCashPayment').addEventListener('click', async () => {
    if (!currentPaymentSessionId) return;
    await processPaymentCallback('CASH_ATTENDANT');
  });

  document.getElementById('closeReceiptBtn').addEventListener('click', () => {
    document.getElementById('receiptModal').classList.add('hidden');
  });
}

function openPaymentModal(sessionId, plate, duration, slab, amount) {
  currentPaymentSessionId = sessionId;

  // If plate or details were omitted, resolve from cached generated bill or active session
  if (!plate && currentGeneratedBill && currentGeneratedBill.session_id === sessionId) {
    plate = currentGeneratedBill.vehicle_plate;
    duration = currentGeneratedBill.duration_formatted;
    slab = currentGeneratedBill.tier_label;
    amount = currentGeneratedBill.total_amount;
  } else if (!plate) {
    const s = activeSessionsCache.find(x => x.session_id === sessionId);
    if (s) {
      plate = s.vehicle_plate;
      duration = s.duration_formatted;
      slab = s.tier_label;
      amount = s.total_amount || s.estimated_amount;
    }
  }

  document.getElementById('modalVehiclePlate').textContent = formatPlateDisplay(plate || '--');
  document.getElementById('modalDuration').textContent = duration || '--';
  document.getElementById('modalSlab').textContent = slab || '--';
  document.getElementById('modalAmountDue').textContent = `₹${amount !== undefined ? amount : 0}`;

  // Generate dynamic QR SVG
  generateQrSvg(plate, amount);

  document.getElementById('paymentModal').classList.remove('hidden');
  initIcons();
}

// Show eParkNiyantran Official Bill / Parking Slip Modal
function showBillModal(bill) {
  if (!bill) return;
  currentGeneratedBill = bill;

  const modal = document.getElementById('entryBillModal');
  if (!modal) return;

  const billNoEl = document.getElementById('billModalBillNo');
  if (billNoEl) billNoEl.textContent = bill.bill_number || ('EPN-BILL-' + (bill.session_id || '').slice(-6));

  const dateEl = document.getElementById('billModalDate');
  if (dateEl) dateEl.textContent = new Date(bill.generated_at || bill.entry_time || Date.now()).toLocaleDateString('en-IN');

  const plateEl = document.getElementById('billModalPlate');
  if (plateEl) plateEl.textContent = formatPlateDisplay(bill.vehicle_plate);

  const modelEl = document.getElementById('billModalModel');
  if (modelEl) modelEl.textContent = bill.make_model || 'Standard Vehicle';

  const ownerEl = document.getElementById('billModalOwner');
  if (ownerEl) ownerEl.textContent = `${bill.owner_name || 'Registered Driver'} (${bill.phone || '+91 9800000000'})`;

  const slotEl = document.getElementById('billModalSlot');
  if (slotEl) slotEl.textContent = `${bill.slot_id} (${bill.category === '2W' ? 'Zone A - Two-Wheelers' : 'Zone B - Four-Wheelers'})`;

  const inDate = new Date(bill.entry_time);
  const outDate = new Date(bill.expected_exit_time || bill.out_time || inDate.getTime() + 3600000);

  const inTimeEl = document.getElementById('billModalInTime');
  if (inTimeEl) inTimeEl.textContent = inDate.toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' });

  const outTimeEl = document.getElementById('billModalOutTime');
  if (outTimeEl) outTimeEl.textContent = outDate.toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' });

  const durEl = document.getElementById('billModalDuration');
  if (durEl) durEl.textContent = bill.duration_formatted || formatDuration(bill.duration_seconds || 3600);

  const tierEl = document.getElementById('billModalTier');
  if (tierEl) tierEl.textContent = bill.tier_label || 'Standard Tariff';

  const baseEl = document.getElementById('billModalBaseFee');
  if (baseEl) baseEl.textContent = `₹${bill.basic_amount !== undefined ? bill.basic_amount : (bill.total_amount || 0)}`;

  const fineEl = document.getElementById('billModalFineFee');
  if (fineEl) fineEl.textContent = `₹${bill.fine_amount || 0}`;

  const agencyEl = document.getElementById('billModalAgencyShare');
  if (agencyEl) agencyEl.textContent = `₹${bill.agency_share !== undefined ? bill.agency_share : Math.round((bill.total_amount || 0) * 0.1)}`;

  const facEl = document.getElementById('billModalFacilityShare');
  if (facEl) facEl.textContent = `₹${bill.facility_share !== undefined ? bill.facility_share : ((bill.total_amount || 0) - Math.round((bill.total_amount || 0) * 0.1))}`;

  const totalEl = document.getElementById('billModalTotalAmount');
  if (totalEl) totalEl.textContent = `₹${bill.total_amount || 0}`;

  const statusBadge = document.getElementById('billModalPaymentStatus');
  if (statusBadge) {
    if (bill.is_prepaid) {
      statusBadge.textContent = 'PRE-PAID (PAID)';
      statusBadge.className = 'px-2 py-0.5 rounded font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30';
    } else {
      statusBadge.textContent = 'PAYMENT DUE';
      statusBadge.className = 'px-2 py-0.5 rounded font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30';
    }
  }

  // Render QR SVG
  const qrContainer = document.getElementById('billModalQrCode');
  if (qrContainer) {
    qrContainer.innerHTML = generateMockQrSvg(bill.upi_string || `upi://pay?pa=eparkniyantran@okhdfcbank&pn=eParkNiyantran&am=${bill.total_amount}&tr=${bill.session_id}`);
  }

  modal.classList.remove('hidden');
  initIcons();
}

function generateMockQrSvg(upiString) {
  return `
    <svg width="120" height="120" viewBox="0 0 140 140" xmlns="http://www.w3.org/2000/svg">
      <rect width="140" height="140" fill="white"/>
      <rect x="10" y="10" width="35" height="35" fill="black"/>
      <rect x="15" y="15" width="25" height="25" fill="white"/>
      <rect x="20" y="20" width="15" height="15" fill="black"/>
      <rect x="95" y="10" width="35" height="35" fill="black"/>
      <rect x="100" y="15" width="25" height="25" fill="white"/>
      <rect x="105" y="20" width="15" height="15" fill="black"/>
      <rect x="10" y="95" width="35" height="35" fill="black"/>
      <rect x="15" y="100" width="25" height="25" fill="white"/>
      <rect x="20" y="105" width="15" height="15" fill="black"/>
      <rect x="55" y="15" width="10" height="25" fill="black"/>
      <rect x="70" y="25" width="15" height="10" fill="black"/>
      <rect x="55" y="55" width="30" height="30" fill="#2563eb"/>
      <rect x="62" y="62" width="16" height="16" fill="white"/>
      <text x="70" y="74" font-size="9" font-weight="bold" text-anchor="middle" fill="#2563eb">₹</text>
      <rect x="15" y="55" width="20" height="10" fill="black"/>
      <rect x="15" y="75" width="30" height="10" fill="black"/>
      <rect x="95" y="55" width="30" height="10" fill="black"/>
      <rect x="105" y="75" width="20" height="10" fill="black"/>
      <rect x="55" y="95" width="15" height="25" fill="black"/>
      <rect x="75" y="110" width="25" height="15" fill="black"/>
      <rect x="110" y="105" width="20" height="20" fill="black"/>
    </svg>
  `;
}

// Initialize Bill Modal Listeners
function initBillModal() {
  const modal = document.getElementById('entryBillModal');
  if (!modal) return;

  const closeBtn = document.getElementById('btnCloseBillModal');
  const doneBtn = document.getElementById('btnDoneBillModal');
  const printBtn = document.getElementById('btnPrintBillBtn');
  const payNowBtn = document.getElementById('btnPayBillNowBtn');
  const cashPaidBtn = document.getElementById('btnMarkBillCashPaidBtn');
  const billGrievanceBtn = document.getElementById('btnBillFileGrievance');

  const closeModal = () => modal.classList.add('hidden');
  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (doneBtn) doneBtn.addEventListener('click', closeModal);

  if (billGrievanceBtn) {
    billGrievanceBtn.addEventListener('click', () => {
      closeModal();
      openComplaintModal({
        session_id: currentGeneratedBill ? currentGeneratedBill.session_id : '',
        vehicle_plate: currentGeneratedBill ? currentGeneratedBill.vehicle_plate : '',
        category: 'TARIFF_OVERCHARGE'
      });
    });
  }

  if (printBtn) {
    printBtn.addEventListener('click', () => {
      window.print();
    });
  }

  if (payNowBtn) {
    payNowBtn.addEventListener('click', () => {
      if (currentGeneratedBill && currentGeneratedBill.session_id) {
        closeModal();
        openPaymentModal(
          currentGeneratedBill.session_id,
          currentGeneratedBill.vehicle_plate,
          currentGeneratedBill.duration_formatted,
          currentGeneratedBill.tier_label,
          currentGeneratedBill.total_amount
        );
      }
    });
  }

  if (cashPaidBtn) {
    cashPaidBtn.addEventListener('click', async () => {
      if (!currentGeneratedBill) return;
      try {
        const res = await fetch('/api/payments/callback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Operator-Id': currentOperator },
          body: JSON.stringify({
            session_id: currentGeneratedBill.session_id,
            method: 'CASH_ATTENDANT',
            provider_ref: 'CASH-ENTRY-' + Date.now()
          })
        });
        const data = await res.json();
        if (data.success) {
          alert(`✅ Advance payment confirmed in cash for ${currentGeneratedBill.vehicle_plate}!\nReceipt Ref: ${data.transaction_ref}`);
          currentGeneratedBill.is_prepaid = 1;
          showBillModal(currentGeneratedBill);
          loadSlots();
          loadActiveSessions();
          loadReports();
        }
      } catch (e) {
        alert('Error recording cash payment');
      }
    });
  }
}

function showReceiptModal(txnRef, plate, amount, slot) {
  document.getElementById('receiptPlate').textContent = formatPlateDisplay(plate);
  document.getElementById('receiptTxnRef').textContent = txnRef;
  document.getElementById('receiptAmount').textContent = `₹${amount}`;
  document.getElementById('receiptSlot').textContent = slot;
  document.getElementById('receiptModal').classList.remove('hidden');

  loadSlots();
  loadActiveSessions();
  loadExceptions();
  loadNotifications();
  loadReports();
  initIcons();
}

async function processPaymentCallback(method) {
  try {
    const res = await fetch('/api/payments/callback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Operator-Id': currentOperator
      },
      body: JSON.stringify({
        session_id: currentPaymentSessionId,
        method
      })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Payment verification failed');
      return;
    }

    // Hide payment modal
    document.getElementById('paymentModal').classList.add('hidden');

    // Show verified receipt modal
    showReceiptModal(data.transaction_ref, document.getElementById('modalVehiclePlate').textContent, document.getElementById('modalAmountDue').textContent.replace('₹',''), data.slot_freed);

    // Add SMS to phone
    appendVirtualPhoneSms('ePark', `[Receipt] Payment of ${document.getElementById('modalAmountDue').textContent} VERIFIED via ${method}. Txn: ${data.transaction_ref}. Slot ${data.slot_freed} cleared. Gate barrier OPEN.`);

  } catch (err) {
    alert('Payment callback error');
  }
}

// Generate Realistic SVG QR Code
function generateQrSvg(plate, amount) {
  const container = document.getElementById('upiQrCodeContainer');
  const svg = `
    <svg width="130" height="130" viewBox="0 0 140 140" xmlns="http://www.w3.org/2000/svg">
      <rect width="140" height="140" fill="white"/>
      <rect x="10" y="10" width="35" height="35" fill="black"/>
      <rect x="15" y="15" width="25" height="25" fill="white"/>
      <rect x="20" y="20" width="15" height="15" fill="black"/>
      <rect x="95" y="10" width="35" height="35" fill="black"/>
      <rect x="100" y="15" width="25" height="25" fill="white"/>
      <rect x="105" y="20" width="15" height="15" fill="black"/>
      <rect x="10" y="95" width="35" height="35" fill="black"/>
      <rect x="15" y="100" width="25" height="25" fill="white"/>
      <rect x="20" y="105" width="15" height="15" fill="black"/>
      <rect x="55" y="15" width="10" height="25" fill="black"/>
      <rect x="70" y="25" width="15" height="10" fill="black"/>
      <rect x="55" y="55" width="30" height="30" fill="#2563eb"/>
      <rect x="62" y="62" width="16" height="16" fill="white"/>
      <text x="70" y="74" font-size="9" font-weight="bold" text-anchor="middle" fill="#2563eb">₹</text>
      <rect x="15" y="55" width="20" height="10" fill="black"/>
      <rect x="15" y="75" width="30" height="10" fill="black"/>
      <rect x="95" y="55" width="30" height="10" fill="black"/>
      <rect x="105" y="75" width="20" height="10" fill="black"/>
      <rect x="55" y="95" width="15" height="25" fill="black"/>
      <rect x="75" y="110" width="25" height="15" fill="black"/>
      <rect x="110" y="105" width="20" height="20" fill="black"/>
    </svg>
  `;
  container.innerHTML = svg;
}

// ----------------------------------------------------
// Gateways & API Settings Tab Logic
// ----------------------------------------------------
function initGatewaysTab() {
  document.getElementById('btnSaveAllGateways').addEventListener('click', async () => {
    const payload = {
      vahan: {
        endpointUrl: document.getElementById('cfgVahanEndpoint').value.trim(),
        apiKey: document.getElementById('cfgVahanApiKey').value.trim(),
        clientId: document.getElementById('cfgVahanClientId').value.trim(),
        mode: document.getElementById('cfgVahanMode').value
      },
      sms: {
        provider: document.getElementById('cfgSmsProvider').value,
        apiKey: document.getElementById('cfgSmsApiKey').value.trim(),
        senderId: document.getElementById('cfgSmsSenderId').value.trim()
      },
      payment: {
        provider: 'razorpay',
        keyId: document.getElementById('cfgRazorpayKeyId').value.trim(),
        keySecret: document.getElementById('cfgRazorpayKeySecret').value.trim(),
        mode: document.getElementById('cfgRazorpayMode').value
      }
    };

    try {
      const res = await fetch('/api/gateways/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Operator-Id': currentOperator },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        alert('✅ API Gateway Credentials updated successfully!');
        loadGatewaySettings();
      }
    } catch (e) {
      alert('Error updating gateway settings');
    }
  });

  // Test Masters India VAHAN Lookup Tool
  document.getElementById('btnTestVahanLookup').addEventListener('click', async () => {
    const plate = document.getElementById('testVahanPlateInput').value.trim();
    const output = document.getElementById('vahanTestOutputBox');
    output.classList.remove('hidden');
    output.innerHTML = '<span class="text-blue-400">Querying https://api-platform.mastersindia.co/api/v2/sbt/VAHAN/...</span>';

    try {
      const res = await fetch('/api/vahan/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plate })
      });
      const data = await res.json();
      const statusColor = data.exists ? 'text-emerald-400' : 'text-rose-400';
      output.innerHTML = `
        <div class="font-bold ${statusColor} pb-1 border-b border-slate-800">
          EXISTS: ${data.exists ? 'TRUE (Verified on VAHAN)' : 'FALSE (Not Found / Unregistered)'}
        </div>
        <div class="text-slate-400 pt-1">Response Time: ${data.responseTimeMs}ms</div>
        <div class="text-slate-400">Endpoint: ${data.endpointUsed}</div>
        <pre class="mt-1 text-slate-300 text-[9px] overflow-x-auto">${JSON.stringify(data.rawResponse || data, null, 2)}</pre>
      `;
    } catch (e) {
      output.innerHTML = `<span class="text-rose-400">Error: ${e.message}</span>`;
    }
  });

  // Test SMS Dispatch Tool
  document.getElementById('btnTestSendSms').addEventListener('click', async () => {
    const phone = document.getElementById('testSmsPhoneInput').value.trim();
    const output = document.getElementById('smsTestOutputBox');
    output.classList.remove('hidden');
    output.innerHTML = '<span class="text-emerald-400">Dispatching test SMS...</span>';

    try {
      const res = await fetch('/api/sms/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, message: '[Smart Parking Test] SMS Gateway connection verified!' })
      });
      const data = await res.json();
      output.innerHTML = `
        <div class="font-bold text-emerald-400">SMS STATUS: ${data.result.status}</div>
        <div class="text-slate-400">Provider: ${data.result.provider}</div>
        <div class="text-slate-400">DLT Template: ${data.result.dltTemplateId}</div>
        <div class="text-slate-400">ID: ${data.result.notificationId}</div>
      `;
      appendVirtualPhoneSms('ePark', `[Test SMS] Gateway connection verified for ${phone}.`);
      loadNotifications();
    } catch (e) {
      output.innerHTML = `<span class="text-rose-400">Error: ${e.message}</span>`;
    }
  });

  // Test Razorpay Order Tool
  document.getElementById('btnTestRazorpayOrder').addEventListener('click', async () => {
    const output = document.getElementById('razorpayTestOutputBox');
    output.classList.remove('hidden');
    output.innerHTML = '<span class="text-purple-400">Creating test order in Razorpay...</span>';

    try {
      const res = await fetch('/api/payments/razorpay/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 100, plate: 'MH12AB1234' })
      });
      const data = await res.json();
      output.innerHTML = `
        <div class="font-bold text-purple-400">ORDER CREATED: ${data.orderId}</div>
        <div class="text-slate-400">Amount: ₹${data.amount} (${data.amountInPaise} paise)</div>
        <div class="text-slate-400">Key ID: ${data.keyId}</div>
        <div class="text-slate-400">Engine: ${data.source}</div>
      `;
    } catch (e) {
      output.innerHTML = `<span class="text-rose-400">Error: ${e.message}</span>`;
    }
  });
}

async function loadGatewaySettings() {
  try {
    const res = await fetch('/api/gateways/settings');
    const data = await res.json();
    if (!data.success) return;

    const s = data.settings;
    if (document.getElementById('cfgVahanEndpoint')) document.getElementById('cfgVahanEndpoint').value = s.vahan.endpointUrl || '';
    if (document.getElementById('cfgVahanApiKey')) document.getElementById('cfgVahanApiKey').value = s.vahan.apiKey || '';
    if (document.getElementById('cfgVahanClientId')) document.getElementById('cfgVahanClientId').value = s.vahan.clientId || '';
    if (document.getElementById('cfgVahanMode')) document.getElementById('cfgVahanMode').value = s.vahan.mode || 'auto';

    if (document.getElementById('cfgSmsProvider')) document.getElementById('cfgSmsProvider').value = s.sms.provider || 'mock';
    if (document.getElementById('cfgSmsApiKey')) document.getElementById('cfgSmsApiKey').value = s.sms.apiKey || '';
    if (document.getElementById('cfgSmsSenderId')) document.getElementById('cfgSmsSenderId').value = s.sms.senderId || 'PARKNG';

    if (document.getElementById('cfgRazorpayKeyId')) document.getElementById('cfgRazorpayKeyId').value = s.payment.keyId || '';
    if (document.getElementById('cfgRazorpayKeySecret')) document.getElementById('cfgRazorpayKeySecret').value = s.payment.keySecret || '';
    if (document.getElementById('cfgRazorpayMode')) document.getElementById('cfgRazorpayMode').value = s.payment.mode || 'test';

    const lblSms = document.getElementById('lblCurrentSmsProvider');
    if (lblSms) lblSms.textContent = s.sms.provider.toUpperCase();
    const phoneSender = document.getElementById('phoneSenderIdDisplay');
    if (phoneSender) phoneSender.textContent = s.sms.senderId || 'PARKNG';

  } catch (e) {
    console.warn('Failed to load gateway settings:', e);
  }
}

// Load Exceptions, Bans & Overdue Queues
async function loadExceptions() {
  try {
    const res = await fetch('/api/exceptions');
    const data = await res.json();
    if (!data.success) return;

    const totalExceptions = (data.unpaid.length || 0) + (data.bannedVehicles.length || 0) + (data.missingExit.length || 0);
    const badge = document.getElementById('exceptionsBadge');
    if (totalExceptions > 0) {
      badge.textContent = totalExceptions;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }

    document.getElementById('unpaidCountBadge').textContent = data.unpaid.length;
    document.getElementById('bannedCountBadge').textContent = data.bannedVehicles.length;
    document.getElementById('missingExitBadge').textContent = data.missingExit.length;
    document.getElementById('towedCountBadge').textContent = data.towed.length;

    // Render Unpaid Sessions
    const unpaidList = document.getElementById('unpaidSessionsList');
    unpaidList.innerHTML = '';
    if (data.unpaid.length === 0) {
      unpaidList.innerHTML = '<div class="text-xs text-slate-500 py-3 text-center">No unpaid departed sessions.</div>';
    } else {
      data.unpaid.forEach(u => {
        const item = document.createElement('div');
        item.className = 'p-3 bg-slate-900 rounded-xl border border-slate-800 flex items-center justify-between text-xs';
        item.innerHTML = `
          <div>
            <div class="font-mono font-bold text-white">${formatPlateDisplay(u.vehicle_plate)}</div>
            <div class="text-slate-400 text-[11px]">${u.owner_name} • ${u.tier_label}</div>
            <div class="text-[10px] text-rose-400 font-semibold">Exited: ${new Date(u.exit_time).toLocaleTimeString()} • Unpaid</div>
          </div>
          <div class="text-right">
            <div class="font-bold text-rose-400 text-sm">₹${u.total_amount}</div>
            <button class="pay-unpaid-btn mt-1 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-[11px] font-bold" data-id="${u.session_id}">
              Collect
            </button>
          </div>
        `;
        item.querySelector('.pay-unpaid-btn').addEventListener('click', () => {
          openPaymentModal(u.session_id, u.vehicle_plate, `${Math.floor(u.duration_seconds/60)}m`, u.tier_label, u.total_amount);
        });
        unpaidList.appendChild(item);
      });
    }

    // Render Banned Vehicles
    const bannedList = document.getElementById('bannedVehiclesList');
    bannedList.innerHTML = '';
    if (data.bannedVehicles.length === 0) {
      bannedList.innerHTML = '<div class="text-xs text-slate-500 py-3 text-center">No active parking bans.</div>';
    } else {
      data.bannedVehicles.forEach(b => {
        const item = document.createElement('div');
        item.className = 'p-3 bg-rose-950/20 rounded-xl border border-rose-500/30 flex items-center justify-between text-xs';
        item.innerHTML = `
          <div>
            <div class="font-mono font-bold text-rose-300">${formatPlateDisplay(b.plate)}</div>
            <div class="text-slate-400 text-[11px]">${b.owner_name} • ${b.category}</div>
            <div class="text-[10px] text-rose-400 font-semibold">Banned Until: ${b.ban_until ? new Date(b.ban_until).toLocaleDateString() : 'Active Review'}</div>
          </div>
          <button class="lift-ban-btn px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded text-[11px] font-semibold" data-plate="${b.plate}">
            Lift Ban
          </button>
        `;
        item.querySelector('.lift-ban-btn').addEventListener('click', async () => {
          if (confirm(`Authorize lifting parking ban for ${b.plate}?`)) {
            await fetch(`/api/exceptions/${b.plate}/lift-ban`, {
              method: 'POST',
              headers: { 'X-Operator-Id': currentOperator }
            });
            loadExceptions();
            verifyRtoPlate(document.getElementById('inputEntryPlate').value);
          }
        });
        bannedList.appendChild(item);
      });
    }

    // Render Missing Exits (>4 hrs)
    const missingList = document.getElementById('missingExitList');
    missingList.innerHTML = '';
    if (data.missingExit.length === 0) {
      missingList.innerHTML = '<div class="text-xs text-slate-500 py-2 text-center">No missing-exit anomalies (>4 hrs).</div>';
    } else {
      data.missingExit.forEach(m => {
        const item = document.createElement('div');
        item.className = 'p-2.5 bg-slate-900 rounded-lg border border-amber-500/30 flex items-center justify-between text-xs';
        item.innerHTML = `
          <div>
            <span class="font-mono font-bold text-amber-300">${formatPlateDisplay(m.vehicle_plate)}</span>
            <span class="text-slate-400 ml-2">Slot: ${m.slot_id}</span>
            <div class="text-[10px] text-slate-500">Parked since: ${new Date(m.entry_time).toLocaleTimeString()}</div>
          </div>
          <button class="tow-btn px-2 py-1 bg-rose-600/20 hover:bg-rose-600/40 text-rose-300 border border-rose-500/40 rounded text-[10px] font-bold" data-id="${m.session_id}">
            Dispatch Tow
          </button>
        `;
        item.querySelector('.tow-btn').addEventListener('click', async () => {
          if (confirm(`Dispatch towing truck for unauthorized lingering vehicle ${m.vehicle_plate}?`)) {
            await fetch(`/api/exceptions/${m.session_id}/tow`, {
              method: 'POST',
              headers: { 'X-Operator-Id': currentOperator }
            });
            loadSlots();
            loadActiveSessions();
            loadExceptions();
          }
        });
        missingList.appendChild(item);
      });
    }

    // Render Towed List
    const towedList = document.getElementById('towedVehiclesList');
    towedList.innerHTML = '';
    if (data.towed.length === 0) {
      towedList.innerHTML = '<div class="text-xs text-slate-500 py-2 text-center">No impounded / towed vehicles.</div>';
    } else {
      data.towed.forEach(t => {
        const item = document.createElement('div');
        item.className = 'p-2.5 bg-slate-900 rounded-lg border border-purple-500/30 flex items-center justify-between text-xs';
        item.innerHTML = `
          <div>
            <span class="font-mono font-bold text-purple-300">${formatPlateDisplay(t.vehicle_plate)}</span>
            <span class="text-slate-400 ml-2">${t.owner_name}</span>
            <div class="text-[10px] text-slate-500">Towed: ${new Date(t.exit_time || t.entry_time).toLocaleString()}</div>
          </div>
          <span class="px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 text-[10px] font-mono font-bold">IMPOUNDED</span>
        `;
        towedList.appendChild(item);
      });
    }

  } catch (err) {
    console.error('Failed to load exceptions:', err);
  }
}

// Exceptions Action Buttons (Daily Fine & 11:59 PM Sweep)
function initExceptionsActions() {
  document.getElementById('btnApplyDailyFine').addEventListener('click', async () => {
    try {
      const res = await fetch('/api/exceptions/apply-daily-fine', {
        method: 'POST',
        headers: { 'X-Operator-Id': currentOperator }
      });
      const data = await res.json();
      if (data.success) {
        alert(`✅ ₹100/day late penalty applied to ${data.updatedCount} unpaid session(s). 10-day ban enforced.`);
        loadExceptions();
        loadNotifications();
        loadReports();
      }
    } catch (e) {
      alert('Error applying daily fine');
    }
  });

  const runSweep = async () => {
    if (!confirm('Execute End-of-Day (11:59 PM) Vehicle Clearance?\n\n• Treats missing-exit vehicles as 11:59 PM departures with penalty.\n• Any lingering vehicles will be marked for TOWING.\n• All vacant bays are cleared.')) {
      return;
    }
    try {
      const res = await fetch('/api/exceptions/end-of-day-clearance', {
        method: 'POST',
        headers: { 'X-Operator-Id': currentOperator }
      });
      const data = await res.json();
      if (data.success) {
        alert(`🧹 End-of-Day Clearance Completed!\n${data.towedVehiclesCount} unauthorized vehicles marked for towing.\nAll slots cleared.`);
        loadSlots();
        loadActiveSessions();
        loadExceptions();
        loadNotifications();
        loadReports();
      }
    } catch (e) {
      alert('Error running clearance sweep');
    }
  };

  document.getElementById('btnRun1159Sweep').addEventListener('click', runSweep);
  document.getElementById('quickClearanceBtn').addEventListener('click', runSweep);
}

// Automated Boundary Test Runner (Section 8 Verification)
function initBoundaryTestRunner() {
  document.getElementById('btnRunBoundaryTests').addEventListener('click', async () => {
    try {
      const res = await fetch('/api/tariff/test-boundary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      if (!data.success) return;

      const card = document.getElementById('boundaryTestResultsCard');
      card.classList.remove('hidden');

      const tbody = document.getElementById('boundaryTestTableBody');
      tbody.innerHTML = '';

      data.results.forEach(r => {
        const tr = document.createElement('tr');
        tr.className = r.passed ? 'hover:bg-slate-900' : 'bg-rose-950/30';
        tr.innerHTML = `
          <td class="p-2 font-medium text-white">${r.label}</td>
          <td class="p-2 font-mono text-slate-400">${r.durationFormatted}</td>
          <td class="p-2 font-mono font-bold ${r.passed ? 'text-emerald-400' : 'text-rose-400'}">₹${r.calculatedCharge}</td>
          <td class="p-2 font-mono text-slate-300">₹${r.expectedCharge}</td>
          <td class="p-2 text-slate-400">${r.tierLabel}</td>
          <td class="p-2 ${r.appliesBan ? 'text-rose-400 font-bold' : 'text-slate-500'}">${r.appliesBan ? '10-Day Ban' : 'None'}</td>
          <td class="p-2 text-right">
            <span class="px-2 py-0.5 rounded text-[10px] font-bold ${r.passed ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'}">
              ${r.passed ? 'PASS' : 'FAIL'}
            </span>
          </td>
        `;
        tbody.appendChild(tr);
      });

      const summaryBadge = document.getElementById('testSummaryStatus');
      if (data.allPassed) {
        summaryBadge.textContent = `ALL ${data.totalTests} TESTS PASSING`;
        summaryBadge.className = 'px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30';
      } else {
        summaryBadge.textContent = 'FAILURES DETECTED';
        summaryBadge.className = 'px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30';
      }

    } catch (e) {
      alert('Error executing boundary tests');
    }
  });
}

// IoT Simulator
function initIoTSimulator() {
  document.getElementById('btnTestGatePulse').addEventListener('click', () => {
    const btn = document.getElementById('btnTestGatePulse');
    btn.disabled = true;
    btn.textContent = 'Gate Pulse Active (Relay ON)...';
    btn.classList.add('bg-emerald-600', 'text-white');
    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = 'Test Gate Pulse (5s)';
      btn.classList.remove('bg-emerald-600', 'text-white');
    }, 5000);
  });
}

// Notifications & Virtual Smartphone
async function loadNotifications() {
  try {
    const res = await fetch('/api/notifications');
    const data = await res.json();
    if (!data.success) return;

    const tbody = document.getElementById('smsTableBody');
    tbody.innerHTML = '';
    
    if (data.notifications.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="p-4 text-center text-slate-500">No dispatched SMS messages yet.</td></tr>';
      return;
    }

    data.notifications.forEach(n => {
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-slate-900';
      tr.innerHTML = `
        <td class="p-2 font-mono text-[11px] text-slate-400">${n.notification_id}</td>
        <td class="p-2 font-mono text-white">${n.recipient_phone}</td>
        <td class="p-2 font-mono text-[10px] text-blue-400">${n.dlt_template_id}</td>
        <td class="p-2 text-slate-300 max-w-xs truncate">${n.message_body}</td>
        <td class="p-2"><span class="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 text-[10px] font-bold">${n.status}</span></td>
        <td class="p-2 text-right font-mono text-[10px] text-slate-400">${new Date(n.sent_time || n.scheduled_time).toLocaleTimeString()}</td>
      `;
      tbody.appendChild(tr);
    });

  } catch (err) {
    console.error('Failed to load notifications:', err);
  }
}

function appendVirtualPhoneSms(sender, message) {
  const screen = document.getElementById('virtualPhoneScreen');
  const bubble = document.createElement('div');
  bubble.className = 'sms-bubble';
  bubble.innerHTML = `
    <div class="text-[10px] text-blue-400 font-semibold">${sender} • Just Now</div>
    <div class="mt-1 text-slate-200">${message}</div>
  `;
  screen.prepend(bubble);
}

// Reports & Agency Share (10%)
async function loadReports() {
  try {
    const res = await fetch('/api/reports/daily');
    const data = await res.json();
    if (!data.success) return;

    const s = data.summary;
    document.getElementById('metricRevenue').textContent = `₹${s.totalRevenueCollected}`;
    document.getElementById('metricAgencyShare').textContent = `₹${s.agencyShare10Percent}`;
    document.getElementById('metricPendingAmount').textContent = `₹${s.pendingReceivables}`;

    document.getElementById('reportTotalRevenue').textContent = `₹${s.totalRevenueCollected}`;
    document.getElementById('reportAgencyShare').textContent = `₹${s.agencyShare10Percent}`;
    document.getElementById('reportFacilityShare').textContent = `₹${s.collegeFacilityShare90Percent}`;
    document.getElementById('reportFinesCollected').textContent = `₹${s.finesCollected}`;

    // Load Audit Log
    const auditRes = await fetch('/api/audit');
    const auditData = await auditRes.json();
    if (auditData.success) {
      const auditTbody = document.getElementById('auditTableBody');
      auditTbody.innerHTML = '';
      auditData.audits.forEach(a => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="p-2 font-mono text-[10px] text-slate-400">${new Date(a.timestamp).toLocaleTimeString()}</td>
          <td class="p-2 font-mono font-medium text-slate-300">${a.operator_id}</td>
          <td class="p-2 text-blue-400">${a.entity_type}</td>
          <td class="p-2 font-semibold text-slate-200">${a.action}</td>
          <td class="p-2 font-mono text-[10px] text-slate-400 max-w-[120px] truncate">${a.old_value || '-'}</td>
          <td class="p-2 font-mono text-[10px] text-emerald-400 max-w-[120px] truncate">${a.new_value || '-'}</td>
          <td class="p-2 text-slate-400">${a.reason || ''}</td>
        `;
        auditTbody.appendChild(tr);
      });
    }

  } catch (err) {
    console.error('Failed to load reports:', err);
  }
}

// Export Full Database Backup
function initExportAction() {
  const exportBtn = document.getElementById('btnExportData');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      window.location.href = '/api/export';
    });
  }
}

// ----------------------------------------------------
// Theme Toggle Engine (Light & Dark Modes)
// ----------------------------------------------------
function initThemeToggle() {
  const toggleBtn = document.getElementById('themeToggleBtn');
  const toggleIcon = document.getElementById('themeToggleIcon');
  const toggleText = document.getElementById('themeToggleText');

  function applyTheme(theme) {
    if (theme === 'light') {
      document.body.classList.add('theme-light');
      if (toggleText) toggleText.textContent = 'Dark Mode';
      if (toggleIcon) toggleIcon.setAttribute('data-lucide', 'moon');
    } else {
      document.body.classList.remove('theme-light');
      if (toggleText) toggleText.textContent = 'Light Mode';
      if (toggleIcon) toggleIcon.setAttribute('data-lucide', 'sun');
    }
    initIcons();
  }

  // Restore stored user preference or dark default
  const savedTheme = localStorage.getItem('epark_theme') || 'dark';
  applyTheme(savedTheme);

  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      const isCurrentlyLight = document.body.classList.contains('theme-light');
      const targetTheme = isCurrentlyLight ? 'dark' : 'light';
      localStorage.setItem('epark_theme', targetTheme);
      applyTheme(targetTheme);
    });
  }
}

// ----------------------------------------------------
// Citizen Grievances & Service Feedback Engine
// ----------------------------------------------------
let complaintsCache = [];

function openComplaintModal(prefill = {}) {
  const modal = document.getElementById('complaintModal');
  if (!modal) return;

  const sessionInput = document.getElementById('complaintSessionId');
  const plateInput = document.getElementById('complaintPlate');
  const catInput = document.getElementById('complaintCategory');

  if (sessionInput) sessionInput.value = prefill.session_id || '';
  if (plateInput && prefill.vehicle_plate) plateInput.value = prefill.vehicle_plate;
  if (catInput && prefill.category) catInput.value = prefill.category;

  // Reset rating stars to 5 default
  const starBtns = document.querySelectorAll('.star-rating-btn');
  const ratingInput = document.getElementById('complaintRating');
  const feedbackText = document.getElementById('starRatingFeedbackText');
  if (ratingInput) ratingInput.value = '5';
  starBtns.forEach(btn => {
    btn.classList.add('text-amber-400');
    btn.classList.remove('text-slate-600');
  });
  if (feedbackText) feedbackText.textContent = '5/5 (Delighted & Smooth)';

  modal.classList.remove('hidden');
  initIcons();
}

function closeComplaintModal() {
  const modal = document.getElementById('complaintModal');
  if (modal) modal.classList.add('hidden');
}

function initComplaintWorkflow() {
  const openBtn = document.getElementById('openComplaintModalBtn');
  const tabNewBtn = document.getElementById('btnTabNewComplaint');
  const closeBtn = document.getElementById('btnCloseComplaintModal');
  const cancelBtn = document.getElementById('btnCancelComplaintModal');
  const form = document.getElementById('complaintForm');
  const refreshBtn = document.getElementById('btnRefreshComplaints');
  const filterSelect = document.getElementById('complaintFilterStatus');

  // Interactive 5-Star Rating Widget
  const starBtns = document.querySelectorAll('.star-rating-btn');
  const ratingInput = document.getElementById('complaintRating');
  const feedbackText = document.getElementById('starRatingFeedbackText');

  const ratingLabels = {
    1: '1/5 (Very Dissatisfied)',
    2: '2/5 (Needs Improvement)',
    3: '3/5 (Average Experience)',
    4: '4/5 (Good Service)',
    5: '5/5 (Delighted & Smooth)'
  };

  function setStarRating(val) {
    if (ratingInput) ratingInput.value = val;
    starBtns.forEach(btn => {
      const bRating = Number(btn.getAttribute('data-rating')) || 0;
      if (bRating <= val) {
        btn.classList.add('text-amber-400');
        btn.classList.remove('text-slate-600');
      } else {
        btn.classList.remove('text-amber-400');
        btn.classList.add('text-slate-600');
      }
    });
    if (feedbackText) {
      feedbackText.textContent = ratingLabels[val] || `${val}/5`;
    }
  }

  starBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const val = Number(btn.getAttribute('data-rating')) || 5;
      setStarRating(val);
    });
    btn.addEventListener('mouseenter', () => {
      const val = Number(btn.getAttribute('data-rating')) || 5;
      setStarRating(val);
    });
  });

  const starContainer = document.getElementById('interactiveStarContainer');
  if (starContainer) {
    starContainer.addEventListener('mouseleave', () => {
      const current = Number(ratingInput?.value) || 5;
      setStarRating(current);
    });
  }

  // Hook up search filter for active sessions
  const searchSessionsEl = document.getElementById('searchSessionsInput');
  if (searchSessionsEl && !searchSessionsEl.dataset.initialized) {
    searchSessionsEl.dataset.initialized = 'true';
    searchSessionsEl.addEventListener('input', () => loadActiveSessions());
  }

  if (openBtn) openBtn.addEventListener('click', () => openComplaintModal());
  if (tabNewBtn) tabNewBtn.addEventListener('click', () => openComplaintModal());
  if (closeBtn) closeBtn.addEventListener('click', closeComplaintModal);
  if (cancelBtn) cancelBtn.addEventListener('click', closeComplaintModal);

  if (refreshBtn) refreshBtn.addEventListener('click', () => loadComplaints());
  if (filterSelect) filterSelect.addEventListener('change', () => renderComplaintsTable());

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = document.getElementById('btnSubmitComplaint');
      if (submitBtn) submitBtn.disabled = true;

      const payload = {
        session_id: document.getElementById('complaintSessionId')?.value || null,
        complainant_name: document.getElementById('complaintName')?.value.trim(),
        phone: document.getElementById('complaintPhone')?.value.trim(),
        vehicle_plate: document.getElementById('complaintPlate')?.value.trim() || null,
        category: document.getElementById('complaintCategory')?.value,
        rating: Number(document.getElementById('complaintRating')?.value || 5),
        message: document.getElementById('complaintMessage')?.value.trim()
      };

      try {
        const res = await fetch('/api/complaints', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Operator-Id': currentOperator
          },
          body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (data.success) {
          alert(`✅ Grievance Registered Successfully!\nTicket ID: ${data.ticket_id}\nAn acknowledgment SMS has been dispatched.`);
          form.reset();
          closeComplaintModal();

          appendVirtualPhoneSms(
            'ePark-CARE',
            `[eParkNiyantran] Grievance Registered Ref #${data.ticket_id}. Category: ${payload.category}. Our supervisor will review and resolve it promptly.`
          );

          loadComplaints();
        } else {
          alert(`Failed to register complaint: ${data.error || 'Server error'}`);
        }
      } catch (err) {
        console.error('Complaint submit error:', err);
        alert('Network error submitting feedback');
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }
}

async function loadComplaints() {
  try {
    const res = await fetch('/api/complaints');
    const data = await res.json();
    if (!data.success) return;

    complaintsCache = data.complaints || [];

    // Update Summary KPI Cards
    const s = data.summary || {};
    const totalEl = document.getElementById('statComplaintTotal');
    const openEl = document.getElementById('statComplaintOpen');
    const resolvedEl = document.getElementById('statComplaintResolved');
    const ratingEl = document.getElementById('statComplaintRating');
    const badgeEl = document.getElementById('complaintsBadge');

    if (totalEl) totalEl.textContent = s.total ?? complaintsCache.length;
    if (openEl) openEl.textContent = s.open ?? 0;
    if (resolvedEl) resolvedEl.textContent = s.resolved ?? 0;
    if (ratingEl) ratingEl.textContent = s.avgRating ? Number(s.avgRating).toFixed(1) : '5.0';
    if (badgeEl) badgeEl.textContent = s.open ?? 0;

    renderComplaintsTable();
  } catch (err) {
    console.error('Failed to load complaints:', err);
  }
}

function renderComplaintsTable() {
  const tbody = document.getElementById('complaintsTableBody');
  if (!tbody) return;

  const filter = document.getElementById('complaintFilterStatus')?.value || 'ALL';
  const filtered = complaintsCache.filter(c => {
    if (filter === 'OPEN') return c.status === 'OPEN';
    if (filter === 'RESOLVED') return c.status === 'RESOLVED';
    return true;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="p-6 text-center text-slate-500">No grievances or feedback records found for this filter.</td></tr>`;
    return;
  }

  tbody.innerHTML = '';
  filtered.forEach(c => {
    const tr = document.createElement('tr');
    const isOpen = c.status === 'OPEN';
    const ratingNum = c.rating || 5;
    const stars = '★'.repeat(ratingNum) + '☆'.repeat(5 - ratingNum);

    tr.innerHTML = `
      <td class="p-2.5 font-mono font-bold text-amber-400">${c.ticket_id}</td>
      <td class="p-2.5">
        <div class="font-bold text-slate-200">${c.complainant_name}</div>
        <div class="text-[10px] text-slate-400 font-mono">${c.phone}</div>
      </td>
      <td class="p-2.5">
        ${c.vehicle_plate ? `<span class="px-2 py-0.5 rounded font-mono font-bold text-xs bg-slate-800 border border-slate-700 text-slate-200">${formatPlateDisplay(c.vehicle_plate)}</span>` : '<span class="text-slate-500 italic">None</span>'}
      </td>
      <td class="p-2.5">
        <div class="text-[11px] font-semibold text-blue-400">${c.category.replace(/_/g, ' ')}</div>
        <div class="text-amber-400 font-mono text-xs">${stars} (${ratingNum}/5)</div>
      </td>
      <td class="p-2.5 max-w-[280px]">
        <div class="text-slate-200 line-clamp-2">${c.message}</div>
        ${c.resolution_notes ? `<div class="mt-1 text-[10px] text-emerald-400 bg-emerald-950/40 p-1.5 rounded border border-emerald-500/30"><strong>Resolved:</strong> ${c.resolution_notes}</div>` : ''}
      </td>
      <td class="p-2.5">
        <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${isOpen ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'}">
          ${c.status}
        </span>
      </td>
      <td class="p-2.5 font-mono text-[10px] text-slate-400">
        ${new Date(c.created_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}
      </td>
      <td class="p-2.5 text-right">
        ${isOpen ? `
          <button type="button" class="btn-resolve-ticket px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] rounded-lg shadow transition flex items-center space-x-1 ml-auto" data-ticket-id="${c.ticket_id}">
            <i data-lucide="check-check" class="w-3.5 h-3.5"></i>
            <span>Resolve</span>
          </button>
        ` : `
          <span class="text-[10px] text-slate-500 font-mono">Closed</span>
        `}
      </td>
    `;
    tbody.appendChild(tr);
  });

  // Attach resolve click handlers
  tbody.querySelectorAll('.btn-resolve-ticket').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ticketId = btn.getAttribute('data-ticket-id');
      const note = prompt(`Enter supervisor resolution note for Ticket ${ticketId}:`, 'Grievance investigated and refunded / rectified by supervisor.');
      if (!note) return;

      try {
        const res = await fetch(`/api/complaints/${ticketId}/resolve`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Operator-Id': currentOperator
          },
          body: JSON.stringify({ resolution_notes: note })
        });

        const data = await res.json();
        if (data.success) {
          alert(`✅ ${data.message}`);
          appendVirtualPhoneSms(
            'ePark-CARE',
            `[eParkNiyantran] Your grievance #${ticketId} has been RESOLVED: ${note}. Thank you!`
          );
          loadComplaints();
          loadReports();
        } else {
          alert(`Error resolving complaint: ${data.error}`);
        }
      } catch (err) {
        console.error('Resolve error:', err);
        alert('Network error resolving complaint');
      }
    });
  });

  initIcons();
}
