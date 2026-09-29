# Apex Elite — Multi-Role Contractor Front Office AI Architecture

## 1. System Overview

Apex Elite is an autonomous, multi-role Contractor Front Office and Field Dispatch platform designed for trade businesses (Plumbing, HVAC, Electrical, Roofing). The system replaces manual spreadsheets and bare CRM grids with three distinct, role-gated web portals powered by a modular relational database layer and Google Gemini Voice AI:

1. **👑 Admin Panel (`role: admin`)**:
   - Central command for owners and dispatchers.
   - Complete visibility across all leads with AI source attribution (`ai_voice`, `ai_chat`, `manual`).
   - Dedicated **"Needs Attention"** triage filter for human handoffs and emergencies.
   - Lead status overrides and instant technician reassignment.
   - **Dynamic Services Catalog Management**: The single source of truth that drives AI voice qualifying prompts in real time.
   - **Staff Leave & Time Off Approval**: Review, approve, or reject field staff leave requests.
   - Live fleet visibility, Slack/SMS notification feed, and system audit logs.

2. **👤 Customer Portal (`role: customer`)**:
   - Streamlined self-service portal accessible via email/phone lookup or magic link.
   - Strictly isolated to the customer's own service records at the data layer.
   - **Privacy Protection**: Displays technician identity using **first name only** (e.g. `Dave M.`).
   - Real-time visual progression stepper: `Request Received` ➔ `AI Qualified` ➔ `Appointment Confirmed` ➔ `Technician Dispatched` ➔ `Completed`.
   - **Chronological Status Audit Trail**: Powered by the immutable `status_log` table.
   - **Reschedule & Messaging**: Direct channel to request new appointment windows or provide gate codes/special instructions.

3. **👷 Staff Panel (`role: staff`)**:
   - Field technician console designed for mobile and tablet use.
   - Strictly scoped to work orders assigned to the logged-in technician.
   - Fast status actions:
     - `▶ Start Job (In Progress)`
     - `✔ Complete Job & Close Work Order`
   - Every status transition automatically writes an immutable log to `status_log` and triggers automated customer notification updates.
   - **Time Off & Leave Management**: Technicians can submit leave requests and track review status without exposing peer technician data.

---

