/**
 * Apex Elite — Contractor Front Office Voice AI Command Center
 * Standard Sidebar Dashboard Client Controller (Admin / Staff / Customer)
 */

const SCENARIOS = {
  burst_pipe: {
    title: 'Burst Pipe Emergency',
    transcript: "Caller: Hi, my name is Mark Sullivan. I have an emergency burst pipe in my basement at 410 Oakwood Drive, Springfield. Water is pouring everywhere. My phone is 555-234-5678. Can you send a plumber tomorrow morning at 9:00 AM?",
  },
  hvac_repair: {
    title: 'AC Unit Failure',
    transcript: "Caller: Hi, this is Linda Gomez at 882 Pine Creek Lane. My central air conditioning unit stopped blowing cold air and it's 85 degrees inside. Phone number is 555-876-5432. Can you schedule a technician for tomorrow?",
  },
  unbooked_quote: {
    title: 'Water Heater Quote (Unbooked)',
    transcript: "Caller: Hello, I'm calling to get a ballpark estimate on replacing an old 50-gallon gas water heater at 14 Maple Terrace. My name is Dave Miller, 555-345-6789. I'm not ready to book a specific slot today, just need info.",
  },
  ask_human: {
    title: 'Explicit Ask for Human',
    transcript: "Caller: Hi, I have a complicated issue with my commercial boiler and I don't want to talk to an automated system. Please transfer me to a human dispatcher or a real person who works there.",
  },
  garbled_audio: {
    title: 'Garbled / Low Confidence',
    transcript: "Caller: Hello? ... [static] ... water leaking ... [muffled inaudible] ... [garbled noise] ... need help...",
  },
  duplicate_call: {
    title: 'Duplicate Caller',
    transcript: "Caller: Hi again, this is Mark Sullivan calling back about that burst pipe at 410 Oakwood Drive. Just checking if someone is on the way. My phone is 555-234-5678.",
  },
};

// Application State
let currentAppMode = 'landing'; // 'landing' | 'portal'
let currentRole = 'admin'; // 'admin' | 'staff' | 'customer'
let currentView = 'leads'; // Active sidebar view
let currentUser = { id: 1, name: 'Admin Dispatcher', email: 'admin@apexelite.demo', role: 'admin' };
let demoUsers = { admins: [], staff: [], customers: [] };

let currentFilter = 'all';
let searchQuery = '';
let leadsCache = [];
let teamCache = [];
let servicesCache = [];
let leaveCache = [];
let staffOrdersCache = [];
let staffCurrentFilter = 'all';
let staffSearchQuery = '';
let teamCurrentFilter = 'technicians';
let teamSearchQuery = '';
let lastProcessingDuration = 180;

// Initialize Application
document.addEventListener('DOMContentLoaded', async () => {
  initThemeEngine();
  await initAuthAndRoleSwitcher();
  initLandingPage();
  initEventListeners();
  refreshAllData();

  // Polling for live dashboard sync
  setInterval(() => {
    refreshAllData(true);
  }, 4000);
});

/* ==============================================================================
   Theme Engine (Permanent Light Theme)
   ============================================================================== */
function initThemeEngine() {
  document.documentElement.setAttribute('data-theme', 'light');
  localStorage.setItem('apex_theme', 'light');
}

/* ==============================================================================
   Toast Notification System
   ============================================================================== */
