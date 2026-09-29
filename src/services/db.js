import fs from 'fs';
import path from 'path';
import os from 'os';
import { DatabaseSync } from 'node:sqlite';

/**
 * Custom Native SQLite Relational Database & Repository
 * 100% self-hosted, private, zero-external-dependency relational database
 * providing Multi-Role RBAC (Admin, Staff, Customer), dynamic services catalog,
 * staff leave management, and immutable status audit trails.
 */

// On serverless environments (Vercel), root is read-only, so use system temp directory
const DATA_DIR = process.env.VERCEL
  ? path.join(os.tmpdir(), 'apex_crm_data')
  : path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'apex_crm.sqlite');

class CustomCrmDatabase {
  constructor() {
    this.db = null;
    this.init();
  }

  init() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      this.db = new DatabaseSync(DB_FILE);

      // Performance optimizations
      this.db.exec('PRAGMA journal_mode = WAL;');
      this.db.exec('PRAGMA synchronous = NORMAL;');
      this.db.exec('PRAGMA busy_timeout = 5000;');

      // 1. Users Table (Admin / Staff / Customer)
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          email TEXT UNIQUE NOT NULL,
          phone TEXT DEFAULT '',
          role TEXT NOT NULL CHECK(role IN ('admin', 'staff', 'customer')),
          active INTEGER NOT NULL DEFAULT 1,
          avatar TEXT DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);

      // 2. Services Table (Dynamic catalog driving AI prompt and customer views)
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS services (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          service_id TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          description TEXT DEFAULT '',
          active INTEGER NOT NULL DEFAULT 1,
          created_by TEXT DEFAULT 'admin',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);

      // 3. Leads Table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS leads (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          lead_id TEXT UNIQUE NOT NULL,
          customer_id INTEGER DEFAULT NULL,
          name TEXT NOT NULL DEFAULT 'Unknown Caller',
          phone TEXT DEFAULT '',
          email TEXT DEFAULT '',
          location TEXT DEFAULT '',
          job_type TEXT DEFAULT 'General Plumbing',
          urgency TEXT DEFAULT 'Medium',
          status TEXT DEFAULT 'New Lead',
          booked_slot TEXT DEFAULT '',
          assigned_staff_id INTEGER DEFAULT NULL,
          assigned_tech TEXT DEFAULT '',
          description TEXT DEFAULT '',
          photo_links TEXT DEFAULT '',
          next_action TEXT DEFAULT 'Schedule appointment',
          source TEXT DEFAULT 'ai_voice',
          recording_url TEXT DEFAULT '',
          technician_notes TEXT DEFAULT '',
          customer_notes TEXT DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);

      // 4. Staff Leave Requests Table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS leave_requests (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          request_id TEXT UNIQUE NOT NULL,
          staff_id INTEGER NOT NULL,
          staff_name TEXT NOT NULL,
          start_date TEXT NOT NULL,
          end_date TEXT NOT NULL,
          reason TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'Pending' CHECK(status IN ('Pending', 'Approved', 'Rejected')),
          requested_at TEXT NOT NULL,
          reviewed_by TEXT DEFAULT '',
          reviewed_at TEXT DEFAULT '',
          admin_notes TEXT DEFAULT ''
        );
      `);

      // 5. Immutable Status Audit Log Table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS status_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          log_id TEXT UNIQUE NOT NULL,
          entity_type TEXT NOT NULL CHECK(entity_type IN ('lead', 'leave_request')),
          entity_id TEXT NOT NULL,
          changed_by TEXT NOT NULL,
          old_status TEXT NOT NULL,
          new_status TEXT NOT NULL,
          note TEXT DEFAULT '',
          timestamp TEXT NOT NULL
        );
      `);

      // 6. Technicians Table (Maintained for backward compatibility)
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS technicians (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tech_id TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          phone TEXT NOT NULL,
          email TEXT DEFAULT '',
          role TEXT DEFAULT 'Plumbing Technician',
          trade TEXT DEFAULT 'Plumbing',
          status TEXT DEFAULT 'Available',
          active_jobs INTEGER DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);

      // 7. Audit Logs Table (Maintained for backward compatibility)
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS audit_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          log_id TEXT UNIQUE NOT NULL,
          timestamp TEXT NOT NULL,
          lead_id TEXT DEFAULT 'SYSTEM',
          step TEXT NOT NULL,
          outcome TEXT NOT NULL,
          details TEXT DEFAULT ''
        );
      `);

      // Migrations for existing databases
      try { this.db.exec('ALTER TABLE leads ADD COLUMN customer_id INTEGER DEFAULT NULL;'); } catch (e) {}
      try { this.db.exec('ALTER TABLE leads ADD COLUMN assigned_staff_id INTEGER DEFAULT NULL;'); } catch (e) {}
      try { this.db.exec('ALTER TABLE leads ADD COLUMN customer_notes TEXT DEFAULT "";'); } catch (e) {}

      // Indexes for fast lookup
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
        CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
        CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
        CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);
        CREATE INDEX IF NOT EXISTS idx_leads_lead_id ON leads(lead_id);
        CREATE INDEX IF NOT EXISTS idx_leads_customer_id ON leads(customer_id);
        CREATE INDEX IF NOT EXISTS idx_leads_staff_id ON leads(assigned_staff_id);
        CREATE INDEX IF NOT EXISTS idx_status_log_entity ON status_log(entity_type, entity_id);
        CREATE INDEX IF NOT EXISTS idx_leave_staff ON leave_requests(staff_id);
      `);

      // Seed baseline data if users or services are empty
      const userCount = this.db.prepare('SELECT COUNT(*) as count FROM users').get().count;
      if (userCount === 0) {
        this.seedBaselineUsers();
      }

      const serviceCount = this.db.prepare('SELECT COUNT(*) as count FROM services').get().count;
      if (serviceCount === 0) {
        this.seedBaselineServices();
      }

      const leadCount = this.db.prepare('SELECT COUNT(*) as count FROM leads').get().count;
      if (leadCount === 0) {
        this.seedBaselineLeads();
      }

      const leaveCount = this.db.prepare('SELECT COUNT(*) as count FROM leave_requests').get().count;
      if (leaveCount === 0) {
        this.seedBaselineLeaveRequests();
      }

      const techCount = this.db.prepare('SELECT COUNT(*) as count FROM technicians').get().count;
      if (techCount === 0) {
        this.seedBaselineTechnicians();
      }
    } catch (err) {
      console.error('[Custom SQLite Relational CRM] Initialization Error:', err);
    }
  }

  /* ============================================================================
     BASELINE DATA SEEDING (FOR DEMO RESET & INITIALIZATION)
     ============================================================================ */

  seedBaselineUsers() {
    const baseline = [
      {
        user_id: 'USR-ADM-01',
        name: 'Admin Dispatcher',
        email: 'admin@apexelite.demo',
        phone: '+1 (555) 019-8888',
        role: 'admin',
        active: 1,
      },
      {
        user_id: 'USR-STF-01',
        name: 'Dave Miller',
        email: 'dave@apexelite.demo',
        phone: '+1 (555) 019-8801',
        role: 'staff',
        active: 1,
      },
      {
        user_id: 'USR-STF-02',
        name: 'Carlos Rivera',
        email: 'carlos@apexelite.demo',
        phone: '+1 (555) 019-8802',
        role: 'staff',
        active: 1,
      },
      {
        user_id: 'USR-STF-03',
        name: 'Alex Chen',
        email: 'alex@apexelite.demo',
        phone: '+1 (555) 019-8803',
        role: 'staff',
        active: 1,
      },
      {
        user_id: 'USR-STF-04',
        name: 'Jordan Vance',
        email: 'jordan@apexelite.demo',
        phone: '+1 (555) 019-8804',
        role: 'staff',
        active: 1,
      },
      {
        user_id: 'USR-CST-01',
        name: 'Robert King',
        email: 'robert.k@gmail.com',
        phone: '+15557891234',
        role: 'customer',
        active: 1,
      },
      {
        user_id: 'USR-CST-02',
        name: 'Sarah Jenkins',
        email: 'sjenkins@gmail.com',
        phone: '+15552349876',
        role: 'customer',
        active: 1,
      },
    ];

    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO users (user_id, name, email, phone, role, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const u of baseline) {
      stmt.run(u.user_id, u.name, u.email, u.phone, u.role, u.active, now, now);
    }
  }

  seedBaselineServices() {
    const baseline = [
      {
        service_id: 'SRV-01',
        name: 'Burst Pipe Emergency & Repiping',
        description: '24/7 high-urgency water shutoff, leak tracing, and copper/PEX pipe repair',
        active: 1,
      },
      {
        service_id: 'SRV-02',
        name: 'Central AC & Heat Pump Repair',
        description: 'Emergency diagnostic, refrigerant leak detection, compressor & capacitor repair',
        active: 1,
      },
      {
        service_id: 'SRV-03',
        name: 'Water Heater Replacement',
        description: '50-gallon gas and tankless electric water heater installation & disposal',
        active: 1,
      },
      {
        service_id: 'SRV-04',
        name: 'Drain Cleaning & Hydro-Jetting',
        description: 'Sewer camera inspection, main line rooter, and high-pressure jetting',
        active: 1,
      },
      {
        service_id: 'SRV-05',
        name: 'Commercial Boiler Maintenance',
        description: 'Annual certified boiler inspection, burner tuning, pressure valve check',
        active: 1,
      },
      {
        service_id: 'SRV-06',
        name: 'Emergency Sewer & Main Line Backup',
        description: 'Immediate tree root clearing, video camera snake diagnostic, and hydro-scrubbing',
        active: 1,
      },
    ];

    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO services (service_id, name, description, active, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'admin', ?, ?)
    `);

    for (const s of baseline) {
      stmt.run(s.service_id, s.name, s.description, s.active, now, now);
    }
  }

  seedBaselineLeads() {
    const robert = this.getUser('robert.k@gmail.com');
    const sarah = this.getUser('sjenkins@gmail.com');
    const dave = this.getUser('dave@apexelite.demo');
    const alex = this.getUser('alex@apexelite.demo');

    const baseline = [
      {
        lead_id: 'LD-8041-PL',
        customer_id: robert ? robert.id : null,
        assigned_staff_id: dave ? dave.id : null,
        assigned_tech: dave ? dave.name : 'Dave Miller',
        name: 'Robert King',
        phone: '+15557891234',
        email: 'robert.k@gmail.com',
        location: '55 Garden Way',
        job_type: 'Plumbing',
        urgency: 'High',
        status: 'Booked',
        booked_slot: new Date(Date.now() + 86400000).toISOString(),
        description: 'Water heater leaking in basement. Requested prompt morning dispatch.',
        photo_links: '',
        next_action: 'Dispatch technician on schedule',
        source: 'ai_voice',
        recording_url: '',
        technician_notes: 'Gate code #4421. Shutoff valve is behind washing machine.',
        customer_notes: '',
        created_at: new Date(Date.now() - 7200000).toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        lead_id: 'LD-8042-HV',
        customer_id: sarah ? sarah.id : null,
        assigned_staff_id: 3,
        assigned_tech: 'Carlos Rivera',
        name: 'Sarah Jenkins',
        phone: '+15552349876',
        email: 'sjenkins@gmail.com',
        location: '124 Maple Blvd',
        job_type: 'HVAC',
        urgency: 'Emergency',
        status: 'Escalated to Human',
        booked_slot: '',
        description: 'Boiler making loud banging noises, no heat upstairs with freezing temps outside.',
        photo_links: '',
        next_action: 'Immediate emergency triage required',
        source: 'ai_voice',
        recording_url: '',
        technician_notes: 'Needs immediate technician callback before freeze damage.',
        customer_notes: '',
        created_at: new Date(Date.now() - 3600000).toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        lead_id: 'LD-8043-DC',
        customer_id: null,
        assigned_staff_id: 4, // Alex Chen
        assigned_tech: 'Alex Chen',
        name: 'Michael Vance',
        phone: '+15556784321',
        email: 'm.vance@outlook.com',
        location: '88 Oak Ridge Terrace',
        job_type: 'Drain Cleaning',
        urgency: 'Medium',
        status: 'Completed',
        booked_slot: new Date(Date.now() - 86400000).toISOString(),
        description: 'Main kitchen sink backed up and draining slowly.',
        photo_links: '',
        next_action: 'Review request sent / service completed',
        source: 'ai_chat',
        recording_url: '',
        technician_notes: 'Cleared grease trap blockage. 30-day warranty provided.',
        customer_notes: '',
        created_at: new Date(Date.now() - 172800000).toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    const stmt = this.db.prepare(`
      INSERT INTO leads (
        lead_id, customer_id, assigned_staff_id, assigned_tech, name, phone, email,
        location, job_type, urgency, status, booked_slot, description, photo_links,
        next_action, source, recording_url, technician_notes, customer_notes,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const l of baseline) {
      stmt.run(
        l.lead_id,
        l.customer_id,
        l.assigned_staff_id,
        l.assigned_tech,
        l.name,
        l.phone,
        l.email,
        l.location,
        l.job_type,
        l.urgency,
        l.status,
        l.booked_slot,
        l.description,
        l.photo_links,
        l.next_action,
        l.source,
        l.recording_url,
        l.technician_notes,
        l.customer_notes,
        l.created_at,
        l.updated_at
      );

      // Record initial status log
      this.logStatusChange({
        entityType: 'lead',
        entityId: l.lead_id,
        changedBy: 'AI Voice Receptionist',
        oldStatus: 'None',
        newStatus: l.status,
        note: `Initial intake recorded via ${l.source}`,
      });
    }
  }

  seedBaselineLeaveRequests() {
    const carlos = this.getUser('carlos@apexelite.demo');
    const jordan = this.getUser('jordan@apexelite.demo');

    const baseline = [
      {
        request_id: 'LV-REQ-101',
        staff_id: carlos ? carlos.id : 3,
        staff_name: carlos ? carlos.name : 'Carlos Rivera',
        start_date: '2026-09-25',
        end_date: '2026-09-27',
        reason: 'Annual HVAC Master Certification Seminar',
        status: 'Approved',
        requested_at: new Date(Date.now() - 86400000 * 2).toISOString(),
        reviewed_by: 'Admin Dispatcher',
        reviewed_at: new Date(Date.now() - 86400000).toISOString(),
        admin_notes: 'Approved. Advance schedule updated.',
      },
      {
        request_id: 'LV-REQ-102',
        staff_id: jordan ? jordan.id : 5,
        staff_name: jordan ? jordan.name : 'Jordan Vance',
        start_date: '2026-10-02',
        end_date: '2026-10-05',
        reason: 'Family wedding out of state',
        status: 'Pending',
        requested_at: new Date(Date.now() - 3600000 * 4).toISOString(),
        reviewed_by: '',
        reviewed_at: '',
        admin_notes: '',
      },
    ];

    const stmt = this.db.prepare(`
      INSERT INTO leave_requests (
        request_id, staff_id, staff_name, start_date, end_date, reason,
        status, requested_at, reviewed_by, reviewed_at, admin_notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const r of baseline) {
      stmt.run(
        r.request_id,
        r.staff_id,
        r.staff_name,
        r.start_date,
        r.end_date,
        r.reason,
        r.status,
        r.requested_at,
        r.reviewed_by,
        r.reviewed_at,
        r.admin_notes
      );
    }
  }

  seedBaselineTechnicians() {
    const baseline = [
      {
        tech_id: 'TECH-001',
        name: 'Dave Miller',
        phone: '+1 (555) 019-8801',
        email: 'dave@apexelite.demo',
        role: 'Master Plumber',
        trade: 'Plumbing & Gas',
        status: 'Available',
      },
      {
        tech_id: 'TECH-002',
        name: 'Carlos Rivera',
        phone: '+1 (555) 019-8802',
        email: 'carlos@apexelite.demo',
        role: 'Lead HVAC Specialist',
        trade: 'HVAC & Heating',
        status: 'On Job',
      },
      {
        tech_id: 'TECH-003',
        name: 'Alex Chen',
        phone: '+1 (555) 019-8803',
        email: 'alex@apexelite.demo',
        role: 'Emergency Drain Tech',
        trade: 'Drains & Sewer',
        status: 'Available',
      },
      {
        tech_id: 'TECH-004',
        name: 'Jordan Vance',
        phone: '+1 (555) 019-8804',
        email: 'jordan@apexelite.demo',
        role: 'Apprentice Tech',
        trade: 'General Maintenance',
        status: 'Off Duty',
      },
    ];

    const stmt = this.db.prepare(`
      INSERT INTO technicians (
        tech_id, name, phone, email, role, trade, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const now = new Date().toISOString();
    for (const t of baseline) {
      stmt.run(t.tech_id, t.name, t.phone, t.email, t.role, t.trade, t.status, now, now);
    }
  }

  /* ============================================================================
     NORMALIZATION & FORMATTING HELPERS
     ============================================================================ */

  formatLeadRow(row) {
    if (!row) return null;
    return {
      id: `rec_${row.id}`,
      rowId: row.id,
      leadId: row.lead_id,
      LeadID: row.lead_id,
      customerId: row.customer_id || null,
      customer_id: row.customer_id || null,
      assignedStaffId: row.assigned_staff_id || null,
      assigned_staff_id: row.assigned_staff_id || null,
      customerNotes: row.customer_notes || '',
      customer_notes: row.customer_notes || '',
      name: row.name,
      Name: row.name,
      phone: row.phone,
      Phone: row.phone,
      email: row.email,
      Email: row.email,
      location: row.location,
      Location: row.location,
      jobType: row.job_type,
      JobType: row.job_type,
      job_type: row.job_type,
      urgency: row.urgency,
      Urgency: row.urgency,
      status: row.status,
      Status: row.status,
      bookedSlot: row.booked_slot,
      BookedSlot: row.booked_slot,
      booked_slot: row.booked_slot,
      description: row.description,
      Description: row.description,
      photoLinks: row.photo_links,
      PhotoLinks: row.photo_links,
      nextAction: row.next_action,
      NextAction: row.next_action,
      source: row.source || 'ai_voice',
      Source: row.source || 'ai_voice',
      recordingUrl: row.recording_url,
      RecordingUrl: row.recording_url,
      technicianNotes: row.technician_notes,
      TechnicianNotes: row.technician_notes,
      assignedTech: row.assigned_tech || '',
      AssignedTech: row.assigned_tech || '',
      assigned_tech: row.assigned_tech || '',
      createdAt: row.created_at,
      CreatedAt: row.created_at,
      updatedAt: row.updated_at,
      UpdatedAt: row.updated_at,
      _layer: 'Enterprise SQLite CRM (Multi-Role Enabled)',
    };
  }

  /* ============================================================================
     USERS & ROLE-BASED ACCESS REPOSITORY
     ============================================================================ */

  listUsers({ role, activeOnly = false } = {}) {
    let sql = 'SELECT * FROM users';
    const conditions = [];
    const params = [];

    if (role) {
      conditions.push('role = ?');
      params.push(role);
    }
    if (activeOnly) {
      conditions.push('active = 1');
    }

    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`;
    }
    sql += ' ORDER BY role ASC, name ASC';

    return this.db.prepare(sql).all(...params);
  }

  getUser(idOrEmailOrPhone) {
    if (!idOrEmailOrPhone) return null;
    let row = null;
    if (typeof idOrEmailOrPhone === 'number' || /^\d+$/.test(String(idOrEmailOrPhone))) {
      row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(Number(idOrEmailOrPhone));
    }
    if (!row) {
      row = this.db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(String(idOrEmailOrPhone).trim());
    }
    if (!row) {
      const cleanPhone = String(idOrEmailOrPhone).replace(/[^\d+]/g, '');
      if (cleanPhone.length >= 6) {
        const rows = this.db.prepare('SELECT * FROM users').all();
        row = rows.find((u) => (u.phone || '').replace(/[^\d+]/g, '') === cleanPhone);
      }
    }
    return row || null;
  }

  createUser(userData) {
    const now = new Date().toISOString();
    const userId = userData.user_id || userData.userId || `USR-${(userData.role || 'CST').toUpperCase().slice(0, 3)}-${Date.now().toString(36).toUpperCase()}`;
    const name = userData.name || 'Anonymous User';
    const email = userData.email || `${userId.toLowerCase()}@apexelite.demo`;
    const phone = userData.phone || '';
    const role = userData.role || 'customer';
    const active = userData.active !== undefined ? (userData.active ? 1 : 0) : 1;

    const stmt = this.db.prepare(`
      INSERT INTO users (user_id, name, email, phone, role, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(userId, name, email, phone, role, active, now, now);
    return this.getUser(result.lastInsertRowid);
  }

  updateUser(id, updates) {
    const user = this.getUser(id);
    if (!user) return null;

    const fields = [];
    const values = [];

    if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
    if (updates.phone !== undefined) { fields.push('phone = ?'); values.push(updates.phone); }
    if (updates.role !== undefined) { fields.push('role = ?'); values.push(updates.role); }
    if (updates.active !== undefined) { fields.push('active = ?'); values.push(updates.active ? 1 : 0); }

    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(user.id);

    this.db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return this.getUser(user.id);
  }

  deleteUser(id) {
    // Soft delete: sets active = 0 to preserve audit history
    return this.updateUser(id, { active: 0 });
  }

  /* ============================================================================
     SERVICES CATALOG REPOSITORY (DRIVES AI PROMPT & CUSTOMER VIEWS)
     ============================================================================ */

  listServices({ activeOnly = false } = {}) {
    let sql = 'SELECT * FROM services';
    if (activeOnly) {
      sql += ' WHERE active = 1';
    }
    sql += ' ORDER BY id ASC';
    return this.db.prepare(sql).all();
  }

  getService(idOrServiceId) {
    let row = null;
    if (/^\d+$/.test(String(idOrServiceId))) {
      row = this.db.prepare('SELECT * FROM services WHERE id = ?').get(Number(idOrServiceId));
    }
    if (!row) {
      row = this.db.prepare('SELECT * FROM services WHERE service_id = ?').get(String(idOrServiceId));
    }
    return row || null;
  }

  createService(data) {
    const now = new Date().toISOString();
    const serviceId = data.service_id || `SRV-${Date.now().toString(36).toUpperCase()}`;
    const name = data.name || 'New Service';
    const description = data.description || '';
    const active = data.active !== undefined ? (data.active ? 1 : 0) : 1;
    const createdBy = data.created_by || 'admin';

    const stmt = this.db.prepare(`
      INSERT INTO services (service_id, name, description, active, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(serviceId, name, description, active, createdBy, now, now);
    return this.getService(result.lastInsertRowid);
  }

  updateService(id, updates) {
    const service = this.getService(id);
    if (!service) return null;

    const fields = [];
    const values = [];

    if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
    if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description); }
    if (updates.active !== undefined) { fields.push('active = ?'); values.push(updates.active ? 1 : 0); }

    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(service.id);

    this.db.prepare(`UPDATE services SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return this.getService(service.id);
  }

  deleteService(id) {
    const service = this.getService(id);
    if (!service) return false;
    this.db.prepare('DELETE FROM services WHERE id = ?').run(service.id);
    return true;
  }

  /* ============================================================================
     LEAVE REQUESTS REPOSITORY
     ============================================================================ */

  listLeaveRequests({ staffId = null } = {}) {
    let sql = 'SELECT * FROM leave_requests';
    const params = [];

    if (staffId) {
      sql += ' WHERE staff_id = ?';
      params.push(Number(staffId));
    }
    sql += ' ORDER BY requested_at DESC';

    return this.db.prepare(sql).all(...params);
  }

  getLeaveRequest(idOrRequestId) {
    let row = null;
    if (/^\d+$/.test(String(idOrRequestId))) {
      row = this.db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(Number(idOrRequestId));
    }
    if (!row) {
      row = this.db.prepare('SELECT * FROM leave_requests WHERE request_id = ?').get(String(idOrRequestId));
    }
    return row || null;
  }

  createLeaveRequest(data) {
    const now = new Date().toISOString();
    const requestId = `LV-REQ-${Date.now().toString(36).toUpperCase()}`;
    const staffId = Number(data.staff_id || data.staffId);
    const staffName = data.staff_name || data.staffName || 'Staff Technician';
    const startDate = data.start_date || data.startDate || now.slice(0, 10);
    const endDate = data.end_date || data.endDate || startDate;
    const reason = data.reason || 'Personal Leave';

    const stmt = this.db.prepare(`
      INSERT INTO leave_requests (
        request_id, staff_id, staff_name, start_date, end_date, reason,
        status, requested_at, reviewed_by, reviewed_at, admin_notes
      ) VALUES (?, ?, ?, ?, ?, ?, 'Pending', ?, '', '', '')
    `);

    const result = stmt.run(requestId, staffId, staffName, startDate, endDate, reason, now);

    this.logStatusChange({
      entityType: 'leave_request',
      entityId: requestId,
      changedBy: staffName,
      oldStatus: 'None',
      newStatus: 'Pending',
      note: `Leave requested for ${startDate} to ${endDate}: ${reason}`,
    });

    return this.getLeaveRequest(result.lastInsertRowid);
  }

  updateLeaveRequest(id, updates) {
    const req = this.getLeaveRequest(id);
    if (!req) return null;

    const fields = [];
    const values = [];

    if (updates.status !== undefined) {
      fields.push('status = ?');
      values.push(updates.status);
    }
    if (updates.reviewed_by !== undefined || updates.reviewedBy !== undefined) {
      fields.push('reviewed_by = ?');
      values.push(updates.reviewed_by ?? updates.reviewedBy);
    }
    if (updates.admin_notes !== undefined || updates.adminNotes !== undefined) {
      fields.push('admin_notes = ?');
      values.push(updates.admin_notes ?? updates.adminNotes);
    }

    fields.push('reviewed_at = ?');
    values.push(new Date().toISOString());
    values.push(req.id);

    this.db.prepare(`UPDATE leave_requests SET ${fields.join(', ')} WHERE id = ?`).run(...values);

    if (updates.status && updates.status !== req.status) {
      this.logStatusChange({
        entityType: 'leave_request',
        entityId: req.request_id,
        changedBy: updates.reviewed_by || updates.reviewedBy || 'Admin Dispatcher',
        oldStatus: req.status,
        newStatus: updates.status,
        note: updates.admin_notes || updates.adminNotes || `Leave request marked ${updates.status}`,
      });
    }

    return this.getLeaveRequest(req.id);
  }

  /* ============================================================================
     STATUS LOG AUDIT TRAIL REPOSITORY
     ============================================================================ */

  logStatusChange({ entityType, entityId, changedBy, oldStatus, newStatus, note = '' }) {
    const now = new Date().toISOString();
    const logId = `stat_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;

    const stmt = this.db.prepare(`
      INSERT INTO status_log (log_id, entity_type, entity_id, changed_by, old_status, new_status, note, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(logId, entityType, entityId, changedBy, oldStatus, newStatus, note, now);

    return {
      id: logId,
      logId,
      entityType,
      entityId,
      changedBy,
      oldStatus,
      newStatus,
      note,
      timestamp: now,
    };
  }

  listStatusLogs({ entityId = null, entityType = null, limit = 100 } = {}) {
    let sql = 'SELECT * FROM status_log';
    const conditions = [];
    const params = [];

    if (entityType) {
      conditions.push('entity_type = ?');
      params.push(entityType);
    }
    if (entityId) {
      conditions.push('entity_id = ?');
      params.push(String(entityId));
    }

    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`;
    }
    sql += ' ORDER BY timestamp DESC, id DESC LIMIT ?';
    params.push(limit);

    return this.db.prepare(sql).all(...params);
  }

  /* ============================================================================
     LEADS CRM REPOSITORY (RBAC SCOPED)
     ============================================================================ */

  createLead(leadData) {
    const now = new Date().toISOString();
    const leadId = leadData.lead_id || leadData.leadId || leadData.LeadID || `LD-${Date.now().toString(36).toUpperCase()}`;
    const name = leadData.name || leadData.Name || 'Unknown Caller';
    const phone = leadData.phone || leadData.Phone || '';
    const email = leadData.email || leadData.Email || '';
    const location = leadData.location || leadData.Location || '';
    const jobType = leadData.job_type || leadData.jobType || leadData.JobType || 'General Plumbing';
    const urgency = leadData.urgency || leadData.Urgency || 'Medium';
    const status = leadData.status || leadData.Status || 'New Lead';
    const bookedSlot = leadData.booked_slot || leadData.bookedSlot || leadData.BookedSlot || '';
    const description = leadData.description || leadData.Description || '';
    const photoLinks = Array.isArray(leadData.photo_links || leadData.PhotoLinks)
      ? (leadData.photo_links || leadData.PhotoLinks).join(', ')
      : (leadData.photo_links || leadData.PhotoLinks || '');
    const nextAction = leadData.next_action || leadData.nextAction || leadData.NextAction || 'Schedule appointment';
    const source = leadData.source || leadData.Source || 'ai_voice';
    const recordingUrl = leadData.recording_url || leadData.recordingUrl || leadData.RecordingUrl || '';
    const technicianNotes = leadData.technician_notes || leadData.technicianNotes || leadData.TechnicianNotes || '';
    const customerNotes = leadData.customer_notes || leadData.customerNotes || leadData.CustomerNotes || '';
    const assignedTech = leadData.assigned_tech || leadData.assignedTech || leadData.AssignedTech || '';

    // Automatically resolve customer_id if phone/email matches existing user
    let customerId = leadData.customer_id || leadData.customerId || null;
    if (!customerId && (phone || email)) {
      const matchUser = this.getUser(phone || email);
      if (matchUser && matchUser.role === 'customer') {
        customerId = matchUser.id;
      }
    }

    // Resolve assigned_staff_id if assignedTech matches a staff member
    let assignedStaffId = leadData.assigned_staff_id || leadData.assignedStaffId || null;
    if (!assignedStaffId && assignedTech) {
      const matchStaff = this.getUser(assignedTech);
      if (matchStaff && matchStaff.role === 'staff') {
        assignedStaffId = matchStaff.id;
      }
    }

    const stmt = this.db.prepare(`
      INSERT INTO leads (
        lead_id, customer_id, assigned_staff_id, assigned_tech, name, phone, email,
        location, job_type, urgency, status, booked_slot, description, photo_links,
        next_action, source, recording_url, technician_notes, customer_notes,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      leadId,
      customerId,
      assignedStaffId,
      assignedTech,
      name,
      phone,
      email,
      location,
      jobType,
      urgency,
      status,
      bookedSlot,
      description,
      photoLinks,
      nextAction,
      source,
      recordingUrl,
      technicianNotes,
      customerNotes,
      now,
      now
    );

    // Write initial status audit log
    this.logStatusChange({
      entityType: 'lead',
      entityId: leadId,
      changedBy: leadData.createdBy || (source.startsWith('ai') ? 'AI Voice Receptionist' : 'Dispatcher'),
      oldStatus: 'None',
      newStatus: status,
      note: `Inbound lead created via ${source}`,
    });

    const createdRow = this.db.prepare('SELECT * FROM leads WHERE id = ?').get(result.lastInsertRowid);
    return this.formatLeadRow(createdRow);
  }

  updateLead(leadIdOrRecordId, updates) {
    const existing = this.getLead(leadIdOrRecordId);
    if (!existing) return null;

    const mapped = {};
    if (updates.name !== undefined || updates.Name !== undefined) mapped.name = updates.name ?? updates.Name;
    if (updates.phone !== undefined || updates.Phone !== undefined) mapped.phone = updates.phone ?? updates.Phone;
    if (updates.email !== undefined || updates.Email !== undefined) mapped.email = updates.email ?? updates.Email;
    if (updates.location !== undefined || updates.Location !== undefined) mapped.location = updates.location ?? updates.Location;
    if (updates.job_type !== undefined || updates.jobType !== undefined || updates.JobType !== undefined) {
      mapped.job_type = updates.job_type ?? updates.jobType ?? updates.JobType;
    }
    if (updates.urgency !== undefined || updates.Urgency !== undefined) mapped.urgency = updates.urgency ?? updates.Urgency;
    if (updates.status !== undefined || updates.Status !== undefined) mapped.status = updates.status ?? updates.Status;
    if (updates.booked_slot !== undefined || updates.bookedSlot !== undefined || updates.BookedSlot !== undefined) {
      mapped.booked_slot = updates.booked_slot ?? updates.bookedSlot ?? updates.BookedSlot;
    }
    if (updates.description !== undefined || updates.Description !== undefined) mapped.description = updates.description ?? updates.Description;
    if (updates.photo_links !== undefined || updates.PhotoLinks !== undefined) {
      mapped.photo_links = Array.isArray(updates.photo_links ?? updates.PhotoLinks)
        ? (updates.photo_links ?? updates.PhotoLinks).join(', ')
        : (updates.photo_links ?? updates.PhotoLinks);
    }
    if (updates.next_action !== undefined || updates.nextAction !== undefined || updates.NextAction !== undefined) {
      mapped.next_action = updates.next_action ?? updates.nextAction ?? updates.NextAction;
    }
    if (updates.source !== undefined || updates.Source !== undefined) mapped.source = updates.source ?? updates.Source;
    if (updates.recording_url !== undefined || updates.recordingUrl !== undefined || updates.RecordingUrl !== undefined) {
      mapped.recording_url = updates.recording_url ?? updates.recordingUrl ?? updates.RecordingUrl;
    }
    if (updates.technician_notes !== undefined || updates.technicianNotes !== undefined || updates.TechnicianNotes !== undefined) {
      mapped.technician_notes = updates.technician_notes ?? updates.technicianNotes ?? updates.TechnicianNotes;
    }
    if (updates.customer_notes !== undefined || updates.customerNotes !== undefined || updates.CustomerNotes !== undefined) {
      mapped.customer_notes = updates.customer_notes ?? updates.customerNotes ?? updates.CustomerNotes;
    }
    if (updates.assigned_tech !== undefined || updates.assignedTech !== undefined || updates.AssignedTech !== undefined) {
      mapped.assigned_tech = updates.assigned_tech ?? updates.assignedTech ?? updates.AssignedTech;
      const techUser = this.getUser(mapped.assigned_tech);
      if (techUser && techUser.role === 'staff') {
        mapped.assigned_staff_id = techUser.id;
      }
    }
    if (updates.assigned_staff_id !== undefined || updates.assignedStaffId !== undefined) {
      mapped.assigned_staff_id = updates.assigned_staff_id ?? updates.assignedStaffId;
      const staffUser = this.getUser(mapped.assigned_staff_id);
      if (staffUser) {
        mapped.assigned_tech = staffUser.name;
      }
    }
    if (updates.customer_id !== undefined || updates.customerId !== undefined) {
      mapped.customer_id = updates.customer_id ?? updates.customerId;
    }

    mapped.updated_at = new Date().toISOString();

    const keys = Object.keys(mapped);
    if (keys.length === 0) return existing;

    const setClause = keys.map((k) => `${k} = ?`).join(', ');
    const values = keys.map((k) => mapped[k]);
    values.push(existing.rowId);

    const stmt = this.db.prepare(`UPDATE leads SET ${setClause} WHERE id = ?`);
    stmt.run(...values);

    // Audit trail for status change
    if (mapped.status && mapped.status !== existing.status) {
      this.logStatusChange({
        entityType: 'lead',
        entityId: existing.leadId,
        changedBy: updates.changedBy || updates.changed_by || 'Staff/Admin',
        oldStatus: existing.status,
        newStatus: mapped.status,
        note: updates.statusNote || updates.note || `Status transition from ${existing.status} to ${mapped.status}`,
      });
    }

    const updatedRow = this.db.prepare('SELECT * FROM leads WHERE id = ?').get(existing.rowId);
    return this.formatLeadRow(updatedRow);
  }

  deleteLead(leadIdOrRecordId) {
    const existing = this.getLead(leadIdOrRecordId);
    if (!existing) return false;

    const stmt = this.db.prepare('DELETE FROM leads WHERE id = ?');
    stmt.run(existing.rowId);
    return true;
  }

  getLead(leadIdOrRecordId) {
    if (!leadIdOrRecordId) return null;
    let row = null;
    if (String(leadIdOrRecordId).startsWith('rec_')) {
      const numId = parseInt(String(leadIdOrRecordId).replace('rec_', ''), 10);
      if (!isNaN(numId)) {
        row = this.db.prepare('SELECT * FROM leads WHERE id = ?').get(numId);
      }
    }
    if (!row) {
      row = this.db.prepare('SELECT * FROM leads WHERE lead_id = ?').get(String(leadIdOrRecordId));
    }
    return this.formatLeadRow(row);
  }

  findLeadByPhone(phone) {
    if (!phone) return null;
    const clean = phone.replace(/[^\d+]/g, '');
    const rows = this.db.prepare('SELECT * FROM leads').all();
    const match = rows.find((r) => (r.phone || '').replace(/[^\d+]/g, '') === clean);
    return this.formatLeadRow(match);
  }

  /**
   * Scoped lead query with Role-Based Access Control (RBAC)
   */
  listLeadsScoped({ user, limit = 100 } = {}) {
    // Admin sees all leads
    if (user && user.role === 'admin') {
      const rows = this.db.prepare('SELECT * FROM leads ORDER BY created_at DESC LIMIT ?').all(limit);
      return rows.map((r) => this.formatLeadRow(r));
    }

    // Staff technician: ONLY see jobs assigned to them
    if (user.role === 'staff') {
      const rows = this.db.prepare(`
        SELECT * FROM leads 
        WHERE assigned_staff_id = ? OR assigned_tech = ? 
        ORDER BY created_at DESC LIMIT ?
      `).all(user.id, user.name, limit);
      return rows.map((r) => this.formatLeadRow(r));
    }

    // Customer: ONLY see jobs belonging to them
    if (user.role === 'customer') {
      const cleanPhone = (user.phone || '').replace(/[^\d+]/g, '');
      const rows = this.db.prepare(`
        SELECT * FROM leads 
        WHERE customer_id = ? OR email = ? COLLATE NOCASE
        ORDER BY created_at DESC LIMIT ?
      `).all(user.id, user.email, limit);

      // Also check phone match if set
      const allCustomerLeads = [...rows];
      if (cleanPhone) {
        const phoneMatches = this.db.prepare('SELECT * FROM leads').all().filter((l) => (l.phone || '').replace(/[^\d+]/g, '') === cleanPhone);
        for (const pm of phoneMatches) {
          if (!allCustomerLeads.some((l) => l.id === pm.id)) {
            allCustomerLeads.push(pm);
          }
        }
      }

      return allCustomerLeads.slice(0, limit).map((r) => {
        const formatted = this.formatLeadRow(r);
        // Anonymize staff name to first name only for customer view (spec requirement)
        if (formatted.assignedTech) {
          const parts = formatted.assignedTech.split(' ');
          formatted.assignedTech = parts.length > 1 ? `${parts[0]} ${parts[1][0]}.` : parts[0];
          formatted.AssignedTech = formatted.assignedTech;
        }
        return formatted;
      });
    }

    return [];
  }

  listLeads(limit = 100) {
    const rows = this.db.prepare('SELECT * FROM leads ORDER BY created_at DESC LIMIT ?').all(limit);
    return rows.map((r) => this.formatLeadRow(r));
  }

  /* ============================================================================
     TECHNICIAN & AUDIT LOGS (BACKWARD COMPATIBILITY)
     ============================================================================ */

  listTechnicians() {
    const rows = this.db.prepare('SELECT * FROM technicians ORDER BY name ASC').all();
    
    // Calculate active job load dynamically from open leads
    const jobCounts = this.db.prepare(`
      SELECT assigned_tech, COUNT(*) as count 
      FROM leads 
      WHERE status NOT IN ('Completed', 'Closed') AND assigned_tech IS NOT NULL AND assigned_tech != ''
      GROUP BY assigned_tech
    `).all();

    const countMap = {};
    for (const j of jobCounts) {
      countMap[j.assigned_tech] = j.count;
    }

    return rows.map((r) => ({
      id: r.id,
      techId: r.tech_id,
      name: r.name,
      phone: r.phone,
      email: r.email,
      role: r.role,
      trade: r.trade,
      status: r.status,
      activeJobs: countMap[r.name] || 0,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  updateTechnicianStatus(techIdOrId, newStatus) {
    let tech = null;
    if (typeof techIdOrId === 'number' || /^\d+$/.test(String(techIdOrId))) {
      tech = this.db.prepare('SELECT * FROM technicians WHERE id = ?').get(Number(techIdOrId));
    } else {
      tech = this.db.prepare('SELECT * FROM technicians WHERE tech_id = ?').get(String(techIdOrId));
    }
    if (!tech) return null;

    const now = new Date().toISOString();
    this.db.prepare('UPDATE technicians SET status = ?, updated_at = ? WHERE id = ?').run(newStatus, now, tech.id);
    return { ...tech, status: newStatus, updatedAt: now };
  }

  addTechnician(data) {
    const now = new Date().toISOString();
    const techId = `TECH-${Date.now().toString().slice(-4)}`;
    const name = data.name || 'New Technician';
    const phone = data.phone || '+1 (555) 019-0000';
    const email = data.email || '';
    const role = data.role || 'Service Tech';
    const trade = data.trade || 'General Plumbing';
    const status = data.status || 'Available';

    const stmt = this.db.prepare(`
      INSERT INTO technicians (tech_id, name, phone, email, role, trade, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(techId, name, phone, email, role, trade, status, now, now);

    // Also add to users table as staff
    this.createUser({
      name,
      email: email || `${name.toLowerCase().replace(/\s+/g, '.')}@apexelite.demo`,
      phone,
      role: 'staff',
    });

    return this.listTechnicians().find((t) => t.techId === techId);
  }

  deleteTechnician(techIdOrId) {
    let tech = null;
    if (typeof techIdOrId === 'number' || /^\d+$/.test(String(techIdOrId))) {
      tech = this.db.prepare('SELECT * FROM technicians WHERE id = ?').get(Number(techIdOrId));
    } else {
      tech = this.db.prepare('SELECT * FROM technicians WHERE tech_id = ?').get(String(techIdOrId));
    }
    if (!tech) return false;

    this.db.prepare('DELETE FROM technicians WHERE id = ?').run(tech.id);
    return true;
  }

  findAvailableTechForJob(jobType = '') {
    const allTechs = this.listTechnicians();
    const onDutyTechs = allTechs.filter((t) => t.status !== 'Off Duty');
    if (onDutyTechs.length === 0) return null;

    // 1. Same trade & Available
    const directMatch = onDutyTechs.find(
      (t) => t.status === 'Available' && t.trade.toLowerCase().includes(jobType.toLowerCase())
    );
    if (directMatch) return directMatch;

    // 2. Any Available tech
    const anyAvailable = onDutyTechs.find((t) => t.status === 'Available');
    if (anyAvailable) return anyAvailable;

    // 3. Lowest active workload
    onDutyTechs.sort((a, b) => a.activeJobs - b.activeJobs);
    return onDutyTechs[0];
  }

  logStep({ leadId, step, outcome, details }) {
    const now = new Date().toISOString();
    const logId = `log_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
    const detailsStr = typeof details === 'object' ? JSON.stringify(details) : String(details || '');

    const stmt = this.db.prepare(`
      INSERT INTO audit_logs (log_id, timestamp, lead_id, step, outcome, details)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(logId, now, leadId || 'SYSTEM', step, outcome, detailsStr);

    return {
      id: logId,
      fields: {
        Timestamp: now,
        LeadID: leadId || 'SYSTEM',
        Step: step,
        Outcome: outcome,
        Details: detailsStr,
      },
    };
  }

  listLogs(limit = 100) {
    const rows = this.db.prepare('SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT ?').all(limit);
    return rows.map((r) => ({
      id: r.log_id,
      Timestamp: r.timestamp,
      LeadID: r.lead_id,
      Step: r.step,
      Outcome: r.outcome,
      Details: r.details,
      fields: {
        Timestamp: r.timestamp,
        LeadID: r.lead_id,
        Step: r.step,
        Outcome: r.outcome,
        Details: r.details,
      },
    }));
  }

  /* ============================================================================
     TECHNICIAN & DISPATCH HELPERS
     ============================================================================ */

  findBestAvailableTechnician(trade = 'Plumbing', location = '') {
    const rawTrade = (trade || '').toLowerCase();

    // Map trade/issue keywords to technician database specialties
    let matchedTradePattern = '%Plumb%';
    if (rawTrade.includes('hvac') || rawTrade.includes('heat') || rawTrade.includes('ac') || rawTrade.includes('air') || rawTrade.includes('cool') || rawTrade.includes('furnace') || rawTrade.includes('boiler')) {
      matchedTradePattern = '%HVAC%';
    } else if (rawTrade.includes('drain') || rawTrade.includes('sewer') || rawTrade.includes('clog') || rawTrade.includes('rooter') || rawTrade.includes('jet') || rawTrade.includes('pipe rupture') || rawTrade.includes('flooding')) {
      matchedTradePattern = '%Drain%';
    } else if (rawTrade.includes('electric') || rawTrade.includes('wire') || rawTrade.includes('breaker') || rawTrade.includes('panel')) {
      matchedTradePattern = '%Elect%';
    }

    // Proximity / Nearby Check: Check if a field technician is already dispatched or active near the service location
    const locClean = (location || '').trim();
    if (locClean.length >= 3) {
      const tokens = locClean.split(/[\s,]+/).filter(w => w.length > 3 && !/^\d+$/.test(w) && !['street', 'drive', 'avenue', 'lane', 'road', 'blvd', 'court', 'terrace', 'way'].includes(w.toLowerCase()));
      for (const token of tokens) {
        try {
          const activeNearby = this.db.prepare(`
            SELECT assigned_tech FROM leads 
            WHERE status IN ('In Progress', 'Dispatched', 'Booked') 
              AND assigned_tech != '' 
              AND location LIKE ?
            ORDER BY id DESC LIMIT 1
          `).get(`%${token}%`);
          if (activeNearby && activeNearby.assigned_tech) {
            const nearbyTech = this.db.prepare(`
              SELECT * FROM technicians 
              WHERE name = ? AND status IN ('Available', 'On Job')
              LIMIT 1
            `).get(activeNearby.assigned_tech);
            if (nearbyTech) {
              nearbyTech.proximityTier = `Nearby Field Technician (Active near ${token})`;
              return nearbyTech;
            }
          }
        } catch (e) {}
      }
    }

    // 1. Prioritize strictly 'Available' technician in the matching trade specialty
    let tech = this.db.prepare(`
      SELECT * FROM technicians 
      WHERE status = 'Available' AND trade LIKE ?
      ORDER BY active_jobs ASC 
      LIMIT 1
    `).get(matchedTradePattern);

    if (tech) {
      tech.proximityTier = 'Available Specialty Match';
      return tech;
    }

    // 2. Fall back to any 'Available' technician with the lowest job load
    tech = this.db.prepare(`
      SELECT * FROM technicians 
      WHERE status = 'Available'
      ORDER BY (CASE WHEN trade LIKE ? THEN 0 ELSE 1 END), active_jobs ASC 
      LIMIT 1
    `).get(matchedTradePattern);

    if (tech) {
      tech.proximityTier = 'Available Technician (Lowest Load)';
      return tech;
    }

    // 3. If none strictly 'Available', assign the nearby active technician in field ('On Job') with lowest active jobs
    tech = this.db.prepare(`
      SELECT * FROM technicians 
      WHERE status = 'On Job'
      ORDER BY (CASE WHEN trade LIKE ? THEN 0 ELSE 1 END), active_jobs ASC 
      LIMIT 1
    `).get(matchedTradePattern);

    if (tech) {
      tech.proximityTier = 'In-Field Active Technician Dispatch';
      return tech;
    }

    // 4. Fall back to active staff in users table
    const staff = this.db.prepare(`
      SELECT * FROM users 
      WHERE role = 'staff' AND active = 1
      ORDER BY id ASC
      LIMIT 1
    `).get();

    if (staff) {
      return {
        id: staff.id,
        tech_id: `TECH-STAFF-${staff.id}`,
        name: staff.name,
        phone: staff.phone,
        email: staff.email,
        role: 'Staff Technician',
        trade: trade || 'Plumbing',
        status: 'Available',
        active_jobs: 0,
        proximityTier: 'Active Staff Member',
      };
    }

    return null;
  }

  findLeadById(id) {
    return this.getLead(id);
  }

  assignLeadToTechnician(leadId, techName) {
    const lead = this.getLead(leadId);
    if (!lead) return null;

    const staff = this.db.prepare("SELECT * FROM users WHERE name = ? AND role = 'staff'").get(techName);
    const staffId = staff ? staff.id : null;

    this.db.prepare(`
      UPDATE leads 
      SET assigned_tech = ?, assigned_staff_id = ?, updated_at = ?
      WHERE id = ? OR lead_id = ?
    `).run(techName, staffId, new Date().toISOString(), lead.id, lead.LeadID || leadId);

    try {
      this.db.prepare('UPDATE technicians SET active_jobs = active_jobs + 1 WHERE name = ?').run(techName);
    } catch (e) {}

    this.logStatusChange({
      entityType: 'lead',
      entityId: lead.LeadID || String(lead.id),
      changedBy: 'System Auto-Dispatch',
      oldStatus: lead.Status || lead.status,
      newStatus: lead.Status || lead.status,
      note: `Assigned to technician ${techName}`,
    });

    return this.getLead(leadId);
  }

  /* ============================================================================
     ONE-CLICK DEMO RESET
     ============================================================================ */

  clearData(options = {}) {
    const reseed = typeof options === 'boolean' ? options : (options && options.reseed === true);
    const count = this.db.prepare('SELECT COUNT(*) as count FROM leads').get().count;

    // Clear operational tables
    this.db.exec('DELETE FROM leads;');
    this.db.exec('DELETE FROM audit_logs;');
    this.db.exec('DELETE FROM leave_requests;');
    this.db.exec('DELETE FROM status_log;');
    this.db.exec('DELETE FROM services;');
    this.db.exec('DELETE FROM users;');
    this.db.exec('DELETE FROM technicians;');

    try {
      this.db.exec("DELETE FROM sqlite_sequence WHERE name IN ('users', 'leads', 'services', 'leave_requests', 'status_log', 'technicians', 'audit_logs');");
    } catch (e) {}

    // Always reseed users & services so the system remains fully functional
    this.seedBaselineUsers();
    this.seedBaselineServices();
    this.seedBaselineTechnicians();

    // Only reseed demo leads and demo leave requests if reseed is explicitly true
    if (reseed) {
      this.seedBaselineLeads();
      this.seedBaselineLeaveRequests();
    }

    return { clearedLeads: count, success: true };
  }

  exportCSV() {
    const leads = this.listLeads(1000);
    const headers = [
      'Lead ID',
      'Name',
      'Phone',
      'Email',
      'Location',
      'Job Type',
      'Urgency',
      'Status',
      'Booked Slot',
      'Assigned Tech',
      'Source',
      'Technician Notes',
      'Customer Notes',
      'Description',
      'Created At',
    ];

    const escapeCsv = (str) => {
      if (str === null || str === undefined) return '""';
      const val = String(str).replace(/"/g, '""');
      return `"${val}"`;
    };

    const rows = leads.map((l) => [
      escapeCsv(l.LeadID),
      escapeCsv(l.Name),
      escapeCsv(l.Phone),
      escapeCsv(l.Email),
      escapeCsv(l.Location),
      escapeCsv(l.JobType),
      escapeCsv(l.Urgency),
      escapeCsv(l.Status),
      escapeCsv(l.BookedSlot),
      escapeCsv(l.AssignedTech),
      escapeCsv(l.Source),
      escapeCsv(l.TechnicianNotes),
      escapeCsv(l.CustomerNotes),
      escapeCsv(l.Description),
      escapeCsv(l.CreatedAt),
    ]);

    return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  }
}

export const customCrmDb = new CustomCrmDatabase();
export default customCrmDb;
