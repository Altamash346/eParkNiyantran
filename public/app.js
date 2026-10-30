/**
 * ==============================================================================
 * eParkNiyantran - Production Frontend Application Controller
 * High-performance SaaS architecture inspired by Linear, Stripe, and Vercel.
 * ==============================================================================
 */

'use strict';

// Global Application State
const state = {
  currentRoute: 'dashboard',
  currentOperator: 'OP-ATTENDANT-01',
  currentUser: {
    name: 'Meet Alshi',
    email: 'meetalshi19@gmail.com',
    role: 'Terminal Attendant',
    gate: 'Gate 1 (Inbound)'
  },
  slots: [],
  activeSessions: [],
  exceptions: [],
  reports: {},
  entryWizard: {
    step: 1,
    plate: 'MH12AB1234',
    category: '4W',
    makeModel: 'Standard Vehicle',
    fuelType: 'Petrol / EV',
    state: 'Maharashtra',
    driverPhone: '+91 9800000000',
    driverEmail: 'citizen@eparkniyantran.in',
    selectedSlot: '4W-01',
    evidenceDataUrl: null,
    isMobileVerified: true,
    ocrConfidence: '98%'
  },
  exitWizard: {
    selectedSessionId: null,
    paymentMethod: 'UPI'
  },
  cameraStream: null
};

// Default sample vehicle evidence for fast onboarding
const DEFAULT_CAR_SVG = "data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 240' width='400' height='240'%3E%3Crect width='400' height='240' fill='%230f172a'/%3E%3Cpath d='M80 160 L120 90 L280 90 L320 160 Z' fill='%232563eb'/%3E%3Crect x='60' y='140' width='280' height='60' rx='10' fill='%231e293b' stroke='%233b82f6' stroke-width='2'/%3E%3Crect x='130' y='165' width='140' height='30' rx='4' fill='%23ffffff' stroke='%23000' stroke-width='2'/%3E%3Ctext x='200' y='186' font-family='monospace' font-size='16' font-weight='bold' fill='%23000' text-anchor='middle'%3EMH 12 AB 1234%3C/text%3E%3Ccircle cx='100' cy='195' r='20' fill='%23334155' stroke='%2364748b' stroke-width='4'/%3E%3Ccircle cx='300' cy='195' r='20' fill='%23334155' stroke='%2364748b' stroke-width='4'/%3E%3C/svg%3E";

// --- DOM Ready Initialization ---
document.addEventListener('DOMContentLoaded', () => {
  initIcons();
  initTheme();
  initRouter();
  initSidebar();
  initGlobalSearch();
  initEntryWorkflow();
  initExitWorkflow();
  initGridFilters();
  initExceptionsActions();
  initSettingsActions();
  initProfileDropdown();

  // Load initial backend telemetry
  loadBackendTelemetry();

  // Background polling intervals for real-time reactivity
  setInterval(loadSlots, 4000);
  setInterval(loadActiveSessions, 3000);
  setInterval(loadReports, 10000);
  setInterval(loadExceptions, 8000);
  setInterval(updateLiveDurationTimers, 1000);
});

function initIcons() {
  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons();
  }
}

// --- Theme Management ---
function initTheme() {
  const saved = localStorage.getItem('epark_theme') || 'light';
  if (saved === 'light') {
    document.body.classList.add('light-theme');
  } else {
    document.body.classList.remove('light-theme');
  }
  updateThemeIcon();

  const toggleBtn = document.getElementById('themeToggleBtn');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      document.body.classList.toggle('light-theme');
      const isLight = document.body.classList.contains('light-theme');
      localStorage.setItem('epark_theme', isLight ? 'light' : 'dark');
      updateThemeIcon();
      showToast('Theme updated', isLight ? 'Light mode enabled' : 'Dark mode enabled', 'info');
    });
  }
}

function updateThemeIcon() {
  const toggleBtn = document.getElementById('themeToggleBtn');
  if (!toggleBtn) return;
  const isLight = document.body.classList.contains('light-theme');
  toggleBtn.innerHTML = isLight 
    ? '<i data-lucide="moon" class="w-4 h-4 text-blue-500"></i>' 
    : '<i data-lucide="sun" class="w-4 h-4 text-amber-400"></i>';
  initIcons();
}

// --- Router System (Hash-based) ---
function initRouter() {
  window.addEventListener('hashchange', handleRoute);
  
  // Navigation link click delegates
  document.querySelectorAll('[data-route]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const route = el.getAttribute('data-route');
      navigateTo(route);
    });
  });

  // Initial route
  const hash = window.location.hash.replace('#', '') || 'dashboard';
  navigateTo(hash);
}

function navigateTo(route) {
  window.location.hash = route;
}

function handleRoute() {
  const route = window.location.hash.replace('#', '') || 'dashboard';
  state.currentRoute = route;

  // Handle Auth screens
  const authContainer = document.getElementById('authContainer');
  const appContainer = document.getElementById('appContainer');

  if (route === 'login' || route === 'register') {
    if (authContainer) authContainer.classList.remove('hidden');
    if (appContainer) appContainer.classList.add('hidden');
    
    document.getElementById('view-login')?.classList.toggle('hidden', route !== 'login');
    document.getElementById('view-register')?.classList.toggle('hidden', route !== 'register');
    initIcons();
    return;
  }

  // App screens
  if (authContainer) authContainer.classList.add('hidden');
  if (appContainer) appContainer.classList.remove('hidden');

  // Update Active Sidebar Link
  document.querySelectorAll('.nav-item').forEach(el => {
    const r = el.getAttribute('data-route');
    if (r === route) {
      el.classList.add('active');
    } else {
      el.classList.remove('active');
    }
  });

  // Breadcrumb
  const breadcrumb = document.getElementById('pageTitleBreadcrumb');
  if (breadcrumb) {
    const titles = {
      dashboard: 'Dashboard',
      entry: 'Vehicle Entry Registration',
      exit: 'Vehicle Exit & Billing',
      grid: 'Live Parking Grid',
      sessions: 'Active Parking Sessions',
      reports: 'Reports & Revenue Analytics',
      tariff: 'Tariff Rates & Slabs',
      exceptions: 'Exceptions & Bans Queue',
      feedback: 'Citizen Feedback & Grievances',
      sms: 'Citizen SMS & WhatsApp Center',
      iot: 'Gate Sensors & IoT Hardware',
      settings: 'System Settings'
    };
    breadcrumb.textContent = titles[route] || 'Dashboard';
  }

  // Show Active View Panel
  document.querySelectorAll('.view-panel').forEach(panel => {
    panel.classList.add('hidden');
  });

  const activePanel = document.getElementById(`view-${route}`);
  if (activePanel) {
    activePanel.classList.remove('hidden');
  }
  if (route === 'feedback' && typeof loadComplaints === 'function') loadComplaints();
  if (route === 'sms' && typeof loadNotifications === 'function') loadNotifications(); else {
    document.getElementById('view-dashboard')?.classList.remove('hidden');
  }

  // Auto-populate & synchronize exit terminal on navigation
  if (route === 'exit') {
    populateExitSessionSelect();
    if (state.exitWizard.selectedSessionId) {
      handleExitSessionSelect(state.exitWizard.selectedSessionId);
    } else if (state.activeSessions.length > 0) {
      handleExitSessionSelect(state.activeSessions[0].session_id);
    }
  }

  // Close mobile sidebar on route switch
  document.getElementById('appSidebar')?.classList.remove('mobile-open');

  // Re-init icons
  initIcons();

  // Scroll to top smoothly
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// --- Sidebar Collapse & Mobile Menu ---
function initSidebar() {
  const sidebar = document.getElementById('appSidebar');
  const appShell = document.querySelector('.app-shell');
  const collapseBtn = document.getElementById('btnSidebarCollapse');
  const mobileToggleBtn = document.getElementById('btnMobileSidebarToggle');

  if (collapseBtn && sidebar && appShell) {
    collapseBtn.addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
      appShell.classList.toggle('sidebar-collapsed');
    });
  }

  if (mobileToggleBtn && sidebar) {
    mobileToggleBtn.addEventListener('click', () => {
      sidebar.classList.toggle('mobile-open');
    });
  }
}