function showToast(title, message, type = 'info', duration = 4500) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const iconMap = {
    success: '✅',
    error: '❌',
    info: 'ℹ️',
    warning: '⚠️',
  };

  toast.innerHTML = `
    <span class="toast-icon">${iconMap[type] || '⚡'}</span>
    <div class="toast-content">
      <div class="toast-title">${escapeHtml(title)}</div>
      <div class="toast-message">${escapeHtml(message)}</div>
    </div>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

/* ==============================================================================
   Authenticated API Fetch Helper (Injects Role & User Headers)
   ============================================================================== */
async function authFetch(url, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'x-user-id': currentUser?.email || (currentUser?.id ? String(currentUser.id) : 'admin@apexelite.demo'),
    ...(options.headers || {}),
  };

  return fetch(url, { ...options, headers });
}

/* ==============================================================================
   Sidebar Navigation & Multi-Role Architecture Controller
   ============================================================================== */
async function initAuthAndRoleSwitcher() {
  try {
    const res = await fetch('/api/auth/demo-users');
    if (res.ok) {
      demoUsers = await res.json();
      populateDemoUserSelector();
    }
  } catch (err) {
    console.warn('[Demo Users] Could not load demo user list:', err.message);
  }

  // Handle URL route paths (clean URLs: /home, /portal, /admin, /staff, /customer)
  const path = window.location.pathname.toLowerCase();

  if (path === '/customer' || path.startsWith('/customer')) {
    switchRole('customer');
    switchMode('portal', false);
  } else if (path === '/staff' || path.startsWith('/staff') || path === '/tech') {
    switchRole('staff');
    switchMode('portal', false);
  } else if (path === '/admin' || path.startsWith('/admin') || path === '/portal') {
    switchRole('admin');
    switchMode('portal', false);
  } else {
    // Default to /home for public landing page
    if (window.location.pathname !== '/home' || window.location.search) {
      window.history.replaceState(null, '', '/home');
    }
    switchRole('admin');
    switchMode('landing', false);
  }

  // Handle browser back and forward buttons
  window.addEventListener('popstate', () => {
    const popPath = window.location.pathname.toLowerCase();
    if (['/portal', '/admin', '/staff', '/customer'].includes(popPath)) {
      if (popPath !== '/portal') switchRole(popPath.replace('/', ''));
      switchMode('portal', false);
    } else {
      switchMode('landing', false);
    }
  });

  // Sidebar Role Switcher Buttons
  document.getElementById('btnRoleAdmin')?.addEventListener('click', () => switchRole('admin'));
  document.getElementById('btnRoleStaff')?.addEventListener('click', () => switchRole('staff'));
  document.getElementById('btnRoleCustomer')?.addEventListener('click', () => switchRole('customer'));

  // User Switcher Dropdown Change
  const selector = document.getElementById('demoUserSelector');
  if (selector) {
    selector.addEventListener('change', (e) => {
      const email = e.target.value;
      const allUsers = [...(demoUsers.admins || []), ...(demoUsers.staff || []), ...(demoUsers.customers || [])];
      const match = allUsers.find((u) => u.email === email);
      if (match) {
        currentUser = match;
        currentRole = match.role;
        updateRoleUI();
        refreshAllData();
        showToast('User Switched', `Active session: ${match.name} (${match.role.toUpperCase()})`, 'info');
      }
    });
  }

  // One-Click Demo Reset Baseline Button
  document.getElementById('btnResetDemoBaseline')?.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reseed: true }),
      });
      const data = await res.json();
      if (data.success) {
        showToast('Demo Baseline Restored', 'Pristine demo records restored across all 3 portals.', 'success');
        await refreshAllData();
      }
    } catch (err) {
      showToast('Reset Error', err.message, 'error');
    }
  });

  // Customer Lookup Button
  document.getElementById('btnCustomerLookup')?.addEventListener('click', handleCustomerLookup);
  document.getElementById('customerLookupInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleCustomerLookup();
  });
}

function populateDemoUserSelector() {
  const selector = document.getElementById('demoUserSelector');
  if (!selector) return;

  let html = '<optgroup label="👑 Admins & Dispatchers">';
  (demoUsers.admins || []).forEach((u) => {
    html += `<option value="${u.email}">👑 ${u.name}</option>`;
  });
  html += '</optgroup><optgroup label="👷 Field Staff & Technicians">';
  (demoUsers.staff || []).forEach((u) => {
    html += `<option value="${u.email}">👷 ${u.name}</option>`;
  });
  html += '</optgroup><optgroup label="👤 Verified Customers">';
  (demoUsers.customers || []).forEach((u) => {
    html += `<option value="${u.email}">👤 ${u.name}</option>`;
  });
  html += '</optgroup>';

  selector.innerHTML = html;
  if (currentUser) {
    selector.value = currentUser.email;
  }
}

function switchRole(role, specificUser = null) {
  currentRole = role;

  if (specificUser) {
    currentUser = specificUser;
  } else {
    if (role === 'admin') {
      currentUser = (demoUsers.admins && demoUsers.admins[0]) || { id: 1, name: 'Admin Dispatcher', email: 'admin@apexelite.demo', role: 'admin' };
      currentView = 'leads';
    } else if (role === 'staff') {
      currentUser = (demoUsers.staff && demoUsers.staff[0]) || { id: 2, name: 'Dave Miller', email: 'dave@apexelite.demo', role: 'staff' };
      currentView = 'staff-orders';
    } else if (role === 'customer') {
      currentUser = (demoUsers.customers && demoUsers.customers[0]) || { id: 6, name: 'Robert King', email: 'robert.k@gmail.com', role: 'customer' };
      currentView = 'customer-order';
    }
  }

  renderSidebarNav();
  updateRoleUI();
  switchView(currentView);
  refreshAllData();

  if (currentAppMode === 'portal') {
    window.history.replaceState(null, '', `/${role}`);
  }
}

function renderSidebarNav() {
  const nav = document.getElementById('sidebarNav');
  if (!nav) return;

  let html = '';

  if (currentRole === 'admin') {
    html = `
      <div class="nav-section-title">OPERATIONS & DISPATCH</div>
      <a class="sidebar-nav-item ${currentView === 'leads' ? 'active' : ''}" data-view="leads" id="navItemLeads">
        <span class="nav-left"><span class="nav-icon">📋</span> <span>Leads & Dispatch</span></span>
        <span class="nav-badge" id="sidebarLeadsBadge">${leadsCache.length}</span>
      </a>
      <a class="sidebar-nav-item ${currentView === 'attention' ? 'active' : ''}" data-view="attention" id="navItemAttention">
        <span class="nav-left"><span class="nav-icon">🚨</span> <span>Needs Attention</span></span>
        <span class="nav-badge badge-danger" id="sidebarAttentionBadge">
          ${leadsCache.filter(l => l.status === 'Escalated to Human' || l.status === 'Escalated' || l.urgency === 'Emergency').length}
        </span>
      </a>
      <a class="sidebar-nav-item ${currentView === 'team' ? 'active' : ''}" data-view="team" id="navItemTeam">
        <span class="nav-left"><span class="nav-icon">👥</span> <span>Field Team Roster</span></span>
        <span class="nav-badge" id="sidebarTeamBadge">${teamCache.length}</span>
      </a>

      <div class="nav-section-title">CATALOG & APPROVALS</div>
      <a class="sidebar-nav-item ${currentView === 'services' ? 'active' : ''}" data-view="services" id="navItemServices">
        <span class="nav-left"><span class="nav-icon">🛠️</span> <span>Services Catalog</span></span>
      </a>
      <a class="sidebar-nav-item ${currentView === 'leave' ? 'active' : ''}" data-view="leave" id="navItemLeave">
        <span class="nav-left"><span class="nav-icon">🏖️</span> <span>Leave Requests</span></span>
        <span class="nav-badge badge-warning" id="sidebarLeaveBadge">${leaveCache.filter(l => l.status === 'Pending').length}</span>
      </a>

      <div class="nav-section-title">SYSTEM & RECEPTION</div>
      <a class="sidebar-nav-item ${currentView === 'audit' ? 'active' : ''}" data-view="audit" id="navItemAudit">
        <span class="nav-left"><span class="nav-icon">📢</span> <span>Activity & Logs</span></span>
      </a>
      <a class="sidebar-nav-item ${currentView === 'voice' ? 'active' : ''}" data-view="voice" id="navItemVoice">
        <span class="nav-left"><span class="nav-icon">🎙️</span> <span>Voice AI Receptionist</span></span>
      </a>
    `;
  } else if (currentRole === 'staff') {
    const pendingLeaveCount = leaveCache.filter(l => l.status === 'Pending').length;
    html = `
      <div class="nav-section-title">FIELD WORK ORDERS</div>
      <a class="sidebar-nav-item ${currentView === 'staff-orders' ? 'active' : ''}" data-view="staff-orders" id="navItemStaffOrders">
        <span class="nav-left"><span class="nav-icon">🛠️</span> <span>My Assigned Jobs</span></span>
        <span class="nav-badge" id="sidebarStaffJobsBadge">${staffOrdersCache.length}</span>
      </a>

      <div class="nav-section-title">TIME OFF & AVAILABILITY</div>
      <a class="sidebar-nav-item ${currentView === 'staff-leave' ? 'active' : ''}" data-view="staff-leave" id="navItemStaffLeave">
        <span class="nav-left"><span class="nav-icon">🏖️</span> <span>My Time Off</span></span>
        ${pendingLeaveCount > 0 ? `<span class="nav-badge badge-warning" id="sidebarStaffLeaveBadge">${pendingLeaveCount}</span>` : ''}
      </a>
    `;
  } else if (currentRole === 'customer') {
    html = `
      <div class="nav-section-title">MY SERVICE</div>
      <a class="sidebar-nav-item ${currentView === 'customer-order' ? 'active' : ''}" data-view="customer-order" id="navItemCustomerOrder">
        <span class="nav-left"><span class="nav-icon">📋</span> <span>Active Service Order</span></span>
      </a>
      <a class="sidebar-nav-item ${currentView === 'customer-message' ? 'active' : ''}" data-view="customer-message" id="navItemCustomerMessage">
        <span class="nav-left"><span class="nav-icon">💬</span> <span>Message Technician</span></span>
      </a>
    `;
  }

  nav.innerHTML = html;

  // Add click listeners to sidebar nav items
  nav.querySelectorAll('.sidebar-nav-item').forEach((item) => {
    item.addEventListener('click', () => {
      const view = item.dataset.view;
      switchView(view);
    });
  });
}

function switchView(viewName) {
  // Enforce Voice Receptionist is restricted to Admin role only
  if (viewName === 'voice' && currentRole !== 'admin') {
    viewName = currentRole === 'staff' ? 'staff-orders' : 'customer-order';
  }

  currentView = viewName;

  // Update active class on sidebar items
  document.querySelectorAll('.sidebar-nav-item').forEach((item) => {
    item.classList.toggle('active', item.dataset.view === viewName);
  });

  // Hide all content views
  document.querySelectorAll('.content-view').forEach((v) => {
    v.style.display = 'none';
    v.classList.remove('active');
  });

  // Topbar Breadcrumbs
  const rootLabel = document.getElementById('topbarRootLabel');
  const viewLabel = document.getElementById('topbarActiveViewLabel');

  if (currentRole === 'admin') {
    if (rootLabel) rootLabel.textContent = '👑 Admin Command Center';

    if (viewName === 'leads' || viewName === 'attention') {
      const target = document.getElementById('viewLeads');
      if (target) { target.style.display = 'flex'; target.classList.add('active'); }
      if (viewLabel) viewLabel.textContent = viewName === 'attention' ? '🚨 Needs Attention Triage' : 'Leads & Work Orders';

      // Apply filter
      currentFilter = viewName === 'attention' ? 'Needs Attention' : 'all';
      document.querySelectorAll('.filter-btn').forEach((b) => {
        b.classList.toggle('active', b.dataset.filter === currentFilter);
      });
      renderLeadsTable();
    } else if (viewName === 'team') {
      const target = document.getElementById('viewTeam');
      if (target) { target.style.display = 'flex'; target.classList.add('active'); }
      if (viewLabel) viewLabel.textContent = 'Field Team Roster';
      renderStaffRoster();
    } else if (viewName === 'services') {
      const target = document.getElementById('viewServices');
      if (target) { target.style.display = 'flex'; target.classList.add('active'); }
      if (viewLabel) viewLabel.textContent = 'Services Catalog Management';
      renderServicesTable();
    } else if (viewName === 'leave') {
      const target = document.getElementById('viewLeave');
      if (target) { target.style.display = 'flex'; target.classList.add('active'); }
      if (viewLabel) viewLabel.textContent = 'Staff Leave Approvals';
      renderAdminLeaveTable();
    } else if (viewName === 'audit') {
      const target = document.getElementById('viewAudit');
      if (target) { target.style.display = 'flex'; target.classList.add('active'); }
      if (viewLabel) viewLabel.textContent = 'Outbound Activity & Audit Logs';
    } else if (viewName === 'voice') {
      const target = document.getElementById('viewVoice');
      if (target) { target.style.display = 'flex'; target.classList.add('active'); }
      if (viewLabel) viewLabel.textContent = 'Agent Riley Voice Receptionist';
    }
  } else if (currentRole === 'staff') {
    if (rootLabel) rootLabel.textContent = `👷 Staff Portal: ${currentUser.name}`;

    if (viewName === 'staff-orders') {
      const target = document.getElementById('viewStaffOrders');
      if (target) { target.style.display = 'flex'; target.classList.add('active'); }
      if (viewLabel) viewLabel.textContent = 'My Assigned Work Orders';
      renderStaffOrders();
    } else if (viewName === 'staff-leave') {
      const target = document.getElementById('viewStaffLeave');
      if (target) { target.style.display = 'flex'; target.classList.add('active'); }
      if (viewLabel) viewLabel.textContent = 'My Time Off & Availability';
      renderStaffMyLeaveTable();
    }
  } else if (currentRole === 'customer') {
    if (rootLabel) rootLabel.textContent = `👤 Customer Portal: ${currentUser.name}`;

    if (viewName === 'customer-order') {
      const target = document.getElementById('viewCustomerOrder') || document.getElementById('viewCustomer');
      if (target) { target.style.display = 'flex'; target.classList.add('active'); }
      if (viewLabel) viewLabel.textContent = 'Active Service Order';
      if (!leadsCache || leadsCache.length === 0) {
        fetchCustomerPortal(true);
      } else {
        renderCustomerPortal(leadsCache);
      }
    } else if (viewName === 'customer-message') {
      const target = document.getElementById('viewCustomerMessage');
      if (target) { target.style.display = 'flex'; target.classList.add('active'); }
      if (viewLabel) viewLabel.textContent = 'Message Technician';
      if (!leadsCache || leadsCache.length === 0) {
        fetchCustomerPortal(true);
      } else {
        renderCustomerPortal(leadsCache);
      }
    }
  }
}

function updateRoleUI() {
  // Update Sidebar Role Buttons
  document.querySelectorAll('.sidebar-role-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.role === currentRole);
  });

  // Update Selector value
  const selector = document.getElementById('demoUserSelector');
  if (selector && currentUser) {
    selector.value = currentUser.email;
  }

  // Update Session Chip in Topbar
  const chipText = document.getElementById('sessionUserDisplay');
  if (chipText && currentUser) {
    const icon = currentRole === 'admin' ? '👑' : currentRole === 'staff' ? '👷' : '👤';
    chipText.textContent = `${icon} ${currentUser.name} (${currentRole.toUpperCase()})`;
  }

  // Update Portal Welcome Greetings
  const custGreeting = document.getElementById('customerGreetingName');
  if (custGreeting && currentUser) custGreeting.textContent = currentUser.name;

  const staffGreeting = document.getElementById('staffGreetingName');
  if (staffGreeting && currentUser) staffGreeting.textContent = currentUser.name;
}

/* ==============================================================================
   Master Data Sync (Scoped by Active Role)
   ============================================================================== */
async function refreshAllData(silent = false) {
  try {
    if (currentRole === 'admin') {
      await Promise.all([
        fetchLeads(silent),
        fetchUsers(silent),
        fetchServices(silent),
        fetchLeaveRequests(silent),
        fetchLogs(silent),
        fetchNotifications(silent),
      ]);
    } else if (currentRole === 'customer') {
      await fetchCustomerPortal(silent);
    } else if (currentRole === 'staff') {
      await Promise.all([
        fetchStaffPortal(silent),
        fetchLeaveRequests(silent),
      ]);
    }
  } catch (err) {
    if (!silent) console.error('[Refresh Error]', err);
  }
}

/* ==============================================================================
   LEADS & WORK ORDERS (ADMIN VIEW)
   ============================================================================== */
function getClientSavedLeads() {
  try {
    const raw = localStorage.getItem('apex_client_created_leads');
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveLeadToClientStorage(lead) {
  if (!lead) return;
  try {
    const leads = getClientSavedLeads();
    const id = lead.leadId || lead.lead_id || lead.LeadID || lead.id;
    if (!id) return;
    const cleanId = String(id).toUpperCase();
    const existingIdx = leads.findIndex(l => {
      const lid = l.leadId || l.lead_id || l.LeadID || l.id;
      return lid && String(lid).toUpperCase() === cleanId;
    });
    if (existingIdx >= 0) {
      leads[existingIdx] = { ...leads[existingIdx], ...lead };
    } else {
      leads.unshift(lead);
    }
    localStorage.setItem('apex_client_created_leads', JSON.stringify(leads.slice(0, 50)));

    // Background sync to active serverless instance
    authFetch('/api/leads/sync', {
      method: 'POST',
      body: JSON.stringify({ leads: [lead] }),
    }).catch(() => {});
  } catch (e) {}
}

async function fetchLeads(silent = false) {
  try {
    const res = await authFetch('/api/leads');
    if (res.ok) {
      const data = await res.json();
      const serverLeads = data.leads || [];
      const clientLeads = getClientSavedLeads();

      // Merge client saved leads with server leads (ensuring Vercel serverless persistence)
      const mergedMap = new Map();
      for (const cl of clientLeads) {
        const id = cl.leadId || cl.lead_id || cl.LeadID || cl.id;
        if (id) mergedMap.set(String(id).toUpperCase(), cl);
      }
      for (const sl of serverLeads) {
        const id = sl.leadId || sl.lead_id || sl.LeadID || sl.id;
        if (id && !mergedMap.has(String(id).toUpperCase())) {
          mergedMap.set(String(id).toUpperCase(), sl);
        }
      }

      leadsCache = Array.from(mergedMap.values());
      renderLeadsTable();
      updateKpis(leadsCache);

      const leadsBadge = document.getElementById('sidebarLeadsBadge');
      if (leadsBadge) leadsBadge.textContent = leadsCache.length;

      const attentionBadge = document.getElementById('sidebarAttentionBadge');
      if (attentionBadge) {
        const count = leadsCache.filter(l => l.status === 'Escalated to Human' || l.status === 'Escalated' || l.urgency === 'Emergency').length;
        attentionBadge.textContent = count;
      }

      // Sync any unsynced local leads to server in background
      if (clientLeads.length > 0) {
        authFetch('/api/leads/sync', {
          method: 'POST',
          body: JSON.stringify({ leads: clientLeads }),
        }).catch(() => {});
      }
    }
  } catch (err) {
    if (!silent) console.error('[Fetch Leads Error]', err);
  }
}

function updateKpis(leads) {
  const total = leads.length;
  const booked = leads.filter((l) => l.status === 'Booked' || l.Status === 'Booked').length;
  const inProgress = leads.filter((l) => l.status === 'In Progress').length;
  const escalations = leads.filter(
    (l) => l.status === 'Escalated to Human' || l.status === 'Escalated' || l.urgency === 'Emergency'
  ).length;

  const totalEl = document.getElementById('kpiTotalLeads');
  if (totalEl) totalEl.textContent = total;

  const bookingRateEl = document.getElementById('kpiBookingRate');
  if (bookingRateEl) {
    const rate = total > 0 ? Math.round(((booked + inProgress) / total) * 100) : 0;
    bookingRateEl.textContent = `${rate}%`;
  }

  const bookedCountEl = document.getElementById('kpiBookedCount');
  if (bookedCountEl) bookedCountEl.textContent = `${booked} booked, ${inProgress} in-progress`;

  const escalationsEl = document.getElementById('kpiEscalations');
  if (escalationsEl) escalationsEl.textContent = escalations;

  const attentionFilterCount = document.getElementById('filterAttentionCount');
  if (attentionFilterCount) attentionFilterCount.textContent = escalations;

  const countBadge = document.getElementById('leadsCount');
  if (countBadge) countBadge.textContent = total;
}

function renderLeadsTable() {
  const tbody = document.getElementById('leadsTableBody');
  if (!tbody) return;

  let filtered = leadsCache.filter((lead) => {
    if (currentFilter === 'Needs Attention') {
      const isEscalated = lead.status === 'Escalated to Human' || lead.status === 'Escalated' || lead.urgency === 'Emergency';
      if (!isEscalated) return false;
    } else if (currentFilter !== 'all') {
      if ((lead.status || '').toLowerCase() !== currentFilter.toLowerCase()) return false;
    }

    if (searchQuery) {
      const combined = `${lead.name} ${lead.phone} ${lead.location} ${lead.jobType || lead.job_type} ${lead.leadId}`.toLowerCase();
      if (!combined.includes(searchQuery)) return false;
    }

    return true;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty-state">No matching leads found for filter "${escapeHtml(currentFilter)}".</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map((l) => {
    const isEscalatedStatus = l.status === 'Escalated to Human' || l.status === 'Escalated';
    const isEmergencyUrgency = l.urgency === 'Emergency';
    const sourceIcon = l.source === 'ai_voice' ? '🎙️ Voice AI' : l.source === 'ai_chat' ? '💬 Web Chat' : '📝 Manual';

    // Check for double-booking collision (same tech, same booked slot on active leads)
    const isDoubleBooked = !!(l.assignedTech && l.bookedSlot && l.status !== 'Closed' && leadsCache.some((other) => {
      if (other.id === l.id || other.leadId === l.leadId) return false;
      if (other.status === 'Closed') return false;
      const sameTech = (other.assignedTech || '').trim() && (other.assignedTech || '').trim().toLowerCase() === (l.assignedTech || '').trim().toLowerCase();
      const sameSlot = (other.bookedSlot || '').trim() && (other.bookedSlot || '').trim() === (l.bookedSlot || '').trim();
      return sameTech && sameSlot;
    }));

    // Check for out-of-service-area location
    const locLower = (l.location || '').toLowerCase();
    const isOutOfArea = locLower.includes('pakistan') || locLower.includes('islamabad') || locLower.includes('lahore') || locLower.includes('karachi') || locLower.includes('dublin') || locLower.includes('london');

    const rowClass = isDoubleBooked ? 'table-row-attention' : (isEscalatedStatus || isEmergencyUrgency ? 'table-row-attention' : '');

    return `
      <tr class="${rowClass}">
        <td>
          <div style="display: flex; flex-direction: column; gap: 3px;">
            <strong style="font-family: var(--font-mono); font-size: 0.8rem;">${escapeHtml(l.leadId || 'LD-NEW')}</strong>
            <span class="badge badge-subtle" style="font-size: 0.68rem; align-self: flex-start;">${sourceIcon}</span>
          </div>
        </td>
        <td>
          ${!l.name || ['caller', 'unknown caller', 'customer', 'riley'].includes(l.name.toLowerCase().trim())
            ? `<span class="badge badge-warning-subtle" style="font-size: 0.72rem; color: #b45309; background: #fef3c7; border: 1px solid #fde68a;">⚠️ Name Missing</span>`
            : `<strong style="font-weight: 700; color: #0f172a;">${escapeHtml(l.name)}</strong>`
          }
          ${l.email ? `<div style="font-size: 0.72rem; color: #64748b;">${escapeHtml(l.email)}</div>` : ''}
        </td>
        <td>
          <div style="font-size: 0.82rem; font-weight: 600;">
            ${l.phone && l.phone.length >= 7 
              ? escapeHtml(l.phone) 
              : `<span style="color: #dc2626; font-size: 0.74rem;">⚠️ Phone Missing</span>`
            }
          </div>
          <div style="font-size: 0.75rem; color: #64748b;">
            ${l.location && !l.location.toLowerCase().includes('pending') && !l.location.toLowerCase().includes('unknown')
              ? escapeHtml(l.location)
              : `<span style="color: #b45309; font-style: italic; font-size: 0.72rem;">⚠️ Address Missing</span>`
            }
          </div>
          ${isOutOfArea ? `<div class="badge badge-warning-subtle" style="font-size: 0.68rem; margin-top: 3px; color: #b45309; background: #fef3c7; border: 1px solid #fde68a; display: inline-flex; align-items: center; gap: 3px;" title="Customer location is outside Springfield 25-mile local service territory">⚠️ Out of Service Area</div>` : ''}
        </td>
        <td>
          <div style="font-weight: 600; font-size: 0.82rem;">${escapeHtml(l.jobType || l.job_type || 'General')}</div>
          <span class="badge ${l.urgency === 'Emergency' ? 'badge-danger-subtle' : l.urgency === 'High' ? 'badge-warning-subtle' : 'badge-subtle'}" style="font-size: 0.7rem;">
            ${escapeHtml(l.urgency || 'Normal')}
          </span>
        </td>
        <td>
          <select class="status-select-dropdown" onchange="handleAdminStatusChange('${l.leadId}', this.value)">
            <option value="New Lead" ${l.status === 'New Lead' || l.status === 'New' ? 'selected' : ''}>New Lead</option>
            <option value="Qualified" ${l.status === 'Qualified' ? 'selected' : ''}>Qualified</option>
            <option value="Booked" ${l.status === 'Booked' ? 'selected' : ''}>Booked</option>
            <option value="In Progress" ${l.status === 'In Progress' ? 'selected' : ''}>In Progress</option>
            <option value="Awaiting Response" ${l.status === 'Awaiting Response' ? 'selected' : ''}>Awaiting Response</option>
            <option value="Completed" ${l.status === 'Completed' ? 'selected' : ''}>Completed</option>
            <option value="Escalated to Human" ${isEscalatedStatus ? 'selected' : ''}>🚨 Needs Attention</option>
            <option value="Closed" ${l.status === 'Closed' ? 'selected' : ''}>Closed</option>
          </select>
        </td>
        <td>
          <span style="font-size: 0.78rem; font-weight: 500;">
            ${l.bookedSlot ? escapeHtml(formatSlot(l.bookedSlot)) : '<span style="color: #94a3b8; font-style: italic;">Not scheduled</span>'}
          </span>
          ${isDoubleBooked ? `<div style="font-size: 0.68rem; color: #dc2626; font-weight: 700; margin-top: 2px;">⚠️ Conflict: Double-Booked</div>` : ''}
          ${isEscalatedStatus && !l.bookedSlot ? '<span style="font-size: 0.7rem; color: #b45309; display: block; font-weight: 600;">(Needs Callback)</span>' : ''}
        </td>
        <td>
          <select class="tech-select-dropdown ${isDoubleBooked ? 'tech-collision-dropdown' : ''}" onchange="handleAdminAssignTech('${l.leadId}', this.value)">
            <option value="">-- Unassigned --</option>
            ${(demoUsers.staff || []).map(s => `<option value="${escapeHtml(s.name)}" ${(l.assignedTech || '').includes(s.name) ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
          </select>
          ${isDoubleBooked ? `<div class="badge badge-danger-subtle" style="font-size: 0.68rem; margin-top: 3px; color: #dc2626; background: #fee2e2; border: 1px solid #fca5a5; display: inline-flex; align-items: center; gap: 3px;" title="Technician is scheduled for multiple active jobs at the exact same hour">⚠️ Schedule Collision</div>` : ''}
        </td>
        <td>
          <div style="font-size: 0.76rem; max-width: 220px; color: #475569;">
            ${(l.nextAction || '').toLowerCase().includes('contact') || (l.nextAction || '').toLowerCase().includes('incomplete') || isEscalatedStatus
              ? `<div style="color: #b45309; font-weight: 700; font-size: 0.72rem; background: #fffbeb; border: 1px solid #fef08a; padding: 2px 6px; border-radius: 4px; margin-bottom: 3px; display: inline-flex; align-items: center; gap: 3px;">📞 Contact Customer Again</div>`
              : ''
            }
            ${l.customerNotes ? `<div class="customer-note-alert" style="margin: 0 0 4px 0; font-size: 0.72rem;"><strong>Cust:</strong> ${escapeHtml(l.customerNotes)}</div>` : ''}
            <div>${escapeHtml(l.nextAction || l.technicianNotes || '—')}</div>
          </div>
        </td>
        <td>
          <div style="display: flex; gap: 4px;">
            <button class="btn btn-secondary btn-xs" onclick="openStatusLogModal('${l.leadId}')" title="View Audit Trail Timeline">
              📜 Audit
            </button>
            <button class="btn btn-danger btn-xs" onclick="handleAdminDeleteLead('${l.leadId}')" title="Delete record">
              🗑️
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

async function handleAdminStatusChange(leadId, newStatus) {
  try {
    const res = await authFetch(`/api/leads/${leadId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: newStatus, note: `Status manually updated to ${newStatus} by dispatcher` }),
    });
    if (res.ok) {
      showToast('Status Updated', `Lead ${leadId} transition recorded in status_log.`, 'success');
      await refreshAllData(true);
    }
  } catch (err) {
    showToast('Update Failed', err.message, 'error');
  }
}

