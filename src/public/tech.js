/**
 * Apex Elite — Mobile Technician Field Portal Logic
 */

let allTechnicians = [];
let currentTech = null;

document.addEventListener('DOMContentLoaded', () => {
  initTechPortal();
});

async function initTechPortal() {
  await loadTechnicians();

  // Profile Selector Change
  document.getElementById('techProfileSelector').addEventListener('change', (e) => {
    const selectedId = parseInt(e.target.value, 10);
    currentTech = allTechnicians.find((t) => t.id === selectedId) || allTechnicians[0];
    localStorage.setItem('apex_last_tech_id', currentTech.id);
    syncDutyStatusUI();
    loadAssignedJobs();
  });

  // Duty Status Change
  document.getElementById('dutyStatusSelector').addEventListener('change', async (e) => {
    if (!currentTech) return;
    const newStatus = e.target.value;
    try {
      const res = await fetch(`/api/team/${currentTech.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        currentTech.status = newStatus;
        showToast('Duty Status Updated', `You are now marked as "${newStatus}".`, 'success');
      }
    } catch (err) {
      showToast('Status Update Failed', err.message, 'error');
    }
  });

  // Refresh Button
  document.getElementById('btnRefreshJobs').addEventListener('click', () => {
    loadAssignedJobs();
    showToast('Refreshed', 'Work orders re-synced with dispatch.', 'info');
  });

  // Polling for live job dispatches
  setInterval(() => {
    if (currentTech) loadAssignedJobs(true);
  }, 4000);
}

async function loadTechnicians() {
  try {
    const res = await fetch('/api/team');
    const data = await res.json();
    allTechnicians = data.team || [];

    const select = document.getElementById('techProfileSelector');
    if (allTechnicians.length === 0) {
      select.innerHTML = '<option value="">No staff registered</option>';
      return;
    }

    select.innerHTML = allTechnicians.map((t) => `
      <option value="${t.id}">${t.name} (${t.role})</option>
    `).join('');

    // Restore saved tech or default to first
    const savedId = parseInt(localStorage.getItem('apex_last_tech_id'), 10);
    currentTech = allTechnicians.find((t) => t.id === savedId) || allTechnicians[0];
    select.value = currentTech.id;

    syncDutyStatusUI();
    loadAssignedJobs();
  } catch (err) {
    console.error('Failed to load team:', err);
  }
}

function syncDutyStatusUI() {
  if (!currentTech) return;
  const statusSelect = document.getElementById('dutyStatusSelector');
  if (statusSelect) {
    statusSelect.value = currentTech.status || 'Available';
  }
}

async function loadAssignedJobs(silent = false) {
  if (!currentTech) return;
  const container = document.getElementById('techJobsContainer');

  try {
    const res = await fetch('/api/leads');
    const data = await res.json();
    const leads = data.leads || [];

    // Filter jobs assigned to this technician
    const myJobs = leads.filter(
      (l) => (l.AssignedTech === currentTech.name || l.assigned_tech === currentTech.name)
    );

    const subtitle = document.getElementById('assignedJobsSubtitle');
    if (subtitle) {
      const activeCount = myJobs.filter((j) => j.Status !== 'Completed' && j.Status !== 'Closed').length;
      subtitle.textContent = `${activeCount} active job${activeCount === 1 ? '' : 's'} assigned to you`;
    }

    if (myJobs.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 3rem 1.5rem; background: var(--bg-card); border-radius: var(--radius-lg); border: 1px dashed var(--border-subtle);">
          <div style="font-size: 2rem; margin-bottom: 0.5rem;">☕</div>
          <div style="font-weight: 700; font-size: 1rem; margin-bottom: 0.25rem;">No Active Jobs Assigned</div>
          <div style="font-size: 0.8rem; color: var(--text-muted); line-height: 1.4;">
            You are currently on standby. As soon as the dispatcher assigns a call to ${escapeHtml(currentTech.name)}, it will appear here instantly.
          </div>
        </div>
      `;
      return;
    }

    container.innerHTML = myJobs.map((job) => {
      const isEmergency = job.Urgency === 'Emergency';
      const isCompleted = job.Status === 'Completed' || job.Status === 'Closed';
      const slotDisplay = job.BookedSlot
        ? new Date(job.BookedSlot).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
        : 'Earliest Available';

      return `
        <div class="job-card ${isEmergency ? 'emergency' : ''} ${job.Status === 'Booked' ? 'booked' : ''}" id="jobCard_${job.id}">
          <div class="job-card-header">
            <div>
              <div class="job-title">${escapeHtml(job.JobType || 'Service Call')}</div>
              <div class="job-customer-name">👤 ${escapeHtml(job.Name || 'Valued Customer')} &bull; <span style="font-family: var(--font-mono); font-size: 0.75rem;">${job.LeadID || job.id}</span></div>
            </div>
            <span class="badge ${isEmergency ? 'badge-rose' : 'badge-emerald'}" style="font-size: 0.725rem;">
              ${isEmergency ? '🚨 Emergency' : 'Standard'}
            </span>
          </div>

          <!-- Location & Arrival Window -->
          <div style="background: var(--bg-input); padding: 0.65rem 0.85rem; border-radius: var(--radius-md); margin-bottom: 0.75rem; border: 1px solid var(--border-subtle); font-size: 0.825rem;">
            <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
              <span>📍</span>
              <strong>${escapeHtml(job.Location || 'Service address pending')}</strong>
            </div>
            <div style="display: flex; align-items: center; gap: 6px; color: var(--text-muted); font-size: 0.775rem;">
              <span>🕒</span>
              <span>Appointment: <strong>${slotDisplay}</strong></span>
            </div>
          </div>

          <!-- Issue Notes -->
          <div style="font-size: 0.8rem; color: var(--text-secondary); line-height: 1.4; margin-bottom: 0.75rem;">
            ${escapeHtml(job.Description || 'No call summary provided.')}
          </div>

          <!-- Action Buttons: Phone & GPS Navigation -->
          <div class="job-action-buttons">
            <a href="tel:${escapeHtml(job.Phone || '')}" class="job-btn job-btn-phone">
              <span>📞</span> Call Customer
            </a>
            <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(job.Location || '')}" target="_blank" class="job-btn job-btn-nav">
              <span>🗺️</span> GPS Navigate
            </a>
          </div>

          <!-- Technician Workflow Stepper -->
          <div style="font-size: 0.725rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.25rem;">
            Job Status Workflow:
          </div>
          <div class="workflow-stepper">
            <button class="step-btn ${job.Status === 'Dispatched' ? 'active' : ''}" onclick="updateJobStage('${job.id || job.LeadID}', 'Dispatched')">
              🚗 En Route
            </button>
            <button class="step-btn ${job.Status === 'In Progress' ? 'active' : ''}" onclick="updateJobStage('${job.id || job.LeadID}', 'In Progress')">
              🔧 Working
            </button>
            <button class="step-btn ${isCompleted ? 'complete' : ''}" onclick="completeJobPrompt('${job.id || job.LeadID}')">
              ${isCompleted ? '✅ Finished' : '🏁 Complete'}
            </button>
          </div>

          <!-- Field Work Notes -->
          <div style="margin-top: 0.65rem;">
            <input 
              type="text" 
              class="field-notes-input" 
              placeholder="Add technician field notes & press Enter..." 
              value="${escapeHtml(job.TechnicianNotes || '')}" 
              onchange="saveFieldNotes('${job.id || job.LeadID}', this.value)"
            />
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    if (!silent) console.error('Failed to load jobs:', err);
  }
}

async function updateJobStage(leadId, newStatus) {
  try {
    const res = await fetch(`/api/leads/${encodeURIComponent(leadId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ Status: newStatus }),
    });

    if (res.ok) {
      showToast('Status Updated', `Job marked as "${newStatus}". Dispatch notified.`, 'success');
      loadAssignedJobs();
    }
  } catch (err) {
    showToast('Update Failed', err.message, 'error');
  }
}

async function completeJobPrompt(leadId) {
  const notes = prompt('Enter completion summary (parts used, repair performed):', 'Service completed successfully. Tested and approved.');
  if (notes === null) return; // User cancelled

  try {
    // 1. Mark lead completed with technician notes in SQLite
    const res = await fetch(`/api/leads/${encodeURIComponent(leadId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        Status: 'Completed',
        TechnicianNotes: notes,
        NextAction: 'Review request sent / service completed',
      }),
    });

    if (res.ok) {
      // 2. Trigger Workflow D: Automated 5-star Google Review Request SMS
      await fetch(`/api/followup/trigger/${encodeURIComponent(leadId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: 'review' }),
      });

      showToast('Job Completed! 🎉', 'Job marked finished and automated review request sent to customer.', 'success');
      loadAssignedJobs();
    }
  } catch (err) {
    showToast('Failed to Complete Job', err.message, 'error');
  }
}

async function saveFieldNotes(leadId, notes) {
  try {
    await fetch(`/api/leads/${encodeURIComponent(leadId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ TechnicianNotes: notes }),
    });
    showToast('Notes Saved', 'Field technician notes updated.', 'success');
  } catch (err) {
    showToast('Failed to save notes', err.message, 'error');
  }
}

function showToast(title, message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <div class="toast-title">${escapeHtml(title)}</div>
    <div class="toast-message">${escapeHtml(message)}</div>
  `;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'toastOut 0.3s forwards';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
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