// --- Global Search (⌘K / Ctrl+K) ---
function initGlobalSearch() {
  const searchInput = document.getElementById('globalSearchInput');

  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      searchInput?.focus();
    }
  });

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const q = e.target.value.trim().toUpperCase();
      if (!q) return;

      // Filter sessions
      const matched = state.activeSessions.find(s => 
        s.vehicle_plate.includes(q) || s.slot_id.includes(q) || s.session_id.includes(q)
      );

      if (matched && e.key === 'Enter') {
        navigateTo('sessions');
        showToast('Search Match', `Found vehicle ${matched.vehicle_plate} in bay ${matched.slot_id}`, 'info');
      }
    });
  }
}

// --- Backend Telemetry Loaders ---
async function loadBackendTelemetry() {
  await Promise.all([
    loadSlots(),
    loadActiveSessions(),
    loadReports(),
    loadExceptions(),
    checkHealth()
  ]);
  updateDashboardGreeting();
}

async function checkHealth() {
  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    const pill = document.getElementById('backendStatusPill');
    if (pill) {
      if (data.status === 'UP') {
        pill.textContent = data.demoMode ? 'API Online (Demo)' : 'API Online (PostgreSQL)';
      } else {
        pill.textContent = 'Degraded';
        pill.parentElement.className = 'flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[11px] font-semibold';
      }
    }
  } catch (_) {
    const pill = document.getElementById('backendStatusPill');
    if (pill) {
      pill.textContent = 'Offline';
      pill.parentElement.className = 'flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20 text-[11px] font-semibold';
    }
  }
}

async function loadSlots() {
  try {
    const res = await fetch('/api/slots');
    const data = await res.json();
    if (!data.success) return;

    state.slots = data.slots || [];
    const stats = data.stats || {};

    // 1. Update KPI Metric Cards directly from live slot state
    const totalEl = document.getElementById('metricTotalBays');
    const availEl = document.getElementById('metricAvailableBays');
    const activeEl = document.getElementById('metricActiveParked');

    const totalCount = stats.total || (state.slots.length > 0 ? state.slots.length : 28);
    const occupiedCount = state.slots.filter(s => s.is_occupied === 1).length;
    const vacantCount = Math.max(0, totalCount - occupiedCount);

    if (totalEl) totalEl.textContent = totalCount;
    if (availEl) availEl.textContent = vacantCount;
    if (activeEl) activeEl.textContent = occupiedCount;

    // Quick summaries
    const quickVacant = document.getElementById('quickVacantSummary');
    if (quickVacant) quickVacant.textContent = `${vacantCount} Bays Available`;

    const quickOccupied = document.getElementById('quickOccupiedSummary');
    if (quickOccupied) quickOccupied.textContent = `${occupiedCount} Active Session(s)`;

    // 2. Render Live Parking Grid Page
    renderLiveParkingGrid();

    // 3. Render Entry Slot Picker
    renderEntrySlotPicker();

  } catch (err) {
    console.warn('Failed to load slots:', err);
  }
}

async function loadActiveSessions() {
  try {
    const res = await fetch('/api/sessions/active');
    const data = await res.json();
    if (!data.success) return;

    state.activeSessions = data.sessions || [];

    // Update badges
    const badge = document.getElementById('sidebarSessionBadge');
    if (badge) badge.textContent = state.activeSessions.length;

    // Render dashboard recent table
    renderDashboardSessionsTable();

    // Render dedicated sessions page table
    renderSessionsPageTable();

    // Update Exit session select dropdown
    populateExitSessionSelect();

  } catch (err) {
    console.warn('Failed to load active sessions:', err);
  }
}

async function loadReports() {
  try {
    const res = await fetch('/api/reports/daily');
    const data = await res.json();
    if (!data.success) return;

    state.reports = data;

    const revEl = document.getElementById('metricTotalRevenue');
    const agnEl = document.getElementById('metricAgencyShare');
    const repGross = document.getElementById('repGrossRevenue');
    const repAgn = document.getElementById('repAgencyShare');
    const repFac = document.getElementById('repFacilityShare');

    const s = data.summary || data;
    const totalRev = Number(s.totalRevenueCollected ?? s.totalRevenue ?? data.totalRevenue ?? 0);
    const agencyShare = Number(s.agencyShare10Percent ?? s.agencyRevenueShare ?? data.agencyRevenueShare ?? 0);
    const facilityShare = Number(s.collegeFacilityShare90Percent ?? s.facilityRevenueShare ?? data.facilityRevenueShare ?? (totalRev - agencyShare));

    if (revEl) revEl.textContent = `₹${totalRev.toFixed(0)}`;
    if (agnEl) agnEl.textContent = `₹${agencyShare.toFixed(0)}`;

    if (repGross) repGross.textContent = `₹${totalRev.toFixed(2)}`;
    if (repAgn) repAgn.textContent = `₹${agencyShare.toFixed(2)}`;
    if (repFac) repFac.textContent = `₹${facilityShare.toFixed(2)}`;

  } catch (err) {
    console.warn('Failed to load daily reports:', err);
  }
}

async function loadExceptions() {
  try {
    const res = await fetch('/api/exceptions');
    const data = await res.json();
    if (!data.success) return;

    state.exceptions = data.overdueSessions || [];

    const badge = document.getElementById('sidebarExceptionBadge');
    const metricCount = document.getElementById('metricOverdueCount');

    const count = state.exceptions.length;
    if (badge) badge.textContent = count;
    if (metricCount) metricCount.textContent = count;

    renderExceptionsTable();

  } catch (err) {
    console.warn('Failed to load exceptions:', err);
  }
}

function updateDashboardGreeting() {
  const el = document.getElementById('dashboardGreeting');
  if (!el) return;

  const hour = new Date().getHours();
  let timeStr = 'Good afternoon';
  if (hour < 12) timeStr = 'Good morning';
  else if (hour >= 17) timeStr = 'Good evening';

  el.textContent = `${timeStr}, ${state.currentUser.name.split(' ')[0]} 👋`;
}

// --- Live Parking Grid Rendering ---
let gridFilterZone = 'ALL';

function initGridFilters() {
  document.getElementById('gridFilterAll')?.addEventListener('click', () => {
    gridFilterZone = 'ALL';
    updateFilterButtonStyles('gridFilterAll');
    renderLiveParkingGrid();
  });
  document.getElementById('gridFilterZoneA')?.addEventListener('click', () => {
    gridFilterZone = '2W';
    updateFilterButtonStyles('gridFilterZoneA');
    renderLiveParkingGrid();
  });
  document.getElementById('gridFilterZoneB')?.addEventListener('click', () => {
    gridFilterZone = '4W';
    updateFilterButtonStyles('gridFilterZoneB');
    renderLiveParkingGrid();
  });
}

function updateFilterButtonStyles(activeId) {
  ['gridFilterAll', 'gridFilterZoneA', 'gridFilterZoneB'].forEach(id => {
    const btn = document.getElementById(id);
    if (!btn) return;
    if (id === activeId) {
      btn.className = 'btn-primary text-xs py-1.5 px-3';
    } else {
      btn.className = 'btn-secondary text-xs py-1.5 px-3';
    }
  });
}

function renderLiveParkingGrid() {
  const container = document.getElementById('liveGridContainer');
  if (!container) return;

  let filtered = state.slots;
  if (gridFilterZone !== 'ALL') {
    filtered = filtered.filter(s => s.category === gridFilterZone);
  }

  // Update counts
  const vacantCount = filtered.filter(s => s.is_occupied === 0).length;
  const occupiedCount = filtered.filter(s => s.is_occupied === 1).length;

  const vCountEl = document.getElementById('gridVacantCount');
  const oCountEl = document.getElementById('gridOccupiedCount');
  if (vCountEl) vCountEl.textContent = `${vacantCount} Vacant`;
  if (oCountEl) oCountEl.textContent = `${occupiedCount} Occupied`;

  container.innerHTML = filtered.map(slot => {
    const isOccupied = slot.is_occupied === 1;
    const is2W = slot.category === '2W';
    const statusClass = isOccupied ? 'bay-occupied' : 'bay-vacant';
    const iconName = is2W ? 'bike' : 'car';

    return `
      <div class="bay-card ${statusClass}" onclick="openBayDetailDrawer('${slot.slot_id}')" tabindex="0">
        <div class="flex items-center justify-between w-full text-[10px] font-bold">
          <span class="font-mono">${slot.slot_id}</span>
          <span class="uppercase tracking-wider opacity-80">${slot.category}</span>
        </div>
        
        <div class="my-1">
          <i data-lucide="${iconName}" class="w-6 h-6"></i>
        </div>

        <div class="text-[10px] font-bold tracking-wider">
          ${isOccupied ? 'OCCUPIED' : 'AVAILABLE'}
        </div>

        ${slot.vehicle_plate ? `<div class="text-[9px] font-mono font-semibold bg-black/30 px-1.5 py-0.5 rounded truncate max-w-full">${slot.vehicle_plate}</div>` : ''}
      </div>
    `;
  }).join('');

  initIcons();
}