async function handleAdminAssignTech(leadId, techName) {
  try {
    if (techName) {
      const currentLead = leadsCache.find(l => (l.leadId === leadId || l.id === leadId));
      if (currentLead && currentLead.bookedSlot) {
        const conflict = leadsCache.find(other => 
          (other.leadId !== leadId && other.id !== currentLead.id) &&
          other.status !== 'Closed' &&
          (other.assignedTech || '').trim().toLowerCase() === techName.trim().toLowerCase() &&
          (other.bookedSlot || '').trim() === (currentLead.bookedSlot || '').trim()
        );
        if (conflict) {
          const proceed = confirm(`⚠️ Warning: ${techName} is already booked for an active appointment at ${currentLead.bookedSlot} (${conflict.leadId || conflict.name} at ${conflict.location || 'Springfield'}).\n\nDo you want to double-book this technician anyway?`);
          if (!proceed) {
            renderLeadsTable();
            return;
          }
        }
      }
    }

    const res = await authFetch(`/api/leads/${leadId}/assign`, {
      method: 'POST',
      body: JSON.stringify({ techName }),
    });
    if (res.ok) {
      showToast('Technician Dispatched', `Lead ${leadId} assigned to ${techName || 'Unassigned'}.`, 'success');
      await refreshAllData(true);
    }
  } catch (err) {
    showToast('Assignment Failed', err.message, 'error');
  }
}

async function handleAdminDeleteLead(leadId) {
  if (!confirm(`Are you sure you want to delete lead ${leadId}?`)) return;
  try {
    const res = await authFetch(`/api/leads/${leadId}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('Lead Deleted', `Lead ${leadId} removed from CRM.`, 'info');
      await refreshAllData(true);
    }
  } catch (err) {
    showToast('Delete Failed', err.message, 'error');
  }
}

/* ==============================================================================
   SERVICES CATALOG MANAGEMENT
   ============================================================================== */
async function fetchServices(silent = false) {
  try {
    const res = await authFetch('/api/services?all=true');
    if (res.ok) {
      const data = await res.json();
      servicesCache = data.services || [];
      renderServicesTable();
      const countEl = document.getElementById('servicesCount');
      if (countEl) countEl.textContent = servicesCache.length;
    }
  } catch (err) {
    if (!silent) console.error('[Fetch Services Error]', err);
  }
}

function renderServicesTable() {
  const tbody = document.getElementById('servicesTableBody');
  if (!tbody) return;

  if (servicesCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state">No services in catalog. Add your first service above.</td></tr>`;
    return;
  }

  tbody.innerHTML = servicesCache.map((s) => `
    <tr>
      <td>
        <strong style="font-size: 0.9rem; color: #0f172a;">${escapeHtml(s.name)}</strong>
        <div style="font-family: var(--font-mono); font-size: 0.72rem; color: #94a3b8;">${escapeHtml(s.service_id)}</div>
      </td>
      <td>
        <div style="font-size: 0.82rem; color: #475569; max-width: 400px;">${escapeHtml(s.description)}</div>
      </td>
      <td>
        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
          <input type="checkbox" ${s.active ? 'checked' : ''} onchange="handleToggleServiceActive(${s.id}, this.checked)" style="width: 16px; height: 16px;" />
          <span class="badge ${s.active ? 'badge-success-subtle' : 'badge-subtle'}" style="font-size: 0.72rem;">
            ${s.active ? '● Active in Riley Voice AI' : '○ Deactivated'}
          </span>
        </label>
      </td>
      <td>
        <span style="font-size: 0.8rem; color: #64748b;">${escapeHtml(s.created_by || 'Admin')}</span>
      </td>
      <td>
        <button class="btn btn-danger btn-xs" onclick="handleDeleteService(${s.id})" title="Delete Service">
          🗑️
        </button>
      </td>
    </tr>
  `).join('');
}

async function handleToggleServiceActive(serviceId, active) {
  try {
    const res = await authFetch(`/api/services/${serviceId}`, {
      method: 'PATCH',
      body: JSON.stringify({ active: active ? 1 : 0 }),
    });
    if (res.ok) {
      showToast('Catalog Updated', `Service ${active ? 'activated' : 'deactivated'}. Riley Voice AI system prompt updated dynamically.`, 'success');
      await fetchServices(true);
    }
  } catch (err) {
    showToast('Update Error', err.message, 'error');
  }
}

async function handleDeleteService(serviceId) {
  if (!confirm('Are you sure you want to remove this service from the catalog?')) return;
  try {
    const res = await authFetch(`/api/services/${serviceId}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('Service Removed', 'Service deleted from catalog.', 'info');
      await fetchServices(true);
    }
  } catch (err) {
    showToast('Delete Error', err.message, 'error');
  }
}

async function submitAddService() {
  const name = document.getElementById('serviceInputName').value.trim();
  const description = document.getElementById('serviceInputDesc').value.trim();
  const active = document.getElementById('serviceInputActive').checked ? 1 : 0;

  if (!name || !description) {
    showToast('Required Fields', 'Please enter a name and description.', 'warning');
    return;
  }

  try {
    const res = await authFetch('/api/services', {
      method: 'POST',
      body: JSON.stringify({ name, description, active }),
    });
    if (res.ok) {
      showToast('Service Created', 'New service added to catalog and live in AI Voice agent.', 'success');
      document.getElementById('addServiceModalBackdrop').style.display = 'none';
      document.getElementById('addServiceForm').reset();
      await fetchServices();
    }
  } catch (err) {
    showToast('Creation Failed', err.message, 'error');
  }
}

/* ==============================================================================
   TEAM ROSTER MANAGEMENT
   ============================================================================== */
async function fetchUsers(silent = false) {
  try {
    const res = await authFetch('/api/users');
    if (res.ok) {
      const data = await res.json();
      teamCache = data.users || [];
      renderStaffRoster();
      const badge = document.getElementById('sidebarTeamBadge');
      if (badge) badge.textContent = teamCache.length;
      const teamCount = document.getElementById('teamCount');
      if (teamCount) teamCount.textContent = teamCache.length;
    }
  } catch (err) {
    if (!silent) console.error('[Fetch Users Error]', err);
  }
}

function filterTeamRole(role) {
  teamCurrentFilter = role;
  document.querySelectorAll('#teamRoleFilters .filter-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.teamFilter === role);
  });
  renderStaffRoster();
}

function handleTeamSearch(query) {
  teamSearchQuery = (query || '').toLowerCase().trim();
  renderStaffRoster();
}

function renderStaffRoster() {
  const grid = document.getElementById('staffRosterGrid');
  if (!grid) return;

  const techUsers = teamCache.filter(u => u.role === 'staff');
  const adminUsers = teamCache.filter(u => u.role === 'admin');
  const allStaffUsers = teamCache.filter(u => u.role === 'admin' || u.role === 'staff');
  const customerUsers = teamCache.filter(u => u.role === 'customer');

  // Update tab counts
  const tabTech = document.getElementById('tabTechCount');
  if (tabTech) tabTech.textContent = techUsers.length;

  const tabAdmin = document.getElementById('tabAdminCount');
  if (tabAdmin) tabAdmin.textContent = adminUsers.length;

  const tabAllStaff = document.getElementById('tabAllStaffCount');
  if (tabAllStaff) tabAllStaff.textContent = allStaffUsers.length;

  const tabCustomer = document.getElementById('tabCustomerCount');
  if (tabCustomer) tabCustomer.textContent = customerUsers.length;

  // Calculate Fleet Metrics for the 4 KPI HUD Cards
  const kpiTech = document.getElementById('kpiTeamTechCount');
  if (kpiTech) kpiTech.textContent = techUsers.length;

  const kpiAdmin = document.getElementById('kpiTeamAdminCount');
  if (kpiAdmin) kpiAdmin.textContent = adminUsers.length;

  // Check how many technicians have jobs In Progress or Booked
  const assignedTechNames = new Set(
    leadsCache
      .filter(l => l.status === 'In Progress' || l.status === 'Booked')
      .map(l => (l.assignedTech || l.AssignedTech || '').trim())
      .filter(Boolean)
  );

  const onJobCount = techUsers.filter(u => assignedTechNames.has(u.name)).length;
  const availableCount = Math.max(0, techUsers.filter(u => u.active).length - onJobCount);

  const kpiOnJob = document.getElementById('kpiTeamOnJobCount');
  if (kpiOnJob) kpiOnJob.textContent = onJobCount;

  const kpiOnJobSub = document.getElementById('kpiTeamOnJobSubtext');
  if (kpiOnJobSub) kpiOnJobSub.textContent = `${onJobCount} vans active on work orders`;

  const kpiAvailable = document.getElementById('kpiTeamAvailableCount');
  if (kpiAvailable) kpiAvailable.textContent = availableCount;

  // Apply tab filter
  let displayList = [];
  if (teamCurrentFilter === 'technicians') {
    displayList = techUsers;
  } else if (teamCurrentFilter === 'admins') {
    displayList = adminUsers;
  } else if (teamCurrentFilter === 'customers') {
    displayList = customerUsers;
  } else {
    displayList = allStaffUsers;
  }

  // Apply search query
  if (teamSearchQuery) {
    displayList = displayList.filter(u =>
      (u.name || '').toLowerCase().includes(teamSearchQuery) ||
      (u.email || '').toLowerCase().includes(teamSearchQuery) ||
      (u.phone || '').toLowerCase().includes(teamSearchQuery) ||
      (u.user_id || '').toLowerCase().includes(teamSearchQuery) ||
      (u.trade || '').toLowerCase().includes(teamSearchQuery)
    );
  }

  if (displayList.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1; padding: 2.5rem 1.5rem; text-align: center;">
        <div style="font-size: 2.2rem; margin-bottom: 0.5rem;">🔍</div>
        <strong style="font-size: 1rem; color: #0f172a;">No Team Members Found</strong>
        <p style="color: #64748b; font-size: 0.85rem; margin-top: 4px;">
          Try selecting another filter tab or clearing your search term.
        </p>
      </div>
    `;
    return;
  }

  // Predefined trades & vans mapping for realistic executive feel
  const tradeMap = {
    'Dave Miller': { trade: '🔧 Master Plumber (Emergency & Repiping)', van: 'Fleet Van #01 • Springfield West' },
    'Carlos Rivera': { trade: '🔥 Commercial Boiler & Heating Specialist', van: 'Fleet Van #02 • Central Metro' },
    'Alex Chen': { trade: '❄️ Senior HVAC & Heat Pump Technician', van: 'Fleet Van #03 • North County' },
    'Jordan Vance': { trade: '💧 Drain Cleaning & Hydro-Jetting', van: 'Fleet Van #04 • Eastside Fleet' },
    'Admin Dispatcher': { trade: '👑 Chief Operations & AI Dispatch Lead', van: 'Central HQ Operations Center' },
  };

  grid.innerHTML = displayList.map((u) => {
    const isTech = u.role === 'staff';
    const isAdmin = u.role === 'admin';
    const isCustomer = u.role === 'customer';

    const initials = (u.name || 'US').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    const avatarClass = isAdmin ? 'admin-avatar' : isCustomer ? 'customer-avatar' : 'tech-avatar';

    const meta = tradeMap[u.name] || {
      trade: isTech ? '🔧 Certified Field Technician' : isAdmin ? '👑 Dispatch Operations' : '👤 Verified Homeowner / Client',
      van: isTech ? 'Fleet Service Van' : isCustomer ? 'Customer Account' : 'Central Ops',
    };

    // Find active jobs assigned to this technician
    const activeJobs = leadsCache.filter(l => (l.assignedTech || l.AssignedTech) === u.name && l.status !== 'Completed' && l.status !== 'Closed');
    const hasJobInProgress = activeJobs.some(l => l.status === 'In Progress');

    // Check leave
    const hasLeavePending = leaveCache.some(l => (l.staff_name === u.name || l.staff_id === u.id) && l.status === 'Pending');
    const hasLeaveApproved = leaveCache.some(l => (l.staff_name === u.name || l.staff_id === u.id) && l.status === 'Approved');

    let availabilityBadge = '';
    if (!u.active) {
      availabilityBadge = '<span class="badge badge-subtle">○ Deactivated</span>';
    } else if (hasLeaveApproved) {
      availabilityBadge = '<span class="badge badge-warning-subtle">🏖️ On Approved Leave</span>';
    } else if (hasJobInProgress) {
      availabilityBadge = `<span class="badge badge-info-subtle">● On Job (${activeJobs[0].leadId})</span>`;
    } else if (activeJobs.length > 0) {
      availabilityBadge = `<span class="badge badge-success-subtle">● Scheduled (${activeJobs.length} Job${activeJobs.length > 1 ? 's' : ''})</span>`;
    } else if (isTech) {
      availabilityBadge = '<span class="badge badge-success-subtle">⚡ Ready for Dispatch</span>';
    } else {
      availabilityBadge = '<span class="badge badge-subtle">● Active</span>';
    }

    return `
      <div class="staff-card-v2">
        <div class="staff-card-header-row">
          <div class="staff-identity-group">
            <div class="staff-avatar-badge ${avatarClass}">${initials}</div>
            <div class="staff-identity-text">
              <div class="staff-name-title">${escapeHtml(u.name)}</div>
              <div class="staff-id-pill">${escapeHtml(u.user_id || `USR-${u.id}`)}</div>
            </div>
          </div>
          ${availabilityBadge}
        </div>

        <div class="staff-trade-pill">
          ${escapeHtml(meta.trade)}
        </div>

        <div class="staff-meta-grid">
          <div class="staff-meta-item">
            <span>📞</span> <a href="tel:${escapeHtml(u.phone)}">${escapeHtml(u.phone || 'No phone')}</a>
          </div>
          <div class="staff-meta-item">
            <span>✉️</span> <a href="mailto:${escapeHtml(u.email)}">${escapeHtml(u.email || 'No email')}</a>
          </div>
          <div class="staff-meta-item" style="grid-column: 1 / -1; color: #64748b; font-size: 0.75rem;">
            <span>🚐</span> ${escapeHtml(meta.van)}
          </div>
        </div>

        ${isTech ? `
          <div class="staff-workload-box ${activeJobs.length > 0 ? 'staff-workload-active' : 'staff-workload-idle'}">
            <div style="display: flex; align-items: center; gap: 6px;">
              <span>${activeJobs.length > 0 ? '🛠️' : '📋'}</span>
              <span>${activeJobs.length > 0 ? `Active: <strong>${escapeHtml(activeJobs[0].leadId)}</strong> (${escapeHtml(activeJobs[0].name)})` : 'No active jobs queued • Available'}</span>
            </div>
            ${hasLeavePending ? `<span class="badge badge-warning-subtle" style="font-size: 0.65rem;">Leave Pending</span>` : ''}
          </div>
        ` : ''}

        <div class="staff-card-actions">
          <span class="badge badge-subtle" style="font-size: 0.7rem; text-transform: uppercase;">
            ${escapeHtml(u.role)}
          </span>
          <div style="display: flex; gap: 0.45rem;">
            <button class="btn btn-secondary btn-xs" onclick="handleToggleUserActive(${u.id}, ${u.active ? 0 : 1})">
              ${u.active ? 'Deactivate' : 'Activate'}
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

async function handleToggleUserActive(userId, newActive) {
  try {
    const res = await authFetch(`/api/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ active: newActive }),
    });
    if (res.ok) {
      showToast('User Updated', `Team member ${newActive ? 'activated' : 'deactivated'}.`, 'success');
      await fetchUsers(true);
    }
  } catch (err) {
    showToast('Update Failed', err.message, 'error');
  }
}