## 2. End-to-End System Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                   INBOUND INTAKE CHANNELS                              │
│   • Phone Calls (Vapi / Twilio WebRTC / Gemini 3.5 Live Mic)           │
│   • Web Chat & Digital Inquiry Forms                                   │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│              INTELLIGENT RECEPTIONIST & DISPATCH ENGINE                │
│   • Google Gemini Flash (Dynamic Prompting from Services Catalog)      │
│   • Intent Extraction, Urgency Classification & Smart Deduplication    │
│   • Cal.com Autonomous Trade Slot Booking                              │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│               REST API & ROW-LEVEL SECURITY (RBAC) LAYER               │
│   • Auth & Session Resolver (`resolveUser`, `x-user-id` header)        │
│   • Scoped Lead Queries (`/api/leads` - Admin: all, Staff/Cust: own)   │
│   • Services Catalog API (`/api/services` - Admin mutate, Public read) │
│   • Staff Leave API (`/api/leave` - Staff own, Admin all/review)       │
│   • Status Audit Trail API (`/api/status-log/:entityId`)               │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   MODULAR RELATIONAL DATABASE LAYER                    │
│                 (SQLite / PostgreSQL / Supabase Ready)                 │
│                                                                        │
│   ┌──────────────┐     ┌──────────────┐     ┌──────────────────────┐   │
│   │    users     │1   *│    leads     │*   1│       services       │   │
│   │  (role/name) ├─────┤ (cust_id/stf)├─────┤ (name/desc/active)   │   │
│   └──────┬───────┘     └──────┬───────┘     └──────────────────────┘   │
│          │1                   │1                                       │
│          │*                   │*                                       │
│   ┌──────┴───────┐     ┌──────┴───────┐                                │
│   │leave_requests│     │  status_log  │                                │
│   │(dates/status)│     │(immutable aud│                                │
│   └──────────────┘     └──────────────┘                                │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                       OUTBOUND NOTIFICATION HUB                        │
│   • Slack Dispatch Channel (Instant team alerts & escalations)         │
│   • Customer SMS / Status Alerts (Twilio)                              │
│   • Automated Follow-up Timers & Second-Stage Escalations              │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Database Schema Specification

The database repository in `src/services/db.js` adheres to standard relational database design principles:

### Table: `users`
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | Unique numeric identifier |
| `user_id` | TEXT | UNIQUE NOT NULL | External reference (e.g. `USR-ADM-01`, `USR-STF-01`) |
| `name` | TEXT | NOT NULL | User's full name |
| `email` | TEXT | UNIQUE NOT NULL | User login / communication email |
| `phone` | TEXT | DEFAULT '' | Phone number |
| `role` | TEXT | NOT NULL CHECK(role IN ('admin','staff','customer')) | RBAC role |
| `active` | INTEGER | NOT NULL DEFAULT 1 | Account status (1 = Active, 0 = Inactive) |
| `avatar` | TEXT | DEFAULT '' | Optional avatar image URL |
| `created_at` | TEXT | NOT NULL | ISO 8601 creation timestamp |
| `updated_at` | TEXT | NOT NULL | ISO 8601 update timestamp |

### Table: `leads`
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | Internal record ID |
| `lead_id` | TEXT | UNIQUE NOT NULL | Formatted reference (e.g. `LD-8041-PL`) |
| `customer_id` | INTEGER | REFERENCES users(id) | Associated customer ID |
| `name` | TEXT | NOT NULL | Customer name |
| `phone` | TEXT | DEFAULT '' | Customer phone number |
| `email` | TEXT | DEFAULT '' | Customer email |
| `location` | TEXT | DEFAULT '' | Job location / address |
| `job_type` | TEXT | DEFAULT 'General Plumbing' | Trade service requested |
| `urgency` | TEXT | DEFAULT 'Medium' | `Low`, `Medium`, `High`, `Emergency` |
| `status` | TEXT | DEFAULT 'New Lead' | Lifecycle stage |
| `booked_slot` | TEXT | DEFAULT '' | Cal.com booking ISO timestamp |
| `assigned_staff_id`| INTEGER | REFERENCES users(id) | Dispatched technician user ID |
| `assigned_tech` | TEXT | DEFAULT '' | Technician full name |
| `description` | TEXT | DEFAULT '' | Raw customer issue description |
| `photo_links` | TEXT | DEFAULT '' | Uploaded damage photos |
| `next_action` | TEXT | DEFAULT 'Schedule appointment' | Automated workflow directive |
| `source` | TEXT | DEFAULT 'ai_voice' | `ai_voice`, `ai_chat`, `manual` |
| `technician_notes`| TEXT | DEFAULT '' | Internal technician notes |
| `customer_notes` | TEXT | DEFAULT '' | Customer messages or reschedule requests |
| `created_at` | TEXT | NOT NULL | ISO 8601 creation timestamp |
| `updated_at` | TEXT | NOT NULL | ISO 8601 update timestamp |

### Table: `services`
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | Internal record ID |
| `service_id` | TEXT | UNIQUE NOT NULL | Formatted service code (e.g. `SVC-101`) |
| `name` | TEXT | NOT NULL | Service title |
| `description` | TEXT | DEFAULT '' | Detailed trade scope & qualifying questions |
| `active` | INTEGER | NOT NULL DEFAULT 1 | 1 = Offered by AI Agent; 0 = Suppressed |
| `created_by` | TEXT | DEFAULT 'admin' | Author dispatcher name |
| `created_at` | TEXT | NOT NULL | ISO 8601 creation timestamp |
| `updated_at` | TEXT | NOT NULL | ISO 8601 update timestamp |

### Table: `leave_requests`
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | Internal record ID |
| `request_id` | TEXT | UNIQUE NOT NULL | Formatted request code (e.g. `LV-REQ-101`) |
| `staff_id` | INTEGER | NOT NULL REFERENCES users(id) | Requesting technician user ID |
| `staff_name` | TEXT | NOT NULL | Requesting technician name |
| `start_date` | TEXT | NOT NULL | First day of leave (`YYYY-MM-DD`) |
| `end_date` | TEXT | NOT NULL | Last day of leave (`YYYY-MM-DD`) |
| `reason` | TEXT | NOT NULL | Reason for time off |
| `status` | TEXT | DEFAULT 'Pending' CHECK(status IN ('Pending','Approved','Rejected')) | Review status |
| `requested_at`| TEXT | NOT NULL | ISO 8601 timestamp |
| `reviewed_by` | TEXT | DEFAULT '' | Admin who approved/rejected |
| `reviewed_at` | TEXT | DEFAULT '' | Timestamp of decision |
| `admin_notes` | TEXT | DEFAULT '' | Explanatory note or coverage plan |

### Table: `status_log`
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | Internal audit ID |
| `log_id` | TEXT | UNIQUE NOT NULL | Unique audit entry code (e.g. `LOG-8041-01`) |
| `entity_type` | TEXT | NOT NULL CHECK(entity_type IN ('lead','leave_request')) | Entity being audited |
| `entity_id` | TEXT | NOT NULL | Foreign key reference (`lead_id` or `request_id`) |
| `changed_by` | TEXT | NOT NULL | Actor who initiated change |
| `old_status` | TEXT | NOT NULL | Previous state |
| `new_status` | TEXT | NOT NULL | New state |
| `note` | TEXT | DEFAULT '' | Transition context or customer message |
| `timestamp` | TEXT | NOT NULL | ISO 8601 transition timestamp |

---

## 4. Security & Privacy Guarantees

1. **Row-Level Security (RLS) Enforcement**:
   - Enforced at the data layer in `db.js:listLeadsScoped` and `server.js`.
   - Customers can **only** inspect records linked to their verified ID, email, or verified phone number.
   - Staff technicians can **only** view work orders assigned to their account.
   - Staff leave queries prevent peer technicians from inspecting each other's time-off requests.

2. **Technician Privacy Protection**:
   - Customer-facing queries anonymize staff names to **first name only** (e.g., `Dave Miller` becomes `Dave M.`).

3. **Immutable Audit Trails**:
   - Every status modification (intake, qualification, dispatch, in-progress, completion, or leave review) automatically records an append-only entry in `status_log`.

---

## 5. Automated Verification Results

Both test suites execute via `npm test` and pass with 0 errors:

- **Edge Cases Test Suite (`tests/edge_cases.test.js`)**:
  - `Edge Case 1`: Low-confidence garbled speech triggers human handoff. (PASS)
  - `Edge Case 2`: Explicit request for human routes to human triage. (PASS)
  - `Baseline`: Qualified lead creation, Cal.com scheduling & notification dispatch. (PASS)
  - `Edge Case 3`: Duplicate caller inquiry deduplication without double booking. (PASS)
  - `Edge Case 4`: Slot exhaustion fallback to "Awaiting Response". (PASS)
  - `Edge Case 5`: Follow-up timer customer nudge & escalation. (PASS)
  - `Edge Case 6`: API failure resilience without process crashes. (PASS)
  - `Demo Reset`: Complete environment cleanup. (PASS)

- **Multi-Role RBAC Test Suite (`tests/multi_role_rbac.test.js`)**:
  - `Test 1`: Admin full visibility over leads, team, services, and leave. (PASS)
  - `Test 2`: Staff job scoping, status progression, and customer alert firing. (PASS)
  - `Test 3`: Customer data isolation & first-name privacy enforcement. (PASS)
  - `Test 4`: Dynamic services catalog creation, deactivation, and prompt sync. (PASS)
  - `Test 5`: Staff leave submission, peer isolation, and Admin review. (PASS)