// --- Bay Detail Slide-Over Drawer ---
function openBayDetailDrawer(slotId) {
  const slot = state.slots.find(s => s.slot_id === slotId);
  if (!slot) return;

  document.getElementById('drawerBayId').textContent = slot.slot_id;
  document.getElementById('drawerBayZone').textContent = slot.zone;
  document.getElementById('drawerEsp32Id').textContent = slot.hardware_esp32_id || `ESP32-NODE-${slot.slot_id}`;
  document.getElementById('drawerSensorState').textContent = slot.sensor_status || 'ONLINE';

  const isOccupied = slot.is_occupied === 1;
  const statusDot = document.getElementById('drawerBayStatusDot');
  const statusText = document.getElementById('drawerBayStatusText');
  const occupancyInfo = document.getElementById('drawerOccupancyInfo');
  const actionBtn = document.getElementById('drawerActionBtn');

  if (isOccupied) {
    statusDot.className = 'w-3 h-3 rounded-full bg-rose-500';
    statusText.className = 'font-bold text-sm text-rose-400';
    statusText.textContent = 'OCCUPIED';
    occupancyInfo.classList.remove('hidden');

    document.getElementById('drawerPlateText').textContent = slot.vehicle_plate || 'MH12AB1234';
    document.getElementById('drawerEntryTime').textContent = slot.entry_time ? new Date(slot.entry_time).toLocaleTimeString('en-IN') : 'Just now';
    document.getElementById('drawerDuration').textContent = 'Active Session';

    actionBtn.textContent = 'Process Exit';
    actionBtn.className = 'btn-success text-xs';
    actionBtn.onclick = () => {
      closeBayDetailDrawer();
      navigateTo('exit');
      if (slot.current_session_id) {
        handleExitSessionSelect(slot.current_session_id);
      }
    };
  } else {
    statusDot.className = 'w-3 h-3 rounded-full bg-emerald-500';
    statusText.className = 'font-bold text-sm text-emerald-400';
    statusText.textContent = 'AVAILABLE';
    occupancyInfo.classList.add('hidden');

    actionBtn.textContent = 'Assign For Entry';
    actionBtn.className = 'btn-primary text-xs';
    actionBtn.onclick = () => {
      closeBayDetailDrawer();
      state.entryWizard.selectedSlot = slot.slot_id;
      navigateTo('entry');
      setEntryStep(4);
    };
  }

  // Bind simulate sensor toggle button
  const toggleBtn = document.getElementById('btnToggleBaySensor');
  if (toggleBtn) {
    toggleBtn.onclick = async () => {
      try {
        const nextState = slot.sensor_status === 'ONLINE' ? 'OFFLINE' : 'ONLINE';
        const res = await fetch(`/api/slots/${slot.slot_id}/sensor-toggle`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sensor_status: nextState })
        });
        const data = await res.json();
        if (data.success) {
          slot.sensor_status = nextState;
          document.getElementById('drawerSensorState').textContent = nextState;
          showToast('Sensor Toggled', `Bay ${slot.slot_id} sensor is now ${nextState}`, 'success');
          loadSlots();
        }
      } catch (e) {
        showToast('Sensor Error', e.message, 'error');
      }
    };
  }

  const drawer = document.getElementById('bayDetailDrawerBackdrop');
  if (drawer) drawer.classList.add('open');
  initIcons();
}

function closeBayDetailDrawer() {
  document.getElementById('bayDetailDrawerBackdrop')?.classList.remove('open');
}