async function submitAddTeamMember() {
  const name = document.getElementById('techInputName').value.trim();
  const role = document.getElementById('userInputRole').value;
  const email = document.getElementById('techInputEmail').value.trim();
  const phone = document.getElementById('techInputPhone').value.trim();
  const trade = document.getElementById('techInputTrade')?.value;
  const van = document.getElementById('techInputVan')?.value.trim();

  if (!name || !email) {
    showToast('Required Fields', 'Name and email are required.', 'warning');
    return;
  }

  try {
    const res = await authFetch('/api/users', {
      method: 'POST',
      body: JSON.stringify({ name, role, email, phone, trade, van }),
    });
    if (res.ok) {
      showToast('Member Added', `${name} onboarded as ${role}.`, 'success');
      document.getElementById('addTechModalBackdrop').style.display = 'none';
      document.getElementById('addTechForm').reset();
      await fetchUsers();
      await initAuthAndRoleSwitcher();
    }
  } catch (err) {
    showToast('Add Member Failed', err.message, 'error');
  }
}

/* ==============================================================================
   STAFF LEAVE MANAGEMENT (ADMIN & STAFF)
   ============================================================================== */
async function fetchLeaveRequests(silent = false) {
  try {
    const res = await authFetch('/api/leave');
    if (res.ok) {
      const data = await res.json();
      leaveCache = data.requests || [];

      const leaveBadge = document.getElementById('sidebarLeaveBadge');
      if (leaveBadge) leaveBadge.textContent = leaveCache.filter(l => l.status === 'Pending').length;

      const countEl = document.getElementById('leaveRequestsCount');
      if (countEl) countEl.textContent = leaveCache.length;

      if (currentRole === 'admin') {
        renderAdminLeaveTable();
      } else if (currentRole === 'staff') {
        renderStaffMyLeaveTable();
      }
    }
  } catch (err) {
    if (!silent) console.error('[Fetch Leave Error]', err);
  }
}

function renderAdminLeaveTable() {
  const tbody = document.getElementById('adminLeaveTableBody');
  if (!tbody) return;

  if (leaveCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">No leave requests submitted.</td></tr>`;
    return;
  }

  tbody.innerHTML = leaveCache.map((req) => {
    const statusBadge = req.status === 'Approved' ? 'badge-success-subtle' : req.status === 'Rejected' ? 'badge-danger-subtle' : 'badge-warning-subtle';
    const isPending = req.status === 'Pending';

    return `
      <tr>
        <td><strong style="font-family: var(--font-mono); font-size: 0.78rem;">${escapeHtml(req.request_id)}</strong></td>
        <td><strong>${escapeHtml(req.staff_name)}</strong></td>
        <td><span style="font-weight: 600;">${escapeHtml(req.start_date)}</span> to <span style="font-weight: 600;">${escapeHtml(req.end_date)}</span></td>
        <td><div style="font-size: 0.8rem; color: #475569; max-width: 250px;">${escapeHtml(req.reason)}</div></td>
        <td><span class="badge ${statusBadge}">${escapeHtml(req.status)}</span></td>
        <td><span style="font-size: 0.75rem; color: #64748b;">${formatDate(req.requested_at)}</span></td>
        <td>
          ${isPending ? `
            <div style="display: flex; gap: 4px;">
              <button class="btn btn-primary btn-xs" onclick="handleAdminReviewLeave(${req.id}, 'Approved')">Approve</button>
              <button class="btn btn-danger btn-xs" onclick="handleAdminReviewLeave(${req.id}, 'Rejected')">Reject</button>
            </div>
          ` : `<span style="font-size: 0.75rem; color: #64748b;">Reviewed by ${escapeHtml(req.reviewed_by || 'Admin')}</span>`}
        </td>
      </tr>
    `;
  }).join('');
}

async function handleAdminReviewLeave(id, decision) {
  const adminNotes = prompt(`Add administrative note for ${decision} leave request (optional):`, `Reviewed and marked ${decision}.`);
  try {
    const res = await authFetch(`/api/leave/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: decision, adminNotes }),
    });
    if (res.ok) {
      showToast('Leave Reviewed', `Leave request marked ${decision} and recorded in status_log.`, 'success');
      await fetchLeaveRequests();
    }
  } catch (err) {
    showToast('Review Failed', err.message, 'error');
  }
}

/* ==============================================================================
   CUSTOMER PORTAL CONTROLLER & RENDERING
   ============================================================================== */
async function fetchCustomerPortal(silent = false) {
  try {
    const res = await authFetch('/api/leads');
    if (!res.ok) return;

    const data = await res.json();
    const customerLeads = data.leads || [];
    leadsCache = customerLeads;
    renderCustomerPortal(customerLeads);
  } catch (err) {
    if (!silent) console.error('[Customer Portal Error]', err);
  }
}

function renderCustomerPortal(leads) {
  const greetingEl = document.getElementById('customerGreetingName');
  if (greetingEl && currentUser) greetingEl.textContent = currentUser.name;

  const leadList = leads && leads.length > 0 ? leads : leadsCache;

  // Filter leads owned by this customer
  const myLeads = (leadList || []).filter((l) => {
    if ((l.customerId || l.customer_id) && currentUser.id && (l.customerId === currentUser.id || l.customer_id === currentUser.id)) return true;
    const lEmail = (l.email || l.Email || '').toLowerCase();
    if (currentUser.email && lEmail && lEmail === currentUser.email.toLowerCase()) return true;
    const lParamPhone = (l.phone || l.Phone || '').replace(/[^\d+]/g, '');
    const userPhone = (currentUser.phone || '').replace(/[^\d+]/g, '');
    if (userPhone && lParamPhone && lParamPhone === userPhone) return true;
    return false;
  });

  const lead = myLeads.length > 0 ? myLeads[0] : (leadList && leadList[0] ? leadList[0] : null);

  renderCustomerOrderView(lead);
  renderCustomerMessageView(lead);
}

function renderCustomerOrderView(lead) {
  const container = document.getElementById('customerOrderContainer');
  if (!container) return;

  if (!lead) {
    container.innerHTML = `
      <div class="card" style="text-align: center; padding: 3rem 1.5rem;">
        <div style="font-size: 2.5rem; margin-bottom: 0.75rem;">📋</div>
        <h3 style="font-size: 1.25rem; font-weight: 800; margin-bottom: 0.5rem; color: #0f172a;">No Active Service Requests</h3>
        <p style="color: #64748b; font-size: 0.9rem; max-width: 480px; margin: 0 auto 1.5rem auto;">
          We could not find an active appointment for <strong>${escapeHtml(currentUser.email)}</strong>. If you recently booked, please check back shortly or call our 24/7 dispatch hotline.
        </p>
      </div>
    `;
    return;
  }

  const techFirstName = lead.assignedTech || lead.AssignedTech || 'Dave Miller (Master Tech)';
  const steps = [
    { key: 'New', label: '1. Request Received' },
    { key: 'Qualified', label: '2. AI Qualified' },
    { key: 'Booked', label: '3. Appointment Confirmed' },
    { key: 'In Progress', label: '4. Technician Dispatched' },
    { key: 'Completed', label: '5. Work Completed' },
  ];

  let currentStepIdx = 2;
  if (lead.status === 'New Lead' || lead.status === 'New') currentStepIdx = 0;
  else if (lead.status === 'Qualified') currentStepIdx = 1;
  else if (lead.status === 'Booked') currentStepIdx = 2;
  else if (lead.status === 'In Progress') currentStepIdx = 3;
  else if (lead.status === 'Completed' || lead.status === 'Closed') currentStepIdx = 4;

  container.innerHTML = `
    <div class="customer-order-hero">
      <div class="customer-order-header">
        <div class="order-ref-group">
          <span class="order-ref-id">Reference: ${escapeHtml(lead.leadId)}</span>
          <h2 class="order-job-title">${escapeHtml(lead.jobType || lead.job_type || 'Plumbing Service')}</h2>
        </div>
        <div style="display: flex; align-items: center; gap: 0.75rem;">
          <span class="badge ${lead.status === 'Completed' ? 'badge-success-subtle' : 'badge-info-subtle'}" style="font-size: 0.85rem; padding: 0.4rem 0.85rem;">
            ● ${escapeHtml(lead.status)}
          </span>
          <button class="btn btn-secondary btn-sm" onclick="switchView('customer-message')">
            💬 Message Technician
          </button>
        </div>
      </div>

      <div class="stepper-timeline">
        ${steps.map((s, idx) => {
          const isDone = idx < currentStepIdx;
          const isActive = idx === currentStepIdx;
          const stepClass = isDone ? 'completed' : isActive ? 'active' : '';
          return `
            <div class="stepper-step ${stepClass}">
              <div class="stepper-bubble">${isDone ? '✓' : idx + 1}</div>
              <span class="stepper-label">${s.label}</span>
            </div>
          `;
        }).join('')}
      </div>

      <div class="customer-details-grid">
        <div class="detail-item">
          <span class="detail-label">📅 Scheduled Window</span>
          <span class="detail-value">${escapeHtml(lead.bookedSlot ? formatSlot(lead.bookedSlot) : 'Pending Confirmation')}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">📍 Service Address</span>
          <span class="detail-value">${escapeHtml(lead.location || 'Customer Residence')}</span>
        </div>
        <div class="detail-item" style="border-left: 3px solid #0284c7; padding-left: 0.85rem;">
          <span class="detail-label">👷 Assigned Master Technician</span>
          <span class="detail-value" style="color: #0284c7; font-weight: 800;">${escapeHtml(techFirstName)}</span>
          <span style="font-size: 0.72rem; color: #64748b;">Springfield Fleet Van #2 • On Duty</span>
          <div style="margin-top: 0.45rem;">
            <button class="btn btn-primary btn-xs" onclick="switchView('customer-message')">
              💬 Text ${escapeHtml(techFirstName)} Directly
            </button>
          </div>
        </div>
      </div>

      <!-- Status History & Audit Log -->
      <div class="card" style="margin-top: 1.5rem; box-shadow: none; border-color: #e2e8f0;">
        <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
          <h3 class="card-title" style="font-size: 1rem; margin: 0;">📜 Dispatch Timeline & Audit Trail</h3>
          <span class="badge badge-subtle">Real-Time Sync</span>
        </div>
        <div id="customerLeadTimeline" class="timeline-container">
          <div style="color: #94a3b8; font-size: 0.8rem;">Loading timeline...</div>
        </div>
      </div>
    </div>
  `;

  fetchLeadTimeline(lead.leadId, 'customerLeadTimeline');
}

function renderCustomerMessageView(lead) {
  const container = document.getElementById('customerMessageContainer');
  if (!container) return;

  if (!lead) {
    container.innerHTML = `
      <div class="card" style="text-align: center; padding: 3rem 1.5rem;">
        <div style="font-size: 2.5rem; margin-bottom: 0.75rem;">💬</div>
        <h3 style="font-size: 1.25rem; font-weight: 800; margin-bottom: 0.5rem; color: #0f172a;">No Active Service Order</h3>
        <p style="color: #64748b; font-size: 0.9rem; max-width: 480px; margin: 0 auto 1.5rem auto;">
          Messaging is connected to active service orders. When a technician is allocated to your service request, you will be able to message them directly here.
        </p>
      </div>
    `;
    return;
  }

  const techFirstName = lead.assignedTech || lead.AssignedTech || 'Carlos Rivera';
  const customerNotes = lead.customerNotes || '';
  const isAwaiting = lead.status === 'Awaiting Customer';
  const parsedNotes = customerNotes.split('\n').filter(n => n.trim().length > 0);

  container.innerHTML = `
    <!-- Prominent Allocated Technician Profile Card -->
    <div class="allocated-technician-hero-card">
      <div class="allocated-tech-header">
        <div class="allocated-tech-avatar-wrap">
          <div class="allocated-tech-avatar">👷</div>
          <span class="allocated-tech-online-dot"></span>
        </div>
        <div class="allocated-tech-info">
          <div class="allocated-tech-title-row">
            <h2 class="allocated-tech-name">${escapeHtml(techFirstName)}</h2>
            <span class="badge badge-accent">Certified Master Technician</span>
            <span class="allocated-status-badge ${isAwaiting ? 'status-hold' : 'status-active'}">
              ${isAwaiting ? '🛑 Standby / On Hold' : '● Van Dispatched & Active'}
            </span>
          </div>
          <div class="allocated-tech-meta-row">
            <span>🚐 <strong>Springfield Fleet Van #2</strong></span>
            <span>•</span>
            <span>📍 Active Job: <strong>${escapeHtml(lead.leadId)}</strong> (${escapeHtml(lead.jobType || lead.job_type || 'Service Order')})</span>
            <span>•</span>
            <span>⏱️ Arrival Window: <strong>${escapeHtml(lead.bookedSlot ? formatSlot(lead.bookedSlot) : 'Within 45–60 Mins')}</strong></span>
          </div>
        </div>
        <div class="allocated-tech-actions">
          <a href="tel:+15550192834" class="btn btn-secondary btn-sm" title="Call Emergency Dispatch Hotline">
            📞 Call Office
          </a>
        </div>
      </div>
    </div>

    ${isAwaiting ? `
      <div class="customer-standby-banner">
        <div class="standby-text-wrap">
          <span class="standby-icon">🛑</span>
          <div>
            <span class="standby-title">VAN DISPATCH ON STANDBY (TECHNICIAN PAUSED)</span>
            <span class="standby-desc">Technician ${escapeHtml(techFirstName)} has been instructed to hold dispatch until reviewing your latest update.</span>
          </div>
        </div>
        <button class="btn-release-hold" onclick="handleReleaseHold('${lead.leadId}')">
          ▶ Release Hold & Resume Dispatch
        </button>
      </div>
    ` : ''}

    <div class="customer-chat-grid">
      <!-- Left Column: Direct Chat / SMS Thread -->
      <div class="chat-thread-card">
        <div class="chat-tech-banner">
          <div style="font-weight: 700; font-size: 0.92rem; color: #0f172a; display: flex; align-items: center; gap: 0.5rem;">
            <span>💬 Direct Message Thread with ${escapeHtml(techFirstName)}</span>
          </div>
          <span class="badge badge-success-subtle">SMS Channel Live</span>
        </div>

        <div class="chat-messages-stream" id="customerChatStream">
          <div class="chat-bubble tech">
            <div class="chat-sender-lbl">
              <span>👷 ${escapeHtml(techFirstName)} (Field Dispatch)</span>
              <span class="chat-time-lbl">Today</span>
            </div>
            <div>Hello ${escapeHtml(currentUser.name || 'there')}! I have your service order for <strong>${escapeHtml(lead.jobType || lead.job_type || 'Plumbing Service')}</strong> loaded. En route to ${escapeHtml(lead.location || 'your address')}. Please let me know if you have gate codes, parking instructions, or need me to hold up.</div>
          </div>

          ${parsedNotes.map(n => `
            <div class="chat-bubble customer">
              <div class="chat-sender-lbl">
                <span>👤 You ${n.includes('(HOLD REQUESTED)') ? '<span style="color:#ef4444;">[🛑 HOLD APPLIED]</span>' : ''}</span>
                <span class="chat-time-lbl">Sent</span>
              </div>
              <div>${escapeHtml(n)}</div>
            </div>
          `).join('')}
        </div>

        <div class="chat-input-container">
          <div class="chat-quick-chips">
            <span style="font-size: 0.72rem; color: #64748b; font-weight: 600;">Quick Instructions:</span>
            <button type="button" class="chat-chip-btn" onclick="insertChatQuickText('Please hold up arrival by 20 minutes, running late.')">🛑 Hold Arrival (20m)</button>
            <button type="button" class="chat-chip-btn" onclick="insertChatQuickText('Gate code is #4920. Side door unlocked.')">🔑 Gate Code</button>
            <button type="button" class="chat-chip-btn" onclick="insertChatQuickText('Dog in backyard, please pause before entering.')">🐕 Pet Warning</button>
            <button type="button" class="chat-chip-btn" onclick="insertChatQuickText('Please park in the main driveway.')">🚗 Parking Note</button>
          </div>

          <label class="chat-hold-toggle-row">
            <input type="checkbox" id="customerHoldCheckbox" checked />
            <span>🛑 Put Technician on Standby / Hold (Technician must pause until reading this instruction)</span>
          </label>

          <form onsubmit="event.preventDefault(); submitCustomerDirectMessage('${lead.leadId}');" class="chat-form-row">
            <textarea id="customerChatInput" class="chat-input-textarea" rows="2" placeholder="Type instructions or message for your technician..."></textarea>
            <button type="submit" id="btnSendCustomerChat" class="btn-send-chat">
              <span>Send SMS & Hold</span>
            </button>
          </form>
        </div>
      </div>

      <!-- Right Column: Reschedule Appointment Card -->
      <div class="reschedule-side-card">
        <h3 class="reschedule-card-title">📅 Reschedule Appointment</h3>
        <p class="reschedule-card-desc">Need to change your service window? Submitting a reschedule immediately pauses technician dispatch.</p>

        <form onsubmit="event.preventDefault(); submitCustomerRescheduleRequest('${lead.leadId}');">
          <div style="margin-bottom: 1rem;">
            <label class="form-label" style="font-size: 0.78rem; font-weight: 700; color: #334155; margin-bottom: 0.35rem; display: block;">
              Preferred New Date / Time Slot *
            </label>
            <input type="text" id="custRescheduleSlot" class="form-input" style="width: 100%; font-size: 0.85rem;" placeholder="e.g. Tomorrow 2:00 PM - 4:00 PM" required />
          </div>

          <div style="margin-bottom: 1.25rem;">
            <label class="form-label" style="font-size: 0.78rem; font-weight: 700; color: #334155; margin-bottom: 0.35rem; display: block;">
              Reason / Additional Notes (Optional)
            </label>
            <textarea id="custRescheduleMessage" class="form-input" style="width: 100%; font-size: 0.85rem;" rows="2" placeholder="e.g. Work meeting ran late, need afternoon window..."></textarea>
          </div>

          <button type="submit" class="btn btn-primary" style="width: 100%;">
            <span>Submit Reschedule (Hold Van)</span>
          </button>
        </form>

        <div style="margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid var(--border-subtle); font-size: 0.75rem; color: #64748b;">
          <strong>Emergency Changes:</strong> If this is an urgent leak or active flooding, call the 24/7 priority line directly at <strong>(555) 019-2834</strong>.
        </div>
      </div>
    </div>
  `;
}

window.insertChatQuickText = function(text) {
  const input = document.getElementById('customerChatInput');
  if (input) {
    input.value = text;
    input.focus();
  }
};

window.submitCustomerDirectMessage = async function(leadId) {
  const input = document.getElementById('customerChatInput');
  const holdBox = document.getElementById('customerHoldCheckbox');
  const message = input ? input.value.trim() : '';
  const holdVan = holdBox ? holdBox.checked : true;

  if (!message) {
    showToast('Empty Message', 'Please enter a message or instruction for the technician.', 'warning');
    return;
  }

  const btn = document.getElementById('btnSendCustomerChat');
  if (btn) btn.disabled = true;

  try {
    const res = await authFetch(`/api/leads/${leadId}/message`, {
      method: 'POST',
      body: JSON.stringify({ message, holdVan }),
    });

    if (res.ok) {
      showToast(
        holdVan ? '🛑 Technician Placed on Hold' : 'Message Sent', 
        holdVan 
          ? 'Your instructions were sent via SMS. Technician is holding on standby.' 
          : 'Your message has been dispatched to your technician via SMS.', 
        'warning'
      );
      if (input) input.value = '';
      await fetchCustomerPortal();
    } else {
      const data = await res.json();
      throw new Error(data.error || 'Failed to send message');
    }
  } catch (err) {
    showToast('Failed to Send', err.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
};

window.handleReleaseHold = async function(leadId) {
  try {
    const res = await authFetch(`/api/leads/${leadId}/release-hold`, {
      method: 'POST',
    });
    if (res.ok) {
      showToast('Dispatch Resumed', 'Technician standby hold has been released. Dispatch is active.', 'success');
      if (currentRole === 'staff') {
        await fetchStaffPortalData();
      } else {
        await fetchCustomerPortal();
      }
    } else {
      const data = await res.json();
      throw new Error(data.error || 'Failed to release hold');
    }
  } catch (err) {
    showToast('Error', err.message, 'error');
  }
};

window.handleCustomerLookup2 = function() {
  const input = document.getElementById('customerLookupInput2');
  if (input) {
    const val = input.value.trim();
    const input1 = document.getElementById('customerLookupInput');
    if (input1) input1.value = val;
    handleCustomerLookup();
  }
};

async function submitCustomerRescheduleRequest(leadId) {
  const requestedSlot = document.getElementById('custRescheduleSlot')?.value.trim();
  const message = document.getElementById('custRescheduleMessage')?.value.trim();

  if (!message && !requestedSlot) {
    showToast('Input Required', 'Please enter a message or preferred time slot.', 'warning');
    return;
  }

  try {
    const res = await authFetch(`/api/leads/${leadId}/message`, {
      method: 'POST',
      body: JSON.stringify({ message, requestedSlot }),
    });
    if (res.ok) {
      showToast('Request Submitted', 'Your technician has been alerted with your message.', 'success');
      document.getElementById('custRescheduleMessage').value = '';
      document.getElementById('custRescheduleSlot').value = '';
      await fetchCustomerPortal();
    }
  } catch (err) {
    showToast('Submission Error', err.message, 'error');
  }
}

function handleCustomerLookup() {
  const input = document.getElementById('customerLookupInput');
  const val = input ? input.value.trim() : '';
  if (!val) {
    showToast('Lookup Input', 'Enter a customer phone or email.', 'warning');
    return;
  }

  const match = (demoUsers.customers || []).find(
    (c) => c.email.toLowerCase() === val.toLowerCase() || (c.phone || '').includes(val)
  );

  if (match) {
    switchRole('customer', match);
    showToast('Found Account', `Loaded service records for ${match.name}.`, 'success');
  } else {
    currentUser = { id: 999, name: 'Verified Customer', email: val, phone: val, role: 'customer' };
    updateRoleUI();
    fetchCustomerPortal();
    showToast('Searching Records', `Looking up orders for ${val}...`, 'info');
  }
}

/* ==============================================================================
   STAFF PORTAL CONTROLLER & RENDERING (DEDICATED VIEWS)
   ============================================================================== */
async function fetchStaffPortal(silent = false) {
  try {
    const res = await authFetch('/api/leads');
    if (!res.ok) return;

    const data = await res.json();
    staffOrdersCache = data.leads || [];
    renderStaffOrders();

    const jobsBadge = document.getElementById('sidebarStaffJobsBadge');
    if (jobsBadge) jobsBadge.textContent = staffOrdersCache.length;
  } catch (err) {
    if (!silent) console.error('[Staff Portal Error]', err);
  }
}

function filterStaffOrders(filter) {
  staffCurrentFilter = filter;
  document.querySelectorAll('#staffFilters .filter-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.staffFilter === filter);
  });
  renderStaffOrders();
}

function handleStaffSearch(query) {
  staffSearchQuery = (query || '').toLowerCase().trim();
  renderStaffOrders();
}

function renderStaffOrders(leads = staffOrdersCache) {
  const container = document.getElementById('staffOrdersList');
  if (!container) return;

  // KPI counter cards
  const totalCount = staffOrdersCache.length;
  const inProgCount = staffOrdersCache.filter(l => l.status === 'In Progress').length;
  const compCount = staffOrdersCache.filter(l => l.status === 'Completed').length;

  const countBadge = document.getElementById('staffWorkOrdersCount');
  if (countBadge) countBadge.textContent = totalCount;

  const jobsCount = document.getElementById('staffJobsCount');
  if (jobsCount) jobsCount.textContent = totalCount;

  const inProgressCount = document.getElementById('staffInProgressCount');
  if (inProgressCount) inProgressCount.textContent = inProgCount;

  const completedCount = document.getElementById('staffCompletedCount');
  if (completedCount) completedCount.textContent = compCount;

  // Filter and Search logic
  let filtered = [...staffOrdersCache];
  if (staffCurrentFilter !== 'all') {
    filtered = filtered.filter(l => l.status === staffCurrentFilter);
  }
  if (staffSearchQuery) {
    filtered = filtered.filter(l =>
      (l.name || '').toLowerCase().includes(staffSearchQuery) ||
      (l.leadId || '').toLowerCase().includes(staffSearchQuery) ||
      (l.location || '').toLowerCase().includes(staffSearchQuery) ||
      (l.phone || '').toLowerCase().includes(staffSearchQuery) ||
      (l.description || '').toLowerCase().includes(staffSearchQuery) ||
      (l.jobType || l.job_type || '').toLowerCase().includes(staffSearchQuery)
    );
  }

  if (filtered.length === 0) {
    const isFiltered = staffCurrentFilter !== 'all' || staffSearchQuery;
    container.innerHTML = `
      <div class="empty-state" style="padding: 2.5rem 1.5rem; text-align: center;">
        <div style="font-size: 2.2rem; margin-bottom: 0.5rem;">${isFiltered ? '🔍' : '🎉'}</div>
        <strong style="font-size: 1rem; color: #0f172a;">${isFiltered ? 'No Matching Jobs Found' : 'No Active Jobs Dispatched'}</strong>
        <p style="color: #64748b; font-size: 0.85rem; margin-top: 4px;">
          ${isFiltered ? 'Try clearing your search query or switching filter tabs.' : 'You have no work orders in your dispatch queue right now.'}
        </p>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map((l) => {
    const isInProgress = l.status === 'In Progress';
    const isCompleted = l.status === 'Completed';

    return `
      <div class="staff-order-card">
        <div class="staff-order-top">
          <div>
            <div style="font-size: 0.75rem; font-family: var(--font-mono); color: #64748b;">${escapeHtml(l.leadId)}</div>
            <div style="font-weight: 800; font-size: 1.15rem; color: #0f172a; margin-top: 2px;">${escapeHtml(l.name)}</div>
            <div style="font-size: 0.85rem; font-weight: 600; color: #0284c7; margin-top: 1px;">${escapeHtml(l.jobType || l.job_type)}</div>
          </div>
          <span class="badge ${isCompleted ? 'badge-success-subtle' : isInProgress ? 'badge-warning-subtle' : 'badge-subtle'}" style="font-size: 0.78rem;">
            ${escapeHtml(l.status)}
          </span>
        </div>

        <div style="font-size: 0.82rem; color: #334155; display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 0.65rem; background: #f8fafc; padding: 0.75rem 1rem; border-radius: 8px; border: 1px solid #e2e8f0;">
          <div>📍 <strong>Address:</strong> ${escapeHtml(l.location || 'Local Customer Address')}</div>
          <div>📞 <strong>Phone:</strong> <a href="tel:${escapeHtml(l.phone)}" style="color: #0284c7; text-decoration: underline;">${escapeHtml(l.phone || 'No phone provided')}</a></div>
          <div>📅 <strong>Window:</strong> ${escapeHtml(l.bookedSlot ? formatSlot(l.bookedSlot) : 'Unscheduled / ASAP')}</div>
          <div>🚨 <strong>Urgency:</strong> <span class="badge ${l.urgency === 'Emergency' ? 'badge-danger-subtle' : 'badge-subtle'}">${escapeHtml(l.urgency || 'Medium')}</span></div>
        </div>

        ${l.description ? `
          <div style="font-size: 0.82rem; color: #334155; padding: 0.6rem 0.85rem; background: #ffffff; border-radius: 6px; border: 1px solid #e2e8f0;">
            <strong>Job Scope / Issue Reported:</strong> ${escapeHtml(l.description)}
          </div>
        ` : ''}

        ${l.customerNotes ? `
          <div class="customer-note-alert">
            <strong>⚠️ Customer Message / Gate Code / Reschedule Note:</strong>
            <div style="margin-top: 2px;">${escapeHtml(l.customerNotes)}</div>
          </div>
        ` : ''}

        ${l.status === 'Awaiting Customer' ? `
          <div class="staff-hold-alert-box">
            <div class="hold-icon">🛑</div>
            <div class="hold-details">
              <strong class="hold-title">VAN DISPATCH PAUSED BY CUSTOMER (ON STANDBY)</strong>
              <p class="hold-msg">"${escapeHtml(l.customerNotes ? l.customerNotes.split('\n').pop() : 'Customer requested hold')}"</p>
              <span class="hold-sub">Do not enter property or start repairs until acknowledging customer note.</span>
            </div>
            <button class="btn-acknowledge-hold" onclick="handleReleaseHold('${l.leadId}')">
              ✅ Acknowledge & Resume Dispatch
            </button>
          </div>
        ` : ''}

        <div class="staff-order-actions">
          ${!isInProgress && !isCompleted && l.status !== 'Awaiting Customer' ? `
            <button class="btn btn-primary btn-sm" onclick="handleStaffUpdateStatus('${l.leadId}', 'In Progress')">
              ▶ Start Job (In Progress)
            </button>
          ` : ''}

          ${isInProgress ? `
            <button class="btn btn-primary btn-sm" style="background: #059669; border-color: #059669;" onclick="handleStaffUpdateStatus('${l.leadId}', 'Completed')">
              ✔ Complete Job & Close Work Order
            </button>
          ` : ''}

          <button class="btn btn-secondary btn-sm" onclick="openStatusLogModal('${l.leadId}')">
            📜 View Timeline & Audit Trail
          </button>
        </div>
      </div>
    `;
  }).join('');
}

async function handleStaffUpdateStatus(leadId, newStatus) {
  const note = prompt(`Add technician field note for transitioning job to "${newStatus}" (optional):`, `Technician ${currentUser.name} marked work order ${newStatus}.`);
  try {
    const res = await authFetch(`/api/leads/${leadId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: newStatus, note: note || `Marked ${newStatus} by field technician` }),
    });
    if (res.ok) {
      showToast('Work Order Updated', `Status changed to ${newStatus}. Customer notification fired.`, 'success');
      await refreshAllData();
    }
  } catch (err) {
    showToast('Update Failed', err.message, 'error');
  }
}

function renderStaffMyLeaveTable() {
  const tbody = document.getElementById('staffMyLeaveTableBody');
  if (!tbody) return;

  // Calculate summary stats
  const pendingCount = leaveCache.filter(l => l.status === 'Pending').length;
  const approvedCount = leaveCache.filter(l => l.status === 'Approved').length;

  let totalDays = 0;
  leaveCache.forEach((req) => {
    if (req.status === 'Approved' || req.status === 'Pending') {
      try {
        const start = new Date(req.start_date);
        const end = new Date(req.end_date);
        const diffDays = Math.max(1, Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1);
        totalDays += diffDays;
      } catch (e) {
        totalDays += 1;
      }
    }
  });

  const pendingEl = document.getElementById('staffPendingLeaveCount');
  if (pendingEl) pendingEl.textContent = pendingCount;

  const approvedEl = document.getElementById('staffApprovedLeaveCount');
  if (approvedEl) approvedEl.textContent = approvedCount;

  const totalDaysEl = document.getElementById('staffTotalLeaveDays');
  if (totalDaysEl) totalDaysEl.textContent = `${totalDays}d`;

  const histCountEl = document.getElementById('staffLeaveHistoryCount');
  if (histCountEl) histCountEl.textContent = `${leaveCache.length} requests`;

  const staffLeaveBadge = document.getElementById('sidebarStaffLeaveBadge');
  if (staffLeaveBadge) staffLeaveBadge.textContent = pendingCount;

  if (leaveCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state">No time off requests filed yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = leaveCache.map((req) => {
    const badgeClass = req.status === 'Approved' ? 'badge-success-subtle' : req.status === 'Rejected' ? 'badge-danger-subtle' : 'badge-warning-subtle';
    const hasReview = req.reviewed_by || req.admin_notes;

    return `
      <tr>
        <td>
          <div style="font-weight: 700; color: #0f172a;">${escapeHtml(req.start_date)}</div>
          <div style="font-size: 0.75rem; color: #64748b;">to ${escapeHtml(req.end_date)}</div>
        </td>
        <td>
          <div style="font-size: 0.82rem; font-weight: 500; color: #1e293b; max-width: 240px;">${escapeHtml(req.reason)}</div>
        </td>
        <td><span class="badge ${badgeClass}">${escapeHtml(req.status)}</span></td>
        <td>
          <div style="font-size: 0.78rem; color: ${hasReview ? '#334155' : '#94a3b8'};">
            ${hasReview ? `<strong>${escapeHtml(req.reviewed_by || 'Admin')}:</strong> ${escapeHtml(req.admin_notes || 'Approved')}` : '<em>Pending dispatcher review</em>'}
          </div>
        </td>
        <td><span style="font-size: 0.75rem; color: #64748b;">${formatDate(req.requested_at)}</span></td>
      </tr>
    `;
  }).join('');
}

async function submitStaffLeaveRequest() {
  const startDate = document.getElementById('staffLeaveStart')?.value;
  const endDate = document.getElementById('staffLeaveEnd')?.value;
  const leaveType = document.getElementById('staffLeaveType')?.value || 'Vacation / PTO';
  const rawReason = document.getElementById('staffLeaveReason')?.value.trim();

  if (!startDate || !endDate || !rawReason) {
    showToast('Required Fields', 'Please select start date, end date, and provide reason details.', 'warning');
    return;
  }

  const reason = `[${leaveType}] ${rawReason}`;

  try {
    const res = await authFetch('/api/leave', {
      method: 'POST',
      body: JSON.stringify({ startDate, endDate, reason }),
    });
    if (res.ok) {
      showToast('Leave Submitted', 'Your time-off request was sent to dispatch for review.', 'success');
      document.getElementById('staffLeaveForm').reset();
      await fetchLeaveRequests();
      renderStaffMyLeaveTable();
    }
  } catch (err) {
    showToast('Submission Failed', err.message, 'error');
  }
}

/* ==============================================================================
   IMMUTABLE STATUS AUDIT LOG MODAL
   ============================================================================== */
async function openStatusLogModal(entityId) {
  const backdrop = document.getElementById('statusLogModalBackdrop');
  const title = document.getElementById('statusLogModalTitle');
  const subtitle = document.getElementById('statusLogModalSubtitle');
  const timeline = document.getElementById('statusLogTimeline');

  if (!backdrop) return;

  title.textContent = `Status Audit Trail: ${entityId}`;
  subtitle.textContent = `Immutable cryptographic transitions & dispatch actions`;
  backdrop.style.display = 'flex';
  timeline.innerHTML = '<div style="color: #94a3b8; font-size: 0.85rem;">Querying status_log...</div>';

  try {
    const res = await authFetch(`/api/status-log/${entityId}`);
    if (res.ok) {
      const data = await res.json();
      const logs = data.logs || [];
      if (logs.length === 0) {
        timeline.innerHTML = `<div class="empty-state">No status transitions logged yet.</div>`;
        return;
      }

      timeline.innerHTML = logs.map((item, idx) => `
        <div class="timeline-item">
          <div class="timeline-dot ${idx === 0 ? 'active' : ''}">●</div>
          <div class="timeline-content">
            <span class="timeline-title">${escapeHtml(item.old_status)} ➔ ${escapeHtml(item.new_status)}</span>
            <span class="timeline-time">${formatDate(item.timestamp)} &bull; ${escapeHtml(item.changed_by)}</span>
            ${item.note ? `<div class="timeline-note">${escapeHtml(item.note)}</div>` : ''}
          </div>
        </div>
      `).join('');
    }
  } catch (err) {
    timeline.innerHTML = `<div class="empty-state">Failed to load audit history.</div>`;
  }
}

/* ==============================================================================
   OBSERVABILITY & NOTIFICATIONS FEED (ADMIN VIEW)
   ============================================================================== */
async function fetchLogs(silent = false) {
  try {
    const res = await authFetch('/api/logs');
    if (res.ok) {
      const data = await res.json();
      const logs = data.logs || [];
      renderLogsTable(logs);
      const count = document.getElementById('logsCount');
      if (count) count.textContent = `${logs.length} events`;
    }
  } catch (err) {
    if (!silent) console.error('[Fetch Logs Error]', err);
  }
}

function renderLogsTable(logs) {
  const tbody = document.getElementById('logsTableBody');
  if (!tbody) return;

  if (logs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-state small">No audit logs recorded.</td></tr>`;
    return;
  }

  tbody.innerHTML = logs.slice(0, 50).map((l) => `
    <tr>
      <td style="font-family: var(--font-mono); font-size: 0.72rem; color: #64748b;">${formatDate(l.Timestamp || l.timestamp)}</td>
      <td><strong style="font-family: var(--font-mono); font-size: 0.75rem;">${escapeHtml(l.LeadID || l.lead_id || 'SYS')}</strong></td>
      <td><span style="font-weight: 600; font-size: 0.78rem;">${escapeHtml(l.Step || l.step)}</span></td>
      <td><span class="badge ${String(l.Outcome || l.outcome).toLowerCase().includes('success') ? 'badge-success-subtle' : 'badge-subtle'}" style="font-size: 0.7rem;">${escapeHtml(l.Outcome || l.outcome)}</span></td>
    </tr>
  `).join('');
}

async function fetchNotifications(silent = false) {
  try {
    const res = await authFetch('/api/notifications');
    if (res.ok) {
      const data = await res.json();
      const notifs = data.notifications || [];
      renderNotificationsFeed(notifs);
      const count = document.getElementById('notificationCount');
      if (count) count.textContent = `${notifs.length} sent`;
    }
  } catch (err) {
    if (!silent) console.error('[Fetch Notifications Error]', err);
  }
}

function renderNotificationsFeed(notifs) {
  const feed = document.getElementById('notificationsFeed');
  if (!feed) return;

  if (notifs.length === 0) {
    feed.innerHTML = `<div class="empty-state small">No notifications dispatched yet.</div>`;
    return;
  }

  feed.innerHTML = notifs.slice(0, 30).map((n) => `
    <div class="notification-item" style="padding: 0.65rem 0.85rem; border-bottom: 1px solid #f1f5f9;">
      <div style="display: flex; justify-content: space-between; font-size: 0.72rem; color: #64748b; margin-bottom: 2px;">
        <span class="badge badge-subtle" style="font-size: 0.65rem;">${escapeHtml(n.channel || 'SMS').toUpperCase()}</span>
        <span style="font-family: var(--font-mono);">${formatDate(n.timestamp)}</span>
      </div>
      <div style="font-size: 0.8rem; font-weight: 600; color: #0f172a;">To: ${escapeHtml(n.recipient || 'Customer')}</div>
      <div style="font-size: 0.75rem; color: #475569; margin-top: 2px;">${escapeHtml(n.message || n.body || '')}</div>
    </div>
  `).join('');
}

/* ==============================================================================
   CALL SIMULATOR & VOICE CONTROLLER
   ============================================================================== */
function initEventListeners() {
  initVoiceCallController();

  // Scenario Buttons
  document.querySelectorAll('.scenario-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const scenarioKey = btn.dataset.scenario;
      if (SCENARIOS[scenarioKey]) {
        processInboundCall(SCENARIOS[scenarioKey].transcript);
      }
    });
  });

  // Admin Filter Buttons
  document.querySelectorAll('#statusFilters .filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#statusFilters .filter-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      renderLeadsTable();
    });
  });

  // Staff Filter Buttons
  document.querySelectorAll('#staffFilters .filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      filterStaffOrders(btn.dataset.staffFilter);
    });
  });

  // Admin Search Input
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value.toLowerCase().trim();
      renderLeadsTable();
    });
  }

  // Staff Search Input
  const staffSearchInput = document.getElementById('staffSearchInput');
  if (staffSearchInput) {
    staffSearchInput.addEventListener('input', (e) => {
      handleStaffSearch(e.target.value);
    });
  }

  // Follow-up Check
  document.getElementById('btnRunFollowup')?.addEventListener('click', async () => {
    try {
      const res = await authFetch('/api/followup/run', { method: 'POST' });
      if (res.ok) {
        showToast('Follow-up Scan Completed', 'Unbooked leads scanned and follow-up timers dispatched.', 'success');
        await refreshAllData();
      }
    } catch (err) {
      showToast('Follow-up Error', err.message, 'error');
    }
  });

  // Export CSV
  document.getElementById('btnExportCsv')?.addEventListener('click', () => {
    window.location.href = '/api/leads/export/csv';
  });

  // Modals close buttons
  document.getElementById('statusLogModalClose')?.addEventListener('click', () => {
    document.getElementById('statusLogModalBackdrop').style.display = 'none';
  });
  document.getElementById('addTechModalClose')?.addEventListener('click', () => {
    document.getElementById('addTechModalBackdrop').style.display = 'none';
  });
  document.getElementById('btnCancelAddTech')?.addEventListener('click', () => {
    document.getElementById('addTechModalBackdrop').style.display = 'none';
  });
  document.getElementById('btnAddStaffMember')?.addEventListener('click', () => {
    document.getElementById('addTechModalBackdrop').style.display = 'flex';
  });
  document.getElementById('btnOpenAddServiceModal')?.addEventListener('click', () => {
    document.getElementById('addServiceModalBackdrop').style.display = 'flex';
  });
  document.getElementById('addServiceModalClose')?.addEventListener('click', () => {
    document.getElementById('addServiceModalBackdrop').style.display = 'none';
  });
  document.getElementById('btnCancelAddService')?.addEventListener('click', () => {
    document.getElementById('addServiceModalBackdrop').style.display = 'none';
  });

  // Settings modal
  document.getElementById('btnOpenSettings')?.addEventListener('click', () => {
    document.getElementById('settingsModalBackdrop').style.display = 'flex';
    loadSettingsData();
  });
  document.getElementById('settingsModalClose')?.addEventListener('click', () => {
    document.getElementById('settingsModalBackdrop').style.display = 'none';
  });
  document.getElementById('btnCancelSettings')?.addEventListener('click', () => {
    document.getElementById('settingsModalBackdrop').style.display = 'none';
  });
}