// --- Active Sessions Rendering ---
function renderDashboardSessionsTable() {
  const tbody = document.getElementById('dashboardSessionsTbody');
  if (!tbody) return;

  if (state.activeSessions.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="py-6 text-center text-slate-500">No active vehicles parked currently.</td></tr>`;
    return;
  }

  tbody.innerHTML = state.activeSessions.slice(0, 5).map((s, idx) => {
    const isOverdue = s.duration_seconds > 10800; // >180m
    const isPendingPayment = s.status === 'PENDING_PAYMENT';
    const statusBadge = isOverdue 
      ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20">Overdue</span>`
      : isPendingPayment
      ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">Pending Pay</span>`
      : `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Active</span>`;

    return `
      <tr class="hover:bg-[var(--bg-surface-hover)] transition">
        <td class="py-2.5 px-3 font-bold font-mono text-[var(--text-primary)]">${s.vehicle_plate}</td>
        <td class="py-2.5 px-3 text-[var(--text-secondary)]">${s.make_model || 'Standard Vehicle'}</td>
        <td class="py-2.5 px-3 font-mono font-semibold text-blue-400">${s.slot_id}</td>
        <td class="py-2.5 px-3 text-[var(--text-muted)]">${new Date(s.entry_time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</td>
        <td class="py-2.5 px-3 font-mono text-amber-400 font-medium session-duration-ticker" data-entry="${s.entry_time}">${formatDuration(s.duration_seconds || 0)}</td>
        <td class="py-2.5 px-3">${statusBadge}</td>
        <td class="py-2.5 px-3 text-right">
          <button onclick="quickExitSession('${s.session_id}')" class="btn-secondary text-[11px] py-1 px-2.5">
            Exit
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function renderSessionsPageTable() {
  const tbody = document.getElementById('sessionsPageTbody');
  if (!tbody) return;

  if (state.activeSessions.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="py-8 text-center text-slate-500">No active sessions. Facility is vacant.</td></tr>`;
    return;
  }

  tbody.innerHTML = state.activeSessions.map((s, idx) => {
    const isOverdue = s.duration_seconds > 10800;
    const isPendingPayment = s.status === 'PENDING_PAYMENT';
    const statusBadge = isOverdue 
      ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20">Overdue</span>`
      : isPendingPayment
      ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">Pending Pay</span>`
      : `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Active</span>`;

    return `
      <tr class="hover:bg-[var(--bg-surface-hover)] transition">
        <td class="py-2.5 px-3 font-mono text-[var(--text-muted)]">${idx + 1}</td>
        <td class="py-2.5 px-3 font-bold font-mono text-[var(--text-primary)]">${s.vehicle_plate}</td>
        <td class="py-2.5 px-3 text-[var(--text-secondary)]">${s.make_model || 'Vehicle'} (${s.category})</td>
        <td class="py-2.5 px-3 font-mono font-semibold text-blue-400">${s.slot_id}</td>
        <td class="py-2.5 px-3 text-[var(--text-muted)]">${new Date(s.entry_time).toLocaleTimeString('en-IN')}</td>
        <td class="py-2.5 px-3 font-mono text-amber-400 font-semibold session-duration-ticker" data-entry="${s.entry_time}">${formatDuration(s.duration_seconds || 0)}</td>
        <td class="py-2.5 px-3">${statusBadge}</td>
        <td class="py-2.5 px-3 text-right space-x-1.5">
          <button onclick="quickExitSession('${s.session_id}')" class="btn-success text-xs py-1 px-3">
            Process Exit
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function updateLiveDurationTimers() {
  document.querySelectorAll('.session-duration-ticker').forEach(el => {
    const entryTime = el.getAttribute('data-entry');
    if (!entryTime) return;
    const diffSec = Math.floor((Date.now() - new Date(entryTime).getTime()) / 1000);
    if (diffSec >= 0) {
      el.textContent = formatDuration(diffSec);
    }
  });
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// --- Entry Workflow ---
function initEntryWorkflow() {
  // Set default preview image
  const previewImg = document.getElementById('previewImage');
  if (previewImg && !previewImg.src) {
    previewImg.src = DEFAULT_CAR_SVG;
  }

  // Image Upload Trigger
  const chooseBtn = document.getElementById('btnChooseImage');
  const fileInput = document.getElementById('vehicleImageInput');
  const dropzone = document.getElementById('uploadPane');

  if (chooseBtn && fileInput) {
    chooseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      fileInput.click();
    });
  }

  if (dropzone && fileInput) {
    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('border-blue-500'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('border-blue-500'));
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('border-blue-500');
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        handleFileSelection(e.dataTransfer.files[0]);
      }
    });

    fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        handleFileSelection(e.target.files[0]);
      }
    });
  }

  // Camera Tab Toggles
  const tabUpload = document.getElementById('tabBtnUploadImage');
  const tabCamera = document.getElementById('tabBtnUseCamera');
  const uploadPane = document.getElementById('uploadPane');
  const cameraPane = document.getElementById('cameraPane');
  const videoEl = document.getElementById('cameraVideo');
  const captureBtn = document.getElementById('btnCaptureFrame');
  const stopCamBtn = document.getElementById('btnStopCamera');

  if (tabUpload && tabCamera && uploadPane && cameraPane) {
    tabUpload.addEventListener('click', () => {
      tabUpload.className = 'btn-primary text-xs py-1.5 px-3';
      tabCamera.className = 'btn-secondary text-xs py-1.5 px-3';
      uploadPane.classList.remove('hidden');
      cameraPane.classList.add('hidden');
      stopCameraStream();
    });

    tabCamera.addEventListener('click', async () => {
      tabCamera.className = 'btn-primary text-xs py-1.5 px-3';
      tabUpload.className = 'btn-secondary text-xs py-1.5 px-3';
      uploadPane.classList.add('hidden');
      cameraPane.classList.remove('hidden');
      await startCameraStream(videoEl);
    });

    if (stopCamBtn) {
      stopCamBtn.addEventListener('click', () => tabUpload.click());
    }

    if (captureBtn && videoEl) {
      captureBtn.addEventListener('click', () => {
        const canvas = document.getElementById('cameraCanvas');
        if (!canvas || !videoEl.videoWidth) return;
        canvas.width = videoEl.videoWidth;
        canvas.height = videoEl.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        stopCameraStream();
        tabUpload.click();
        processVehicleImage(dataUrl);
      });
    }
  }

  // Edit Plate Handlers
  const btnEditPlate = document.getElementById('btnEditOcrPlate');
  const ocrEditForm = document.getElementById('ocrEditForm');
  const inputEditPlate = document.getElementById('inputEditOcrPlate');
  const btnSavePlate = document.getElementById('btnSaveOcrEdit');
  const btnCancelPlate = document.getElementById('btnCancelOcrEdit');

  if (btnEditPlate && ocrEditForm && inputEditPlate) {
    btnEditPlate.addEventListener('click', () => {
      ocrEditForm.classList.remove('hidden');
      inputEditPlate.value = state.entryWizard.plate;
      inputEditPlate.focus();
    });

    btnCancelPlate?.addEventListener('click', () => ocrEditForm.classList.add('hidden'));

    btnSavePlate?.addEventListener('click', () => {
      const val = inputEditPlate.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (val) {
        state.entryWizard.plate = val;
        updateHSRPDisplay(val);
        ocrEditForm.classList.add('hidden');
        lookupRtoVehicle(val);
        showToast('Plate Updated', `Manually corrected to ${val}`, 'info');
      }
    });
  }

  // Send Mobile OTP
  const btnSendOtp = document.getElementById('btnSendMobileOtp');
  if (btnSendOtp) {
    btnSendOtp.addEventListener('click', async () => {
      const phoneInput = document.getElementById('entryDriverPhone');
      const phone = phoneInput ? phoneInput.value.trim() : '';
      if (!phone) {
        showToast('Missing Phone', 'Please enter a valid mobile number', 'warning');
        return;
      }
      btnSendOtp.disabled = true;
      btnSendOtp.textContent = 'Sending...';

      try {
        const res = await fetch('/api/otp/send-mobile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone })
        });
        const data = await res.json();
        if (data.success) {
          showToast('OTP Sent', `Verification code sent to ${phone}`, 'success');
          if (data.demoCode) {
            const otpInp = document.getElementById('entryOtpCode');
            if (otpInp) otpInp.value = data.demoCode;
            const statusMsg = document.getElementById('otpStatusMessage');
            if (statusMsg) {
              statusMsg.classList.remove('hidden');
              statusMsg.className = 'p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400 font-mono';
              statusMsg.innerHTML = `<span class="text-amber-500 font-bold">[DEMO OTP: ${data.demoCode}]</span> Code dispatched to ${data.maskedPhone || phone}.`;
            }
          }
          // Start 60s cooldown
          let cd = 60;
          const timer = setInterval(() => {
            cd--;
            btnSendOtp.textContent = `Resend (${cd}s)`;
            if (cd <= 0) {
              clearInterval(timer);
              btnSendOtp.disabled = false;
              btnSendOtp.textContent = 'Send OTP';
            }
          }, 1000);
        } else {
          showToast('OTP Failed', data.error || 'Failed to dispatch OTP', 'error');
          btnSendOtp.disabled = false;
          btnSendOtp.textContent = 'Send OTP';
        }
      } catch (e) {
        showToast('Network Error', e.message, 'error');
        btnSendOtp.disabled = false;
        btnSendOtp.textContent = 'Send OTP';
      }
    });
  }

  // Verify Mobile OTP
  const btnVerifyOtp = document.getElementById('btnVerifyOtp');
  if (btnVerifyOtp) {
    btnVerifyOtp.addEventListener('click', async () => {
      const otpCode = document.getElementById('entryOtpCode')?.value.trim();
      const phone = document.getElementById('entryDriverPhone')?.value.trim();

      if (!otpCode || otpCode.length < 4) {
        showToast('Invalid OTP', 'Please enter the 6-digit OTP code', 'warning');
        return;
      }

      try {
        const res = await fetch('/api/otp/verify-mobile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone, code: otpCode })
        });
        const data = await res.json();
        if (data.success) {
          state.entryWizard.isMobileVerified = true;
          document.getElementById('otpStatusMessage')?.classList.remove('hidden');
          showToast('Mobile Verified', 'Driver contact verified successfully', 'success');
        } else {
          showToast('Invalid OTP', data.error || 'OTP verification failed', 'error');
        }
      } catch (e) {
        showToast('Verification Error', e.message, 'error');
      }
    });
  }

  // Category Filter in Bay Allocation Step
  document.getElementById('slotFilterBtn4W')?.addEventListener('click', () => {
    state.entryWizard.category = '4W';
    document.getElementById('slotFilterBtn4W').className = 'btn-primary text-xs py-1.5 px-3';
    document.getElementById('slotFilterBtn2W').className = 'btn-secondary text-xs py-1.5 px-3';
    renderEntrySlotPicker();
  });
  document.getElementById('slotFilterBtn2W')?.addEventListener('click', () => {
    state.entryWizard.category = '2W';
    document.getElementById('slotFilterBtn2W').className = 'btn-primary text-xs py-1.5 px-3';
    document.getElementById('slotFilterBtn4W').className = 'btn-secondary text-xs py-1.5 px-3';
    renderEntrySlotPicker();
  });

  // Final Entry Submission
  document.getElementById('btnSubmitEntry')?.addEventListener('click', submitEntryRegistration);
}

function setEntryStep(stepNum) {
  state.entryWizard.step = stepNum;

  // Update indicators
  for (let i = 1; i <= 5; i++) {
    const ind = document.getElementById(`stepIndicator${i}`);
    const pane = document.getElementById(`entryStep${i}`);
    if (!ind || !pane) continue;

    if (i < stepNum) {
      ind.className = 'step-item completed';
      ind.querySelector('.step-indicator').innerHTML = '<i data-lucide="check" class="w-3.5 h-3.5"></i>';
      pane.classList.add('hidden');
    } else if (i === stepNum) {
      ind.className = 'step-item active';
      ind.querySelector('.step-indicator').textContent = i;
      pane.classList.remove('hidden');
    } else {
      ind.className = 'step-item';
      ind.querySelector('.step-indicator').textContent = i;
      pane.classList.add('hidden');
    }
  }

  // Update step 5 confirm details
  if (stepNum === 5) {
    document.getElementById('confirmPlate').textContent = state.entryWizard.plate;
    document.getElementById('confirmCategory').textContent = state.entryWizard.category === '2W' ? '2W (Two-Wheeler)' : '4W (Four-Wheeler / LMV)';
    document.getElementById('confirmMakeModel').textContent = document.getElementById('entryMakeModel')?.value || 'Standard Vehicle';
    document.getElementById('confirmSlot').textContent = state.entryWizard.selectedSlot || 'Auto-allocated';
    document.getElementById('confirmPhone').textContent = document.getElementById('entryDriverPhone')?.value || '+91 9800000000';
    document.getElementById('confirmEmail').textContent = document.getElementById('entryDriverEmail')?.value || 'citizen@eparkniyantran.in';
  }

  initIcons();
}

function handleFileSelection(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    processVehicleImage(e.target.result);
  };
  reader.readAsDataURL(file);
}

async function startCameraStream(videoEl) {
  try {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      state.cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      if (videoEl) videoEl.srcObject = state.cameraStream;
    } else {
      showToast('Camera Unavailable', 'Webcam is not supported in this environment', 'warning');
    }
  } catch (err) {
    showToast('Camera Error', err.message || 'Permission denied', 'error');
  }
}

function stopCameraStream() {
  if (state.cameraStream) {
    state.cameraStream.getTracks().forEach(t => t.stop());
    state.cameraStream = null;
  }
}

async function processVehicleImage(dataUrl) {
  state.entryWizard.evidenceDataUrl = dataUrl;
  const previewImg = document.getElementById('previewImage');
  if (previewImg) previewImg.src = dataUrl;

  showToast('Analyzing Plate', 'Running OCR on vehicle image...', 'info');

  let recognizedPlate = null;
  let confidenceScore = '95%';

  // 1. Server-side OCR analysis
  try {
    const res = await fetch('/api/ocr/recognize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: dataUrl })
    });
    const data = await res.json();
    if (data.success) {
      const candidate = data.plate || data.recognizedPlate || data.formatted || (data.ocr && data.ocr.normalized);
      if (candidate && candidate.length >= 6) {
        recognizedPlate = candidate.replace(/\s+/g, '').toUpperCase();
        if (data.confidence) {
          confidenceScore = `${Math.round(data.confidence * 100)}%`;
        }
      }
    }
  } catch (err) {
    console.warn('Server OCR request error:', err);
  }

  // 2. Client-side Tesseract.js in-browser fallback
  if (!recognizedPlate && window.Tesseract && typeof window.Tesseract.recognize === 'function') {
    try {
      const { data: { text, confidence } } = await window.Tesseract.recognize(dataUrl, 'eng');
      if (text && text.trim()) {
        const cleaned = text.toUpperCase().replace(/[^A-Z0-9\s]/g, ' ');
        const match = cleaned.match(/\b([A-Z]{2})\s*([0-9OQILZSB]{1,2})\s*([A-Z]{1,3})\s*([0-9OQILZSB]{4})\b/) ||
                      cleaned.match(/\b([0-9]{2})\s*BH\s*([0-9]{4})\s*([A-Z]{1,2})\b/) ||
                      cleaned.match(/\b([A-Z]{2}[0-9]{1,2}[A-Z]{1,2}[0-9]{4})\b/);
        if (match) {
          recognizedPlate = match[0].replace(/\s+/g, '');
          confidenceScore = `${Math.min(99, Math.max(75, Math.round(confidence || 90)))}%`;
        }
      }
    } catch (tessErr) {
      console.warn('Client Tesseract fallback error:', tessErr);
    }
  }

  // 3. Apply recognized plate
  if (recognizedPlate) {
    state.entryWizard.plate = recognizedPlate;
    state.entryWizard.ocrConfidence = confidenceScore;
    updateHSRPDisplay(recognizedPlate);
    lookupRtoVehicle(recognizedPlate);
    const inputEdit = document.getElementById('inputEditOcrPlate');
    if (inputEdit) inputEdit.value = recognizedPlate;
    const confirmPlate = document.getElementById('confirmPlate');
    if (confirmPlate) confirmPlate.textContent = recognizedPlate;
    showToast('Plate Recognized', `${recognizedPlate} (${confidenceScore})`, 'success');
  } else {
    updateHSRPDisplay(state.entryWizard.plate);
    showToast('Manual Entry Ready', 'Could not detect plate clearly. You can click Edit to change plate number.', 'info');
  }
}

function updateHSRPDisplay(plate) {
  const display = plate.replace(/\s+/g, '');
  const formatted = display.length > 4 ? `${display.substring(0, 2)} ${display.substring(2, 4)} ${display.substring(4, display.length - 4)} ${display.substring(display.length - 4)}` : display;
  const el = document.getElementById('plateNumberDisplay');
  if (el) el.textContent = formatted.trim();

  const confBadge = document.getElementById('ocrConfidenceBadge');
  if (confBadge) confBadge.textContent = `${state.entryWizard.ocrConfidence || '96%'} confidence`;
}

async function lookupRtoVehicle(plate) {
  try {
    const res = await fetch(`/api/vehicles/lookup/${plate}`);
    const data = await res.json();
    if (data.success && data.vehicle) {
      const v = data.vehicle;
      if (document.getElementById('entryMakeModel')) document.getElementById('entryMakeModel').value = v.make_model || v.makeModel || 'Standard Vehicle';
      if (document.getElementById('entryFuelType')) document.getElementById('entryFuelType').value = v.fuel_type || v.fuelType || 'Petrol';
      if (document.getElementById('entryRegState')) document.getElementById('entryRegState').value = v.registration_state || 'Maharashtra';
      if (document.getElementById('entryVehicleCategory')) document.getElementById('entryVehicleCategory').value = v.category || '4W';
      state.entryWizard.category = v.category || '4W';
    }
  } catch (_) {}
}

function renderEntrySlotPicker() {
  const container = document.getElementById('entrySlotPickerGrid');
  if (!container) return;

  const targetCategory = state.entryWizard.category || '4W';
  const matchingSlots = state.slots.filter(s => s.category === targetCategory);

  // Auto-pick first available vacant bay if currently selected is occupied or unset
  const vacantSlots = matchingSlots.filter(s => s.is_occupied === 0);
  const isCurrentVacant = vacantSlots.some(s => s.slot_id === state.entryWizard.selectedSlot);
  if (!isCurrentVacant) {
    state.entryWizard.selectedSlot = vacantSlots.length > 0 ? vacantSlots[0].slot_id : null;
  }

  container.innerHTML = matchingSlots.map(s => {
    const isOccupied = s.is_occupied === 1;
    const isSelected = !isOccupied && s.slot_id === state.entryWizard.selectedSlot;
    const selectClass = isSelected ? 'bay-selected' : '';
    const statusClass = isOccupied ? 'bay-occupied opacity-40 cursor-not-allowed' : 'bay-vacant cursor-pointer';

    return `
      <div class="bay-card ${statusClass} ${selectClass} p-2 text-center" 
           ${!isOccupied ? `onclick="selectEntrySlot('${s.slot_id}')"` : ''}>
        <span class="font-mono font-bold text-[11px] block">${s.slot_id}</span>
        <span class="text-[9px] uppercase font-semibold mt-0.5 block">${isOccupied ? 'Occupied' : 'Vacant'}</span>
      </div>
    `;
  }).join('');

  const selText = document.getElementById('entrySelectedSlotText');
  if (selText) {
    selText.textContent = state.entryWizard.selectedSlot 
      ? `${state.entryWizard.selectedSlot} (Zone ${targetCategory === '2W' ? 'A' : 'B'})`
      : `No vacant bays in Zone ${targetCategory === '2W' ? 'A' : 'B'}`;
  }
}

function selectEntrySlot(slotId) {
  state.entryWizard.selectedSlot = slotId;
  renderEntrySlotPicker();
  showToast('Bay Selected', `Allocated slot ${slotId}`, 'info');
}

async function submitEntryRegistration() {
  const submitBtn = document.getElementById('btnSubmitEntry');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i><span>Committing...</span>';
    initIcons();
  }

  const payload = {
    plate: state.entryWizard.plate,
    category: state.entryWizard.category,
    parking_slot: state.entryWizard.selectedSlot,
    slot_id: state.entryWizard.selectedSlot,
    driverPhone: document.getElementById('entryDriverPhone')?.value.trim() || state.entryWizard.driverPhone,
    driverEmail: document.getElementById('entryDriverEmail')?.value.trim() || state.entryWizard.driverEmail,
    evidenceImage: state.entryWizard.evidenceDataUrl || DEFAULT_CAR_SVG,
    allow_unverified: true
  };

  try {
    const res = await fetch('/api/sessions/entry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (data.success && data.session) {
      showToast('Registration Confirmed', `Vehicle ${payload.plate} assigned to bay ${payload.slot_id}`, 'success');
      if (data.bill && typeof showBillModal === 'function') {
        showBillModal(data.bill);
      }
      
      // Show printable receipt modal
      document.getElementById('rcptSessionId').textContent = data.session.session_id;
      document.getElementById('rcptPlate').textContent = data.session.vehicle_plate;
      document.getElementById('rcptSlot').textContent = data.session.slot_id;
      document.getElementById('rcptEntryTime').textContent = new Date(data.session.entry_time).toLocaleTimeString('en-IN');

      const btnWhatsApp = document.getElementById('btnReceiptWhatsApp');
      if (btnWhatsApp) {
        btnWhatsApp.onclick = () => {
          const rawPhone = (payload.driverPhone || '').replace(/[^0-9]/g, '');
          const cleanPhone = rawPhone.length === 10 ? '91' + rawPhone : rawPhone;
          const msg = `🚗 *eParkNiyantran Official Parking Slip*\n` +
            `Pass ID: ${data.session.session_id}\n` +
            `Vehicle Plate: ${data.session.vehicle_plate}\n` +
            `Allocated Bay: ${data.session.slot_id}\n` +
            `Entry Time: ${new Date(data.session.entry_time).toLocaleTimeString('en-IN')}\n` +
            `Status: ACTIVE (In Bay)\n\n` +
            `_Thank you for parking with eParkNiyantran._`;
          window.open(`https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(msg)}`, '_blank');
        };
      }

      document.getElementById('entryReceiptModal')?.classList.add('open');

      // Refresh slots and sessions
      loadSlots();
      loadActiveSessions();
      setEntryStep(1);
    } else {
      showToast('Registration Error', data.error || 'Failed to complete registration', 'error');
    }
  } catch (err) {
    showToast('Network Error', err.message, 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i data-lucide="check-circle" class="w-4 h-4"></i><span>Confirm Entry & Print Slip</span>';
      initIcons();
    }
  }
}

function closeEntryReceiptModal() {
  document.getElementById('entryReceiptModal')?.classList.remove('open');
}

// --- Exit & Billing Workflow ---
function initExitWorkflow() {
  const sessionSelect = document.getElementById('exitSessionSelect');
  if (sessionSelect) {
    sessionSelect.addEventListener('change', (e) => {
      handleExitSessionSelect(e.target.value);
    });
  }

  // Payment method buttons
  document.getElementById('payMethodUpi')?.addEventListener('click', () => setPaymentMethod('UPI'));
  document.getElementById('payMethodCard')?.addEventListener('click', () => setPaymentMethod('CARD'));
  document.getElementById('payMethodCash')?.addEventListener('click', () => setPaymentMethod('CASH'));

  // Confirm payment & exit
  document.getElementById('btnConfirmExitPayment')?.addEventListener('click', submitExitPayment);
}

function setPaymentMethod(method) {
  state.exitWizard.paymentMethod = method;
  const upiBtn = document.getElementById('payMethodUpi');
  const cardBtn = document.getElementById('payMethodCard');
  const cashBtn = document.getElementById('payMethodCash');
  const qrBox = document.getElementById('upiQrBox');

  upiBtn.className = method === 'UPI' ? 'btn-primary text-xs py-2' : 'btn-secondary text-xs py-2';
  cardBtn.className = method === 'CARD' ? 'btn-primary text-xs py-2' : 'btn-secondary text-xs py-2';
  cashBtn.className = method === 'CASH' ? 'btn-primary text-xs py-2' : 'btn-secondary text-xs py-2';

  if (qrBox) {
    qrBox.classList.toggle('hidden', method !== 'UPI');
  }
}

function populateExitSessionSelect() {
  const select = document.getElementById('exitSessionSelect');
  if (!select) return;

  const currentVal = state.exitWizard.selectedSessionId || select.value;
  select.innerHTML = '<option value="">-- Choose Active Session --</option>' +
    state.activeSessions.map(s => `
      <option value="${s.session_id}" ${s.session_id === currentVal ? 'selected' : ''}>
        ${s.vehicle_plate} — ${s.slot_id} (${s.make_model || 'Vehicle'})${s.status === 'PENDING_PAYMENT' ? ' [Pending Payment]' : ''}
      </option>
    `).join('');

  if (currentVal && state.activeSessions.some(s => s.session_id === currentVal)) {
    select.value = currentVal;
  }
}

function quickExitSession(sessionId) {
  navigateTo('exit');
  handleExitSessionSelect(sessionId);
}

function handleExitSessionSelect(sessionId) {
  state.exitWizard.selectedSessionId = sessionId;
  const session = state.activeSessions.find(s => s.session_id === sessionId);
  if (!session) return;

  const select = document.getElementById('exitSessionSelect');
  if (select) select.value = sessionId;

  document.getElementById('exitSessionIdBadge').textContent = session.session_id;
  document.getElementById('exitPlateDisplay').textContent = session.vehicle_plate;
  document.getElementById('exitEntryTimeText').textContent = new Date(session.entry_time).toLocaleTimeString('en-IN');
  document.getElementById('exitSlotText').textContent = session.slot_id;

  // Compute duration & fee
  const entryDate = new Date(session.entry_time);
  const durationSec = Math.max(0, Math.floor((Date.now() - entryDate.getTime()) / 1000));
  const durationMin = Math.ceil(durationSec / 60);

  document.getElementById('exitDurationText').textContent = formatDuration(durationSec);

  // Fee calculation (15 min grace, ₹100 up to 60m, ₹250 up to 90m, ₹500 up to 180m, ₹1000 + fine if >180m)
  let baseFee = 0;
  let fineAmount = 0;
  let tier = 'Grace (<15m)';

  if (durationMin <= 15) {
    baseFee = 0;
    tier = 'Complimentary (<15m)';
  } else if (durationMin <= 60) {
    baseFee = 100;
    tier = 'Tier 1 (Up to 60m)';
  } else if (durationMin <= 90) {
    baseFee = 250;
    tier = 'Tier 2 (Up to 90m)';
  } else if (durationMin <= 180) {
    baseFee = 500;
    tier = 'Tier 3 (Up to 180m)';
  } else {
    baseFee = 1000;
    fineAmount = 100; // Overdue fine
    tier = 'Overdue (>180m)';
  }

  const agencyShare = baseFee * 0.10;
  const totalPayable = baseFee + fineAmount;

  document.getElementById('exitTierText').textContent = tier;
  document.getElementById('exitBaseFeeText').textContent = `₹${baseFee.toFixed(2)}`;
  document.getElementById('exitAgencyShareText').textContent = `₹${agencyShare.toFixed(2)}`;
  document.getElementById('exitFineAmountText').textContent = `₹${fineAmount.toFixed(2)}`;
  document.getElementById('exitTotalPayableText').textContent = `₹${totalPayable.toFixed(2)}`;

  // Generate UPI QR SVG
  generateUpiQrCode(session.vehicle_plate, totalPayable);
}

function generateUpiQrCode(plate, amount) {
  const container = document.getElementById('upiQrCodeContainer');
  if (!container) return;

  // Clean SVG QR representation
  container.innerHTML = `
    <svg viewBox="0 0 100 100" class="w-full h-full">
      <rect width="100" height="100" fill="#ffffff"/>
      <rect x="5" y="5" width="30" height="30" fill="#000000"/>
      <rect x="10" y="10" width="20" height="20" fill="#ffffff"/>
      <rect x="15" y="15" width="10" height="10" fill="#000000"/>
      <rect x="65" y="5" width="30" height="30" fill="#000000"/>
      <rect x="70" y="10" width="20" height="20" fill="#ffffff"/>
      <rect x="75" y="15" width="10" height="10" fill="#000000"/>
      <rect x="5" y="65" width="30" height="30" fill="#000000"/>
      <rect x="10" y="70" width="20" height="20" fill="#ffffff"/>
      <rect x="15" y="75" width="10" height="10" fill="#000000"/>
      <rect x="45" y="20" width="10" height="10" fill="#000000"/>
      <rect x="40" y="45" width="20" height="20" fill="#2563eb"/>
      <rect x="65" y="65" width="10" height="10" fill="#000000"/>
      <rect x="80" y="80" width="15" height="15" fill="#000000"/>
    </svg>
  `;
}

async function submitExitPayment() {
  const sessionId = state.exitWizard.selectedSessionId;
  if (!sessionId) {
    showToast('Select Session', 'Please select an active vehicle to exit', 'warning');
    return;
  }

  const confirmBtn = document.getElementById('btnConfirmExitPayment');
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i><span>Releasing Bay...</span>';
    initIcons();
  }

  try {
    const res = await fetch(`/api/sessions/${sessionId}/exit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        settle_payment: true,
        payment_method: state.exitWizard.paymentMethod || 'UPI_QR',
        operator_id: state.currentOperator
      })
    });
    const data = await res.json();

    if (data.success) {
      // Also invoke callback to guarantee payment record exists and fine is cleared
      try {
        await fetch('/api/payments/callback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: sessionId,
            method: state.exitWizard.paymentMethod || 'UPI_QR',
            provider_ref: 'TXN-' + Date.now()
          })
        });
      } catch (_) {}

      showToast('Exit Completed', `Bay ${data.slot_freed || ''} released. Payment recorded.`, 'success');
      state.exitWizard.selectedSessionId = null;
      await Promise.all([loadSlots(), loadActiveSessions(), loadReports()]);
      navigateTo('dashboard');
    } else {
      showToast('Exit Error', data.error || 'Failed to process vehicle exit', 'error');
    }
  } catch (err) {
    showToast('Network Error', err.message, 'error');
  } finally {
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.innerHTML = '<i data-lucide="check" class="w-4 h-4"></i><span>Confirm Payment & Release Bay</span>';
      initIcons();
    }
  }
}