/* ==============================================================================
   PUBLIC CUSTOMER LANDING PAGE & FAST BOOKING CONTROLLER (NO ACCOUNT NEEDED)
   ============================================================================== */
function initLandingPage() {
  // Navigation & Switching buttons
  document.getElementById('btnGoToInternalPortal')?.addEventListener('click', () => switchMode('portal'));
  document.getElementById('btnFooterToPortal')?.addEventListener('click', () => switchMode('portal'));
  document.getElementById('btnSidebarToLanding')?.addEventListener('click', () => switchMode('landing'));
  document.getElementById('btnTopbarToLanding')?.addEventListener('click', () => switchMode('landing'));

  // Public Order Tracking Modal Triggers
  document.getElementById('btnOpenPublicTrackModal')?.addEventListener('click', () => {
    const modal = document.getElementById('publicTrackModal');
    if (modal) modal.style.display = 'flex';
    document.getElementById('modalTrackInput')?.focus();
  });

  document.getElementById('btnClosePublicTrackModal')?.addEventListener('click', () => {
    const modal = document.getElementById('publicTrackModal');
    if (modal) modal.style.display = 'none';
  });

  // Track button handlers
  document.getElementById('btnLandingTrack')?.addEventListener('click', () => handlePublicTrack('landing'));
  document.getElementById('landingTrackInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handlePublicTrack('landing');
  });

  document.getElementById('btnModalTrack')?.addEventListener('click', () => handlePublicTrack('modal'));
  document.getElementById('modalTrackInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handlePublicTrack('modal');
  });

  // Voice AI button triggers from Landing Page
  const triggerVoiceCall = () => {
    switchMode('portal');
    switchRole('customer');
    switchView('voice');
    setTimeout(() => {
      document.getElementById('btnStartVoiceCall')?.click();
    }, 300);
  };
  document.getElementById('btnHeroCallAi')?.addEventListener('click', triggerVoiceCall);
  document.getElementById('btnLandingStartVoiceCall')?.addEventListener('click', triggerVoiceCall);

  // Urgency Selector Radio Changes
  document.querySelectorAll('input[name="publicUrgency"]').forEach((radio) => {
    radio.addEventListener('change', (e) => {
      if (window.updateUrgencyUi) {
        window.updateUrgencyUi(e.target.value);
      }
    });
  });

  // Floating Emergency Bar visibility on scroll
  const stickyBar = document.getElementById('landingStickyBar');
  window.addEventListener('scroll', () => {
    if (currentAppMode !== 'landing' || !stickyBar) return;
    if (window.scrollY > 420) {
      stickyBar.classList.add('visible');
    } else {
      stickyBar.classList.remove('visible');
    }
  });

  // Booking Success Modal Actions
  document.getElementById('btnCloseBookingSuccess')?.addEventListener('click', closeBookingSuccessModal);
  document.getElementById('btnCopyTrackingCode')?.addEventListener('click', () => {
    const code = document.getElementById('bookingSuccessTrackingCode')?.textContent?.trim();
    if (code) {
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(code).then(() => {
          showToast('Copied!', `Tracking ID ${code} copied to clipboard`, 'success', 2500);
        }).catch(() => {
          showToast('Tracking Code', code, 'info', 2500);
        });
      } else {
        showToast('Tracking Code', code, 'info', 2500);
      }
    }
  });

  // Close modals on backdrop click
  window.addEventListener('click', (e) => {
    if (e.target.classList && e.target.classList.contains('modal-backdrop')) {
      e.target.style.display = 'none';
    }
  });
}

function switchMode(mode, updateUrl = true) {
  currentAppMode = mode;
  const landing = document.getElementById('publicLandingPage');
  const portal = document.getElementById('internalPortalWrapper');

  if (mode === 'portal') {
    if (landing) landing.style.display = 'none';
    if (portal) portal.style.display = 'flex';
    if (updateUrl) {
      window.history.pushState(null, '', `/${currentRole || 'portal'}`);
    }
    refreshAllData();
  } else {
    if (portal) portal.style.display = 'none';
    if (landing) landing.style.display = 'block';
    if (updateUrl && window.location.pathname !== '/home') {
      window.history.pushState(null, '', '/home');
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
    loadPublicLandingData();
  }
}
window.switchMode = switchMode;

window.navigateTo = function(routePath) {
  const path = (routePath || '/home').toLowerCase();
  if (path === '/portal' || path === '/admin' || path === '/staff' || path === '/customer') {
    if (path !== '/portal') switchRole(path.replace('/', ''));
    switchMode('portal', true);
  } else {
    switchMode('landing', true);
  }
};

let rawLandingServices = [];

async function loadPublicLandingData() {
  try {
    const res = await fetch('/api/services');
    if (res.ok) {
      const data = await res.json();
      rawLandingServices = (data.services || []).filter((s) => s.active === 1 || s.active === true);
      renderCleanServicesGrid();
      populateBookingFormServices(rawLandingServices);
    }
  } catch (err) {
    console.warn('[Landing Services Load Warning]', err.message);
  }
}

function populateBookingFormServices(services) {
  const select = document.getElementById('publicBookServiceSelect');
  if (select) {
    let opts = '';
    services.forEach((s) => {
      opts += `<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)}</option>`;
    });
    opts += `<option value="Emergency Diagnostic & Inspection">🚨 Other / General Emergency Inspection</option>`;
    select.innerHTML = opts;
  }
}

function getServiceMeta(name) {
  const lower = name.toLowerCase();
  if (lower.includes('pipe') || lower.includes('burst')) {
    return { price: 189, rateLabel: 'Diagnostic & Isolation', hub: 'Springfield West Hub', icon: '🌊', isEmergency: true };
  }
  if (lower.includes('boiler')) {
    return { price: 249, rateLabel: 'Commercial Inspection', hub: 'Springfield Industrial Plaza', icon: '🏭', isEmergency: false };
  }
  if (lower.includes('ac') || lower.includes('hvac') || lower.includes('heat pump') || lower.includes('cool')) {
    return { price: 159, rateLabel: 'System Diagnostic', hub: 'Springfield North Hub', icon: '❄️', isEmergency: true };
  }
  if (lower.includes('water heater')) {
    return { price: 149, rateLabel: 'Diagnostic & Flush', hub: 'Springfield Metro Fleet', icon: '🔥', isEmergency: true };
  }
  if (lower.includes('drain') || lower.includes('sewer')) {
    return { price: 129, rateLabel: 'Camera Diagnostic', hub: 'Springfield Central Fleet', icon: '💧', isEmergency: false };
  }
  return { price: 139, rateLabel: 'Standard Diagnostic', hub: 'Springfield Dispatch Hub', icon: '🛠️', isEmergency: false };
}

function renderCleanServicesGrid() {
  const grid = document.getElementById('landingServicesGrid');
  if (!grid) return;

  let html = '';
  rawLandingServices.forEach((s) => {
    const meta = getServiceMeta(s.name);
    const badge = meta.isEmergency 
      ? '<span class="service-sla-badge emergency">🚨 45-60m SLA</span>' 
      : '<span class="service-sla-badge priority">⚡ Same-Day Priority</span>';

    html += `
      <div class="service-clean-card">
        <div class="service-card-top">
          <div class="service-card-icon">${meta.icon}</div>
          ${badge}
        </div>

        <div class="service-card-name">${escapeHtml(s.name)}</div>
        <div class="service-card-description">${escapeHtml(s.description || 'Professional diagnostic, immediate isolation, and master repairs by certified Springfield technicians.')}</div>

        <div class="service-card-rate-row">
          <div class="service-card-rate">$${meta.price} <span>/ ${meta.rateLabel}</span></div>
          <div class="service-card-hub-tag">🟢 ${meta.hub}</div>
        </div>

        <button class="btn-select-service" onclick="selectServiceForBooking('${escapeHtml(s.name).replace(/'/g, "\\'")}')">
          <span>⚡ Select for Instant Booking &rarr;</span>
        </button>
      </div>
    `;
  });

  grid.innerHTML = html;
}

window.selectServiceForBooking = function(serviceName) {
  const select = document.getElementById('publicBookServiceSelect');
  if (select) {
    select.value = serviceName;
  }
  document.getElementById('fastBookingSection')?.scrollIntoView({ behavior: 'smooth' });
};

window.quickSelectTradeIssue = function(serviceName, urgency = 'Emergency') {
  const select = document.getElementById('publicBookServiceSelect');
  if (select) {
    for (let opt of select.options) {
      if (opt.value.toLowerCase().includes(serviceName.toLowerCase()) || serviceName.toLowerCase().includes(opt.value.toLowerCase())) {
        select.value = opt.value;
        break;
      }
    }
  }
  const rad = document.querySelector(`input[name="publicUrgency"][value="${urgency}"]`);
  if (rad) {
    rad.checked = true;
    window.updateUrgencyUi(urgency);
  }
  document.getElementById('fastBookingSection')?.scrollIntoView({ behavior: 'smooth' });
};

window.selectHeroUrgencyTab = function(urgency) {
  const isEmergency = urgency === 'Emergency';
  document.getElementById('segEmergencyBtn')?.classList.toggle('active', isEmergency);
  document.getElementById('segScheduledBtn')?.classList.toggle('active', !isEmergency);

  const slotRow = document.getElementById('scheduledSlotRow');
  if (slotRow) {
    slotRow.style.display = isEmergency ? 'none' : 'grid';
  }

  const rad = document.querySelector(`input[name="publicUrgency"][value="${urgency}"]`);
  if (rad) rad.checked = true;

  const btnText = document.getElementById('btnSubmitText');
  if (btnText) {
    btnText.textContent = isEmergency ? 'DISPATCH NEAREST TECH NOW' : 'SCHEDULE SERVICE APPOINTMENT';
  }
};

window.selectQuickIssue = function(serviceName, labelEl, evt) {
  const radio = labelEl ? labelEl.querySelector('input[type="radio"]') : null;

  document.querySelectorAll('.issue-radio-card').forEach((card) => card.classList.remove('active'));
  if (labelEl) {
    labelEl.classList.add('active');
    if (radio) radio.checked = true;
  }

  const select = document.getElementById('publicBookServiceSelect');
  if (select) {
    select.value = serviceName;
  }

  const statusNote = document.getElementById('issueClearedNote');
  if (statusNote) {
    statusNote.style.display = 'none';
  }
};

window.clearSelectedIssue = function(evt) {
  if (evt) {
    evt.preventDefault();
    evt.stopPropagation();
  }
  // Uncheck all radio inputs in quick issue grid
  const radios = document.querySelectorAll('input[name="quickIssueRadio"]');
  radios.forEach((r) => { r.checked = false; });

  // Remove active class from all issue cards
  document.querySelectorAll('.issue-radio-card').forEach((card) => card.classList.remove('active'));

  // Default to General Plumbing & HVAC Diagnostic
  const select = document.getElementById('publicBookServiceSelect');
  if (select) {
    select.value = 'General Plumbing & HVAC Diagnostic';
  }

  // Show visual confirmation note
  const statusNote = document.getElementById('issueClearedNote');
  if (statusNote) {
    statusNote.style.display = 'inline-flex';
    setTimeout(() => {
      if (statusNote) statusNote.style.display = 'none';
    }, 4000);
  }

  showToast('Option Cleared', 'No issue selected. Master tech will diagnose on site.', 'info', 2500);
};

window.clearHeroForm = function(evt) {
  if (evt) {
    evt.preventDefault();
    evt.stopPropagation();
  }
  const form = document.getElementById('publicFastBookingForm');
  if (form) form.reset();

  const nameEl = document.getElementById('publicBookName');
  const phoneEl = document.getElementById('publicBookPhone');
  const addrEl = document.getElementById('publicBookAddress');
  const dateEl = document.getElementById('publicBookDate');
  const descEl = document.getElementById('publicBookDescription');

  if (nameEl) nameEl.value = '';
  if (phoneEl) phoneEl.value = '';
  if (addrEl) addrEl.value = '';
  if (dateEl) dateEl.value = '';
  if (descEl) descEl.value = '';

  window.clearSelectedIssue();
  window.selectHeroUrgencyTab('Emergency');
  showToast('Form Reset', 'Hero booking fields cleared.', 'info', 2000);
};

window.fillDemoEmergencyBooking = function() {
  const nameEl = document.getElementById('publicBookName');
  const phoneEl = document.getElementById('publicBookPhone');
  const addrEl = document.getElementById('publicBookAddress');

  if (nameEl) nameEl.value = 'Evelyn Reed';
  if (phoneEl) phoneEl.value = '(555) 349-8120';
  if (addrEl) addrEl.value = '112 Oakwood Drive, Springfield';

  window.selectHeroUrgencyTab('Emergency');
  const burstRadio = document.querySelector('input[name="quickIssueRadio"][value="Burst Pipe Emergency & Repiping"]');
  if (burstRadio) {
    burstRadio.checked = true;
    window.selectQuickIssue('Burst Pipe Emergency & Repiping', burstRadio.closest('.issue-radio-card'));
  }
  showToast('Demo Data Filled', 'Ready to test! Click DISPATCH NEAREST TECH NOW.', 'info', 3000);
};

window.updateUrgencyUi = function(val) {
  window.selectHeroUrgencyTab(val);
};

window.quickFillTrack = function(query) {
  const input = document.getElementById('landingTrackInput');
  if (input) {
    input.value = query;
    handlePublicTrack('landing');
  }
};

window.toggleFaq = function(btn) {
  const item = btn.closest('.faq-item');
  if (item) {
    const isOpen = item.classList.contains('active');
    document.querySelectorAll('.faq-item').forEach((f) => f.classList.remove('active'));
    if (!isOpen) {
      item.classList.add('active');
    }
  }
};

window.submitPublicFastBooking = async function() {
  const name = document.getElementById('publicBookName')?.value?.trim();
  const phone = document.getElementById('publicBookPhone')?.value?.trim();
  const email = document.getElementById('publicBookEmail')?.value?.trim() || '';
  const address = document.getElementById('publicBookAddress')?.value?.trim();
  const checkedRadio = document.querySelector('input[name="quickIssueRadio"]:checked');
  const service = document.getElementById('publicBookServiceSelect')?.value || (checkedRadio ? checkedRadio.value : 'Emergency Diagnostic & Inspection');
  const urgency = document.querySelector('input[name="publicUrgency"]:checked')?.value || 'Emergency';
  const date = document.getElementById('publicBookDate')?.value || '';
  const slot = document.getElementById('publicBookSlot')?.value || '';
  const description = document.getElementById('publicBookDescription')?.value?.trim() || '';

  if (!name || !phone || !address) {
    showToast('Missing Required Details', 'Please enter your name, phone number, and service address.', 'warning');
    return;
  }

  const submitBtn = document.getElementById('btnSubmitPublicBooking');
  const origText = submitBtn ? submitBtn.innerHTML : '';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span>⏳</span> Dispatching Certified Technician...';
  }

  try {
    const res = await fetch('/api/public/book', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        phone,
        email,
        location: address,
        job_type: service,
        urgency,
        preferred_date: date,
        preferred_slot: slot,
        description,
      }),
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Booking could not be processed');
    }

    if (data.lead) {
      saveLeadToClientStorage(data.lead);
    }

    openBookingSuccessModal(data);
    document.getElementById('publicFastBookingForm')?.reset();
    showToast('Service Booked!', `Technician assigned for ${data.trackingId}`, 'success');
  } catch (err) {
    showToast('Booking Error', err.message, 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = origText;
    }
  }
};

function openBookingSuccessModal(data) {
  const modal = document.getElementById('bookingSuccessModal');
  if (!modal) return;

  const trackingCodeEl = document.getElementById('bookingSuccessTrackingCode');
  const techEl = document.getElementById('bookingSuccessTech');
  const arrivalEl = document.getElementById('bookingSuccessArrival');
  const serviceEl = document.getElementById('bookingSuccessService');
  const phoneEl = document.getElementById('bookingSuccessPhone');

  if (trackingCodeEl) trackingCodeEl.textContent = data.trackingId;
  if (techEl) techEl.textContent = data.assignedTech || 'Master Technician';
  if (arrivalEl) arrivalEl.textContent = data.estimatedArrival || 'Within 45 to 60 minutes';
  if (serviceEl) serviceEl.textContent = (data.lead && (data.lead.jobType || data.lead.job_type)) || 'Trade Service';
  if (phoneEl) phoneEl.textContent = data.customerPhone || '';

  const magicBtn = document.getElementById('btnTrackJobLiveMagic');
  if (magicBtn) {
    magicBtn.onclick = () => {
      modal.style.display = 'none';
      openMagicTrackerInCustomerPortal(data.trackingId);
    };
  }

  modal.style.display = 'flex';
}

function closeBookingSuccessModal() {
  const modal = document.getElementById('bookingSuccessModal');
  if (modal) modal.style.display = 'none';
}