// --- Exceptions & Bans Management ---
function initExceptionsActions() {
  document.getElementById('btnApplyOverdueFine')?.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/exceptions/apply-daily-fine', { method: 'POST' });
      const data = await res.json();
      showToast('Fines Applied', `Applied ₹100 overdue fine to ${data.finesApplied || 0} vehicle(s)`, 'success');
      loadExceptions();
    } catch (e) {
      showToast('Action Failed', e.message, 'error');
    }
  });

  document.getElementById('btnRunMidnightClearance')?.addEventListener('click', async () => {
    if (!confirm('Execute 11:59 PM End-of-Day Clearance Sweep?\nThis sweeps remaining vehicles and enforces daily bans.')) return;
    try {
      const res = await fetch('/api/exceptions/end-of-day-clearance', { method: 'POST' });
      const data = await res.json();
      showToast('Clearance Complete', `Processed ${data.clearedCount || 0} vehicles`, 'info');
      loadExceptions();
      loadActiveSessions();
    } catch (e) {
      showToast('Action Failed', e.message, 'error');
    }
  });
}

function renderExceptionsTable() {
  const tbody = document.getElementById('exceptionsTbody');
  if (!tbody) return;

  if (state.exceptions.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="py-6 text-center text-slate-500">No active violations detected. System normal.</td></tr>`;
    return;
  }

  tbody.innerHTML = state.exceptions.map(s => `
    <tr class="hover:bg-[var(--bg-surface-hover)] transition">
      <td class="py-2.5 px-3 font-bold font-mono text-rose-400">${s.vehicle_plate}</td>
      <td class="py-2.5 px-3 font-mono font-semibold text-blue-400">${s.slot_id}</td>
      <td class="py-2.5 px-3 font-mono text-amber-400">${formatDuration(s.duration_seconds || 0)}</td>
      <td class="py-2.5 px-3 font-mono font-bold text-rose-400">₹${Number(s.pending_fine_amount || 100).toFixed(2)}</td>
      <td class="py-2.5 px-3 text-[var(--text-secondary)]">Overdue >180m</td>
      <td class="py-2.5 px-3 text-right">
        <button onclick="quickExitSession('${s.session_id}')" class="btn-primary text-[11px] py-1 px-2.5">
          Settle Fee
        </button>
      </td>
    </tr>
  `).join('');
}

// --- Settings & Gateway Preferences ---
function initSettingsActions() {
  document.getElementById('btnSaveGatewaySettings')?.addEventListener('click', async () => {
    const vahan = document.getElementById('settingsVahanEndpoint')?.value;
    const rzp = document.getElementById('settingsRazorpayKey')?.value;
    const sms = document.getElementById('settingsSmsMode')?.value;

    try {
      const res = await fetch('/api/gateways/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vahanEndpoint: vahan, razorpayKeyId: rzp, smsMode: sms })
      });
      const data = await res.json();
      if (data.success) {
        showToast('Settings Saved', 'External gateway configurations updated', 'success');
      }
    } catch (e) {
      showToast('Save Error', e.message, 'error');
    }
  });

  document.getElementById('btnExportCsv')?.addEventListener('click', () => {
    window.location.href = '/api/export';
  });
}

// --- Profile & Authentication Handlers ---
function initProfileDropdown() {
  const trigger = document.getElementById('btnProfileMenuToggle');
  const dropdown = document.getElementById('profileDropdown');

  if (trigger && dropdown) {
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.classList.toggle('hidden');
    });

    document.addEventListener('click', () => {
      dropdown.classList.add('hidden');
    });
  }
}

function closeProfileDropdown() {
  document.getElementById('profileDropdown')?.classList.add('hidden');
}

function openProfileModal() {
  document.getElementById('profileModal')?.classList.add('open');
}

function closeProfileModal() {
  document.getElementById('profileModal')?.classList.remove('open');
}

function handleLoginSubmit() {
  const user = document.getElementById('loginUsername')?.value.trim();
  state.currentOperator = user || 'OP-ATTENDANT-01';
  showToast('Authenticated', `Signed in as ${user}`, 'success');
  navigateTo('dashboard');
}

function handleRegisterSubmit() {
  const name = document.getElementById('regFullName')?.value.trim();
  const email = document.getElementById('regEmail')?.value.trim();
  state.currentUser.name = name || 'Meet Alshi';
  state.currentUser.email = email || 'meetalshi19@gmail.com';
  showToast('Account Created', 'Attendant registered successfully', 'success');
  navigateTo('dashboard');
}

function handleLogout() {
  showToast('Logged Out', 'Session terminated safely', 'info');
  navigateTo('login');
}

// --- Toast Notification System ---
function showToast(title, message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const iconName = type === 'success' ? 'check-circle' : type === 'error' ? 'alert-circle' : type === 'warning' ? 'alert-triangle' : 'info';

  toast.innerHTML = `
    <i data-lucide="${iconName}" class="w-4 h-4 flex-shrink-0"></i>
    <div class="leading-tight">
      <div class="font-bold text-xs">${title}</div>
      <div class="text-[11px] text-[var(--text-secondary)]">${message}</div>
    </div>
  `;

  container.appendChild(toast);
  initIcons();

  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 250);
  }, 4000);
}


// Globals for integrated municipal modules
let currentOperator = "OP-ATTENDANT-01";
let currentGeneratedBill = null;



// ==========================================================================
// INTEGRATED MUNICIPAL PARKING FEATURES: BILLING, FEEDBACK, SMS & IOT
// ==========================================================================

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

function initDirectMessenger() {
  const presetSelect = document.getElementById('directMsgPreset');
  const bodyInput = document.getElementById('directMsgBody');
  const phoneInput = document.getElementById('directMsgPhone');
  const waBtn = document.getElementById('btnSendDirectWhatsApp');
  const smsBtn = document.getElementById('btnSendDirectSms');
  const feedback = document.getElementById('directMsgFeedback');

  if (presetSelect && bodyInput) {
    presetSelect.addEventListener('change', () => {
      const v = presetSelect.value;
      if (v === 'welcome') {
        bodyInput.value = `[eParkNiyantran] Welcome! Vehicle checked in at Gate 1. Bay: 4W-01. Timings & instant digital bill: ${window.location.origin}/`;
      } else if (v === 'reminder') {
        bodyInput.value = `[eParkNiyantran Alert] ⚠️ 5-Min Reminder: Your scheduled parking stay is ending in 5 minutes. Please proceed to the exit to avoid overstay penalty.`;
      } else if (v === 'receipt') {
        bodyInput.value = `[eParkNiyantran] ✅ Payment Received! Parking fee settled successfully. Thank you for visiting Market Place.`;
      } else if (v === 'overdue') {
        bodyInput.value = `[eParkNiyantran Alert] 🚨 Overdue Notice: Vehicle exceeded scheduled stay. Fine applied per municipal tariff. Clear dues to avoid towing/ban.`;
      } else if (v === 'custom') {
        bodyInput.value = '';
        bodyInput.focus();
      }
    });
  }

  if (waBtn) {
    waBtn.addEventListener('click', () => {
      const rawPhone = phoneInput ? phoneInput.value.trim() : '9823012345';
      const cleanPhone = rawPhone.replace(/[^0-9]/g, '').slice(-10);
      const text = bodyInput ? bodyInput.value.trim() : '';
      if (!cleanPhone) {
        alert('Please enter a valid 10-digit mobile number.');
        return;
      }
      const url = `https://api.whatsapp.com/send?phone=91${cleanPhone}&text=${encodeURIComponent(text)}`;
      window.open(url, '_blank');
    });
  }

  if (smsBtn) {
    smsBtn.addEventListener('click', async () => {
      const rawPhone = phoneInput ? phoneInput.value.trim() : '9823012345';
      const text = bodyInput ? bodyInput.value.trim() : '';
      if (!text) {
        alert('Please enter message text to send.');
        return;
      }
      if (feedback) {
        feedback.className = 'p-2 rounded-lg text-xs font-semibold bg-blue-500/15 text-blue-400 block';
        feedback.textContent = 'Dispatching message via SMS gateway...';
      }

      try {
        const res = await fetch('/api/sms/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: rawPhone, message: text })
        });
        const data = await res.json();
        if (feedback) {
          if (data.result && data.result.status === 'SENT') {
            feedback.className = 'p-2 rounded-lg text-xs font-semibold bg-emerald-500/20 text-emerald-400 block';
            feedback.textContent = `✅ Live carrier SMS dispatched to ${rawPhone} via ${data.result.provider}!`;
          } else {
            feedback.className = 'p-2 rounded-lg text-xs font-semibold bg-amber-500/20 text-amber-300 block';
            feedback.textContent = `Delivered to Sandbox log. To send real carrier SMS directly, add your free Fast2SMS API key in the Gateways tab, or use 'Send via WhatsApp'!`;
          }
        }
        appendVirtualPhoneSms('Citizen SMS', text);
        loadNotifications();
      } catch (e) {
        if (feedback) {
          feedback.className = 'p-2 rounded-lg text-xs font-semibold bg-rose-500/20 text-rose-400 block';
          feedback.textContent = `Dispatch Error: ${e.message}`;
        }
      }
    });
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

  const sendWhatsAppBtn = document.getElementById('btnSendBillWhatsApp');
  const sendSmsGatewayBtn = document.getElementById('btnSendBillSmsGateway');
  const feedbackBox = document.getElementById('billSmsFeedbackBox');

  if (sendWhatsAppBtn) {
    sendWhatsAppBtn.addEventListener('click', () => {
      if (!currentGeneratedBill) return;
      const b = currentGeneratedBill;
      const phoneInput = document.getElementById('inputCustomerPhone');
      const phone = b.phone || (phoneInput ? phoneInput.value : '9823012345');
      const cleanPhone = phone.replace(/[^0-9]/g, '').slice(-10);

      const inStr = new Date(b.entry_time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
      const outStr = new Date(b.expected_exit_time || b.out_time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

      const msg = `🚗 *eParkNiyantran - Parking Bill Slip* 🚗\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `📄 *Bill No:* ${b.bill_number || ('EPN-' + (b.session_id||'').slice(-6))}\n` +
        `🚙 *Vehicle:* ${b.vehicle_plate}\n` +
        `🅿️ *Bay:* ${b.slot_id} (${b.category === '2W' ? '2-Wheeler' : '4-Wheeler'})\n` +
        `🕒 *In-Time:* ${inStr}\n` +
        `⏳ *Scheduled Out:* ${outStr}\n` +
        `💰 *Total Amount:* ₹${b.total_amount} (${b.is_prepaid ? 'PAID ✅' : 'DUE ⚠️'})\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `📍 *Location:* Market Place Parking\n` +
        `ℹ️ Retain this message for fast barrier exit clearance.`;

      const waUrl = `https://api.whatsapp.com/send?phone=91${cleanPhone}&text=${encodeURIComponent(msg)}`;
      window.open(waUrl, '_blank');
    });
  }

  if (sendSmsGatewayBtn) {
    sendSmsGatewayBtn.addEventListener('click', async () => {
      if (!currentGeneratedBill) return;
      const b = currentGeneratedBill;
      const phoneInput = document.getElementById('inputCustomerPhone');
      const phone = b.phone || (phoneInput ? phoneInput.value : '9823012345');

      if (feedbackBox) {
        feedbackBox.className = 'p-2 rounded-lg text-xs font-semibold text-center bg-blue-500/15 text-blue-400 block';
        feedbackBox.textContent = 'Dispatching carrier SMS via gateway...';
      }

      try {
        const smsMsg = `[eParkNiyantran] Bill #${b.bill_number || b.session_id} for ${b.vehicle_plate}. Bay: ${b.slot_id}. Amount: ₹${b.total_amount} (${b.is_prepaid ? 'PAID' : 'DUE'}). Retain for exit.`;
        const res = await fetch('/api/sms/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone, message: smsMsg })
        });
        const data = await res.json();
        if (feedbackBox) {
          if (data.result && data.result.status === 'SENT') {
            feedbackBox.className = 'p-2 rounded-lg text-xs font-semibold text-center bg-emerald-500/20 text-emerald-400 block';
            feedbackBox.textContent = `✅ Live message dispatched to ${phone} via ${data.result.provider}!`;
          } else {
            feedbackBox.className = 'p-2 rounded-lg text-xs font-semibold text-center bg-amber-500/20 text-amber-300 block';
            feedbackBox.textContent = `Provider status: ${data.result?.status || 'Sent to sandbox'}. For real SIM delivery, set Fast2SMS API key in Gateways tab or click 'Send on WhatsApp'!`;
          }
        }
        loadNotifications();
      } catch (e) {
        if (feedbackBox) {
          feedbackBox.className = 'p-2 rounded-lg text-xs font-semibold text-center bg-rose-500/20 text-rose-400 block';
          feedbackBox.textContent = `Failed: ${e.message}`;
        }
      }
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

async function loadNotifications() {
  try {
    const res = await fetch('/api/notifications');
    const data = await res.json();
    if (!data.success) return;

    const tbody = document.getElementById('smsTableBody');
    tbody.innerHTML = '';
    
    if (data.notifications.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="p-4 text-center text-slate-500">No dispatched SMS messages yet.</td></tr>';
      return;
    }

    data.notifications.forEach(n => {
      const cleanPhone = (n.recipient_phone || '').replace(/[^0-9]/g, '').slice(-10);
      const waUrl = `https://api.whatsapp.com/send?phone=91${cleanPhone}&text=${encodeURIComponent(n.message_body)}`;
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-slate-900/60 dark:hover:bg-slate-900 transition';
      tr.innerHTML = `
        <td class="p-2 font-mono text-[11px] text-slate-400">${n.notification_id}</td>
        <td class="p-2 font-mono text-slate-800 dark:text-white font-medium">${n.recipient_phone}</td>
        <td class="p-2 font-mono text-[10px] text-blue-500 dark:text-blue-400">${n.dlt_template_id}</td>
        <td class="p-2 text-slate-700 dark:text-slate-300 max-w-xs truncate" title="${n.message_body}">${n.message_body}</td>
        <td class="p-2"><span class="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold">${n.status}</span></td>
        <td class="p-2 text-right font-mono text-[10px] text-slate-500 dark:text-slate-400">${new Date(n.sent_time || n.scheduled_time).toLocaleTimeString()}</td>
        <td class="p-2 text-center">
          <a href="${waUrl}" target="_blank" title="Send direct to customer via WhatsApp" class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-600/15 hover:bg-emerald-600/30 text-emerald-600 dark:text-emerald-400 font-bold text-[10px] transition border border-emerald-500/30">
            <span>📱 WhatsApp</span>
          </a>
        </td>
      `;
      tbody.appendChild(tr);
    });

  } catch (err) {
    console.error('Failed to load notifications:', err);
  }
}