async function handlePublicTrack(source = 'landing') {
  const input = source === 'modal' 
    ? document.getElementById('modalTrackInput') 
    : document.getElementById('landingTrackInput');
  const resultContainer = source === 'modal'
    ? document.getElementById('modalTrackResult')
    : document.getElementById('landingTrackResult');

  const query = input?.value?.trim();
  if (!query) {
    showToast('Search Query Required', 'Please enter your Tracking ID or Phone Number', 'warning');
    return;
  }

  if (resultContainer) {
    resultContainer.style.display = 'block';
    resultContainer.innerHTML = '<div style="padding: 1.5rem; text-align: center; color: var(--text-muted);">Searching active dispatch records...</div>';
  }

  try {
    const res = await fetch(`/api/public/track?query=${encodeURIComponent(query)}`);
    const data = await res.json();

    if (!res.ok || !data.success) {
      if (resultContainer) {
        resultContainer.innerHTML = `
          <div class="empty-state" style="padding: 1.5rem; text-align: center;">
            <div style="font-size: 1.75rem; margin-bottom: 0.5rem;">🔍</div>
            <div style="font-weight: 700; color: #0f172a; margin-bottom: 4px;">No Active Booking Found</div>
            <div style="font-size: 0.85rem; color: #64748b;">We couldn't find an appointment matching "${escapeHtml(query)}". Please check your phone or tracking ID, or call (555) 019-2834.</div>
          </div>
        `;
      }
      return;
    }

    const lead = data.lead;
    const stages = ['Request Received', 'AI Qualified', 'Appointment Confirmed', 'Technician Dispatched', 'Work Completed'];
    let currentStageIndex = 2; // Default confirmed
    if (lead.status === 'New Lead') currentStageIndex = 0;
    else if (lead.status === 'Qualified') currentStageIndex = 1;
    else if (lead.status === 'Booked') currentStageIndex = 2;
    else if (lead.status === 'In Progress') currentStageIndex = 3;
    else if (lead.status === 'Completed' || lead.status === 'Closed') currentStageIndex = 4;

    let stepperHtml = '';
    stages.forEach((st, idx) => {
      let stateClass = '';
      if (idx < currentStageIndex) stateClass = 'done';
      else if (idx === currentStageIndex) stateClass = 'active';

      stepperHtml += `
        <div class="track-step ${stateClass}">
          <div class="track-step-dot">${idx < currentStageIndex ? '✓' : (idx + 1)}</div>
          <div class="track-step-lbl">${st}</div>
        </div>
      `;
    });

    const isEmergency = lead.urgency === 'Emergency';

    if (resultContainer) {
      resultContainer.innerHTML = `
        <div class="public-track-card">
          <div class="track-header-row">
            <div>
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                <span class="lead-id-pill" style="font-size: 0.85rem;">${escapeHtml(lead.leadId)}</span>
                <span class="badge ${lead.status === 'In Progress' ? 'badge-success' : 'badge-info'}">${escapeHtml(lead.status)}</span>
                ${isEmergency ? '<span class="badge badge-danger">🚨 Emergency Dispatch</span>' : ''}
              </div>
              <h3 style="margin: 0; font-size: 1.15rem; color: #0f172a;">${escapeHtml(lead.jobType)}</h3>
              <div style="font-size: 0.8rem; color: #64748b; margin-top: 2px;">Customer: ${escapeHtml(lead.customerName || 'Homeowner')} • ${escapeHtml(lead.location)}</div>
            </div>
            <div style="text-align: right;">
              <div style="font-size: 0.7rem; color: #64748b; text-transform: uppercase; font-weight: 700;">Arrival Window</div>
              <div style="font-size: 0.9rem; font-weight: 800; color: #1d4ed8;">${escapeHtml(lead.bookedSlot || 'Immediate Dispatch')}</div>
            </div>
          </div>

          <!-- Progress Stepper -->
          <div class="track-stepper-row">
            ${stepperHtml}
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 0.85rem; margin-top: 1rem;">
            <div>
              <span style="font-size: 0.7rem; color: #64748b; font-weight: 600; display: block;">Assigned Field Technician:</span>
              <strong style="font-size: 0.85rem; color: #0f172a;">${escapeHtml(lead.assignedTech || 'Dave M. (Master Plumber)')}</strong>
            </div>
            <div>
              <span style="font-size: 0.7rem; color: #64748b; font-weight: 600; display: block;">Latest Dispatch Note:</span>
              <span style="font-size: 0.8rem; color: #334155;">${escapeHtml(lead.technicianNotes || lead.description || 'Technician scheduled.')}</span>
            </div>
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 1rem;">
            <span style="font-size: 0.75rem; color: #64748b;">Need assistance? 24/7 Hotline: <strong>(555) 019-2834</strong></span>
            <button class="btn btn-primary btn-sm" onclick="openMagicTrackerInCustomerPortal('${lead.leadId}')">
              Open Full Tracker in Portal ➔
            </button>
          </div>
        </div>
      `;
    }
  } catch (err) {
    if (resultContainer) {
      resultContainer.innerHTML = `<div class="empty-state" style="padding: 1rem; color: #dc2626;">Error looking up booking: ${escapeHtml(err.message)}</div>`;
    }
  }
}

window.openMagicTrackerInCustomerPortal = function(leadId) {
  switchRole('customer');
  switchMode('portal');
  setTimeout(() => {
    const lookupInput = document.getElementById('customerLookupInput');
    if (lookupInput) lookupInput.value = leadId;
    handleCustomerLookup();
  }, 300);
};

async function processInboundCall(transcript) {
  showToast('Processing Call', 'Agent Riley parsing intent and qualifying against services catalog...', 'info', 2500);

  try {
    const res = await authFetch('/api/simulate-call', {
      method: 'POST',
      body: JSON.stringify({ transcript }),
    });

    if (res.ok) {
      const data = await res.json();
      if (data.lead) {
        saveLeadToClientStorage(data.lead);
      }
      showToast('Intake Completed', `Status: ${data.lead?.Status || 'Processed'}. Logged to CRM.`, 'success');
      await refreshAllData();
    }
  } catch (err) {
    showToast('Intake Error', err.message, 'error');
  }
}

/* ==============================================================================
   LIVE VOICE CALL WITH AGENT RILEY (GEMINI CONVERSATIONAL ENGINE)
   ============================================================================== */
let isVoiceCallActive = false;
let callStartTime = null;
let callDurationTimer = null;
let recognition = null;
let synth = window.speechSynthesis;
let liveCallHistory = [];
let preferredVoice = null;
let isCallBooked = false;

function loadPreferredVoice() {
  if (!synth) return;
  const voices = synth.getVoices();
  if (!voices || voices.length === 0) return;
  
  // Prioritize modern high-fidelity natural/neural voices
  preferredVoice = voices.find(v => v.name.toLowerCase().includes('natural') && v.lang.startsWith('en'))
    || voices.find(v => v.name.toLowerCase().includes('google us english'))
    || voices.find(v => v.name.toLowerCase().includes('jenny'))
    || voices.find(v => v.name.toLowerCase().includes('aria'))
    || voices.find(v => v.name.toLowerCase().includes('samantha'))
    || voices.find(v => v.lang.startsWith('en-US'))
    || voices[0];
}

if (typeof window !== 'undefined' && window.speechSynthesis) {
  window.speechSynthesis.onvoiceschanged = loadPreferredVoice;
  loadPreferredVoice();
}

function initVoiceCallController() {
  const btnStart = document.getElementById('btnStartVoiceCall');
  const btnEnd = document.getElementById('btnEndVoiceCall');
  const btnSend = document.getElementById('btnSendLiveReply');
  const speechInput = document.getElementById('liveSpeechInput');

  if (btnStart) btnStart.addEventListener('click', startLiveVoiceCall);
  if (btnEnd) btnEnd.addEventListener('click', endLiveVoiceCall);
  if (btnSend) btnSend.addEventListener('click', sendUserReply);
  if (speechInput) {
    speechInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendUserReply();
    });
  }

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
      const text = event.results[0][0].transcript;
      if (text && isVoiceCallActive) {
        handleUserSpeech(text);
      }
    };

    recognition.onend = () => {
      if (isVoiceCallActive && !synth?.speaking) {
        try { recognition.start(); } catch (e) {}
      }
    };
  }
}

function startLiveVoiceCall() {
  isVoiceCallActive = true;
  isCallBooked = false;
  callStartTime = Date.now();
  liveCallHistory = [];
  loadPreferredVoice();

  document.getElementById('activeCallModal').style.display = 'block';
  document.getElementById('callTranscriptLog').innerHTML = '';

  callDurationTimer = setInterval(() => {
    const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
    const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const secs = String(elapsed % 60).padStart(2, '0');
    document.getElementById('callStatusText').textContent = `Call Connected with Riley (${mins}:${secs})`;
  }, 1000);

  const greeting = "Thanks for calling Apex Elite Plumbing & Heating. My name is Riley. Are you looking to schedule a service visit, or do you have an active emergency?";
  liveCallHistory.push({ role: 'assistant', content: greeting });
  appendSpeechBubble('riley', greeting);

  speakText(greeting, () => {
    if (recognition && isVoiceCallActive) {
      try { recognition.start(); } catch (e) {}
    }
  });
}

async function endLiveVoiceCall() {
  isVoiceCallActive = false;
  clearInterval(callDurationTimer);
  if (recognition) {
    try { recognition.stop(); } catch (e) {}
  }
  if (synth) synth.cancel();

  document.getElementById('activeCallModal').style.display = 'none';

  // If not booked during live conversation, finalize and ingest full call into CRM
  if (!isCallBooked && liveCallHistory && liveCallHistory.length > 1) {
    try {
      const callerPhone = (currentUser?.role === 'customer' && currentUser?.phone) ? currentUser.phone : '';
      const res = await authFetch('/api/voice/end-call', {
        method: 'POST',
        body: JSON.stringify({
          history: liveCallHistory,
          callerPhone,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const createdLead = data?.leadResult?.lead;
        if (createdLead) {
          saveLeadToClientStorage(createdLead);
          showToast('Call Intake Recorded', `Voice AI created lead ${createdLead.leadId || createdLead.LeadID || ''}`, 'success');
        }
        await refreshAllData();
      }
    } catch (e) {
      console.warn('[End Call Finalize Error]', e);
    }
  }
}

async function handleUserSpeech(text) {
  appendSpeechBubble('user', text);
  if (recognition) {
    try { recognition.stop(); } catch (e) {}
  }

  // Display thinking indicator in chat
  const log = document.getElementById('callTranscriptLog');
  const thinkingEl = document.createElement('div');
  thinkingEl.className = 'transcript-bubble bubble-agent';
  thinkingEl.id = 'rileyThinkingBubble';
  thinkingEl.innerHTML = `<em>Riley is listening and thinking...</em>`;
  if (log) {
    log.appendChild(thinkingEl);
    log.scrollTop = log.scrollHeight;
  }

  try {
    // Only send phone if customer role; never use contractor/admin phone as caller!
    const callerPhone = (currentUser?.role === 'customer' && currentUser?.phone) ? currentUser.phone : '';
    const res = await authFetch('/api/voice/gemini-web-turn', {
      method: 'POST',
      body: JSON.stringify({
        userSpeech: text,
        history: liveCallHistory,
        callerPhone,
      }),
    });

    if (thinkingEl.parentNode) thinkingEl.remove();

    if (res.ok) {
      const data = await res.json();
      const replyText = data.replyText || "I've got that noted. Can you confirm your address and the best phone number to reach you?";

      // Add to conversation memory
      liveCallHistory.push({ role: 'user', content: text });
      liveCallHistory.push({ role: 'assistant', content: replyText });

      if (data.leadResult && data.leadResult.lead) {
        saveLeadToClientStorage(data.leadResult.lead);
      }

      let badgeInfo = '';
      if (data.toolExecuted) {
        badgeInfo = ` <span class="badge badge-accent" style="font-size: 0.65rem; margin-left: 6px;">⚡ ${escapeHtml(data.toolExecuted)}</span>`;
        if (data.toolExecuted === 'book_appointment') {
          isCallBooked = true;
          if (data.leadResult && data.leadResult.lead) {
            saveLeadToClientStorage(data.leadResult.lead);
          }
          refreshAllData();
        }
      }

      appendSpeechBubble('riley', replyText + badgeInfo);

      // Speak using native audio if available, or natural neural voice
      playAudioOrSpeak(replyText, data.audioDataUri, () => {
        if (recognition && isVoiceCallActive) {
          try { recognition.start(); } catch (e) {}
        }
      });
    } else {
      appendSpeechBubble('riley', "I understand. Let me get our dispatch team notified right away.");
    }
  } catch (err) {
    if (thinkingEl.parentNode) thinkingEl.remove();
    console.warn('[Voice Turn Error]', err);
    appendSpeechBubble('riley', "I have logged your request and our dispatcher will follow up with you directly.");
  }
}

function sendUserReply() {
  const input = document.getElementById('liveSpeechInput');
  const text = input ? input.value.trim() : '';
  if (text && isVoiceCallActive) {
    input.value = '';
    handleUserSpeech(text);
  }
}

function appendSpeechBubble(speaker, htmlOrText) {
  const log = document.getElementById('callTranscriptLog');
  if (!log) return;

  const bubble = document.createElement('div');
  bubble.className = speaker === 'riley' ? 'transcript-bubble bubble-agent' : 'transcript-bubble bubble-user';
  bubble.innerHTML = `<strong>${speaker === 'riley' ? 'Agent Riley' : 'You'}:</strong> ${htmlOrText}`;
  log.appendChild(bubble);
  log.scrollTop = log.scrollHeight;
}

function playAudioOrSpeak(text, audioDataUri, onComplete) {
  if (audioDataUri) {
    try {
      const audio = new Audio(audioDataUri);
      audio.onended = () => {
        if (typeof onComplete === 'function') onComplete();
      };
      audio.onerror = () => {
        speakText(text, onComplete);
      };
      audio.play().catch(() => speakText(text, onComplete));
      return;
    } catch (e) {
      console.warn('[Audio Play Error Fallback to TTS]', e);
    }
  }
  speakText(text, onComplete);
}

function speakText(text, onComplete) {
  if (!synth) {
    if (typeof onComplete === 'function') onComplete();
    return;
  }
  synth.cancel();

  // Strip HTML tags for spoken utterance
  const plainText = text.replace(/<[^>]*>/g, '').trim();
  const utterance = new SpeechSynthesisUtterance(plainText);
  if (preferredVoice) {
    utterance.voice = preferredVoice;
  }
  utterance.rate = 1.02;
  utterance.pitch = 1.0;
  utterance.onend = () => {
    if (typeof onComplete === 'function') onComplete();
  };
  utterance.onerror = () => {
    if (typeof onComplete === 'function') onComplete();
  };
  synth.speak(utterance);
}

/* ==============================================================================
   INTEGRATIONS SETTINGS CONTROLLER (SLACK & CAL.COM)
   ============================================================================== */
async function loadSettingsData() {
  try {
    const res = await authFetch('/api/settings');
    if (res.ok) {
      const data = await res.json();
      const webhookInput = document.getElementById('settingSlackWebhook');
      if (webhookInput && data.slack?.webhookUrl) webhookInput.value = data.slack.webhookUrl;

      const channelSelect = document.getElementById('settingNotifyChannel');
      if (channelSelect && data.slack?.channel) channelSelect.value = data.slack.channel;

      const eventTypeInput = document.getElementById('settingCalEventTypeId');
      if (eventTypeInput && data.calcom?.eventTypeId) eventTypeInput.value = data.calcom.eventTypeId;

      const slackBadge = document.getElementById('settingsSlackStatusBadge');
      if (slackBadge) {
        slackBadge.className = data.slack?.isLive ? 'badge badge-success-subtle' : 'badge badge-subtle';
        slackBadge.textContent = data.slack?.isLive ? 'Connected' : 'Demo Simulation';
      }

      const calBadge = document.getElementById('settingsCalStatusBadge');
      if (calBadge) {
        calBadge.className = data.calcom?.isLive ? 'badge badge-success-subtle' : 'badge badge-subtle';
        calBadge.textContent = data.calcom?.isLive ? 'Cal.com Live' : 'Dynamic Local Calendar';
      }
    }
  } catch (err) {
    console.warn('[Settings Load Error]', err);
  }
}

async function submitSaveSettings() {
  const slackWebhookUrl = document.getElementById('settingSlackWebhook')?.value.trim();
  const contractorChannel = document.getElementById('settingNotifyChannel')?.value;
  const calcomApiKey = document.getElementById('settingCalApiKey')?.value.trim();
  const calcomEventTypeId = document.getElementById('settingCalEventTypeId')?.value.trim();

  try {
    const res = await authFetch('/api/settings', {
      method: 'POST',
      body: JSON.stringify({ slackWebhookUrl, contractorChannel, calcomApiKey, calcomEventTypeId }),
    });
    if (res.ok) {
      showToast('Settings Saved', 'Slack and Cal.com parameters updated at runtime.', 'success');
      document.getElementById('settingsModalBackdrop').style.display = 'none';
    }
  } catch (err) {
    showToast('Save Error', err.message, 'error');
  }
}

/* ==============================================================================
   FORMATTING & UTILITY FUNCTIONS
   ============================================================================== */
function formatSlot(isoStr) {
  if (!isoStr) return 'Not scheduled';
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    return d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch (e) {
    return isoStr;
  }
}

function formatDate(isoStr) {
  if (!isoStr) return '—';
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch (e) {
    return isoStr;
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
