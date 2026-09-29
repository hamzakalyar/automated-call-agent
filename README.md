# Apex Elite — AI-Powered Contractor Front Office Platform

> End-to-end automation platform for home-service contractors (Plumbing, HVAC, Electrical, Drain Cleaning). Features a conversational Voice AI receptionist, real-time CRM, multi-role portals, automated technician dispatch, and customer self-service — all deployable to Vercel in one click.

**Live Demo:** [Deployed on Vercel](https://automated-call-agent.vercel.app)

---

## Table of Contents

- [What It Does](#what-it-does)
- [System Architecture](#system-architecture)
- [Core Workflows](#core-workflows)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Setup & Installation](#setup--installation)
- [Environment Variables](#environment-variables)
- [Multi-Role Portals](#multi-role-portals)
- [API Endpoints](#api-endpoints)
- [Deployment (Vercel)](#deployment-vercel)
- [Data Storage](#data-storage)

---

## What It Does

A customer calls, texts, or visits the website → the AI agent **Riley** handles the conversation, extracts their name/phone/address/problem, checks technician availability, books the appointment, dispatches the nearest tech, and sends confirmations — all automatically, 24/7, with zero human intervention.

### Key Capabilities

| Feature | Description |
|---------|-------------|
| **Voice AI Receptionist** | Google Gemini-powered conversational agent ("Riley") that handles live calls with multi-turn dialogue, slot filling, and real-time speech |
| **Instant Web Booking** | Public booking form with auto-dispatch — no account needed |
| **Smart Dispatch Engine** | Auto-assigns nearest available certified technician based on workload, trade specialty, and proximity |
| **Built-in CRM** | SQLite relational database with leads, users, services, leave requests, and audit logs |
| **3 Role-Based Portals** | Admin Command Center, Staff Technician Portal, Customer Tracking Portal |
| **Multi-Channel Alerts** | SMS (Twilio), Slack, WhatsApp notifications to customers, technicians, and dispatchers |
| **Order Tracking** | Customers track their job status with just a Lead ID or phone number — no login required |
| **1-Click Demo Scenarios** | Pre-built call transcripts to demonstrate the full intake→dispatch→notification pipeline |

---

## System Architecture

```
                        ┌─────────────────────────┐
                        │   Customer Touchpoints   │
                        │  • Website Booking Form  │
                        │  • Voice Call (Browser)   │
                        │  • SMS / WhatsApp         │
                        │  • 1-Click Demo Scenarios │
                        └────────────┬────────────┘
                                     │
                                     ▼
┌────────────────────────────────────────────────────────────┐
│                    Express.js Server                       │
│                    (src/server.js)                          │
│                                                            │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────┐  │
│  │ Public Routes │  │  Voice API   │  │  Webhook Routes │  │
│  │ /api/public/  │  │ /api/voice/  │  │ /api/webhooks/  │  │
│  │  book, track  │  │ gemini-web-  │  │ twilio, whatsapp│  │
│  │              │  │ turn, end-   │  │                 │  │
│  │              │  │ call         │  │                 │  │
│  └──────┬───────┘  └──────┬───────┘  └───────┬─────────┘  │
│         │                 │                   │            │
│         └────────┬────────┴───────────────────┘            │
│                  ▼                                         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Service Layer                          │   │
│  │                                                     │   │
│  │  gemini.js ─── AI conversation + speech synthesis   │   │
│  │  parser.js ─── Lead field extraction (name, phone,  │   │
│  │                address, problem)                    │   │
│  │  orchestrator.js ─ Full intake pipeline:            │   │
│  │       parse → qualify → check availability →        │   │
│  │       book slot → assign tech → notify all          │   │
│  │  db.js ──────── SQLite CRM (users, leads, services, │   │
│  │                 technicians, leave, audit logs)      │   │
│  │  notifications.js ── SMS, Slack, WhatsApp alerts    │   │
│  │  airtable.js ── Optional cloud CRM sync            │   │
│  │  calcom.js ──── Optional calendar integration       │   │
│  └─────────────────────────────────────────────────────┘   │
│                  │                                         │
│                  ▼                                         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │           SQLite Database (db.js)                   │   │
│  │  Tables: users, leads, services, technicians,       │   │
│  │          leave_requests, status_log                  │   │
│  └─────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌────────────────────────────────────────────────────────────┐
│              Frontend (src/public/)                        │
│                                                            │
│  index.html ── Single-page app with all 3 portals          │
│  app.js ────── Client logic, routing, voice call UI,       │
│                lead table rendering, booking form           │
│  styles.css ── Full design system                          │
│  tech.html ─── Standalone technician mobile view           │
└────────────────────────────────────────────────────────────┘
```

---

## Core Workflows

### Workflow 1: Customer Books via Website

```
Customer fills booking form → POST /api/public/book
  → Server creates lead in SQLite
  → Auto-assigns nearest certified technician
  → Sends SMS confirmation to customer (Twilio)
  → Sends Slack/SMS alert to technician
  → Returns tracking ID to customer
  → Lead appears in Admin CRM dashboard
```

### Workflow 2: Live Voice Call with AI Agent Riley

```
Customer clicks "Call Now" → Browser microphone activates
  → Speech recognized → POST /api/voice/gemini-web-turn
  → Gemini AI processes speech, responds conversationally
  → Riley extracts: name, phone, address, problem
  → Once all 4 fields confirmed → auto-books appointment
  → On hang-up → POST /api/voice/end-call
  → Full transcript ingested into CRM via orchestrator.js
  → Lead created with status "Booked" or "Escalated"
```

### Workflow 3: SMS / WhatsApp Inbound Lead

```
Customer texts Twilio number → POST /api/webhooks/twilio
  → Message parsed by Gemini AI
  → Lead extracted and qualified
  → If complete: auto-booked and dispatched
  → If incomplete: follow-up SMS sent asking for missing fields
```

### Workflow 4: 1-Click Demo Scenarios (Admin Panel)

```
Admin clicks scenario card (e.g. "Burst Pipe Emergency")
  → Pre-written transcript sent to POST /api/simulate-call
  → orchestrator.js runs full pipeline:
      parse → qualify → check availability → book → assign → notify
  → Lead appears in CRM with full audit trail
```

### Workflow 5: Customer Self-Service Tracking

```
Customer enters Lead ID or phone → POST /api/public/track
  → Server looks up lead in SQLite
  → Returns: status, assigned tech, booked slot, timeline
  → No login or account required
```

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Runtime** | Node.js 22+ (ESM modules) |
| **Server** | Express.js |
| **AI Engine** | Google Gemini 2.0 Flash (conversation + speech + extraction) |
| **Database** | Node.js native SQLite (`node:sqlite`) |
| **Frontend** | Vanilla HTML/CSS/JS (no framework) |
| **Voice** | Web Speech API (browser) + Gemini TTS |
| **SMS/WhatsApp** | Twilio |
| **Alerts** | Slack Webhooks |
| **Calendar** | Cal.com (optional) |
| **Cloud CRM** | Airtable (optional dual-sync) |
| **Deployment** | Vercel (serverless) |

---

## Project Structure

```
├── api/
│   └── index.js              # Vercel serverless entry point
├── config/
│   └── index.js              # Centralized env config (all keys read from .env)
├── src/
│   ├── server.js             # Express app — all API routes
│   ├── tunnel.js             # localtunnel for webhook testing
│   └── services/
│       ├── gemini.js          # Gemini AI: conversation engine, function calling, TTS
│       ├── parser.js          # Lead field extraction (regex + AI fallback)
│       ├── orchestrator.js    # Full intake pipeline (parse → book → dispatch → notify)
│       ├── db.js              # SQLite database: schema, CRUD, seed data, RBAC
│       ├── notifications.js   # Multi-channel alerts (SMS, Slack, WhatsApp)
│       ├── airtable.js        # Optional Airtable cloud CRM sync
│       ├── calcom.js          # Optional Cal.com calendar booking
│       ├── followup.js        # Automated follow-up nudge scheduler
│       └── reset.js           # Demo data reset utility
│   └── public/
│       ├── index.html         # Main SPA (landing + all 3 portals)
│       ├── app.js             # Client-side logic (routing, voice UI, tables)
│       ├── styles.css         # Full design system
│       ├── tech.html          # Standalone technician mobile view
│       ├── tech.js            # Technician portal client logic
│       └── images/            # Hero backgrounds and assets
├── vercel.json               # Vercel deployment config
├── package.json              # Dependencies: express, cors, dotenv, @google/genai
├── .env.example              # Template with all environment variables
├── .env                      # Your actual API keys (gitignored)
├── Dockerfile                # Docker support
├── docker-compose.yml        # Docker Compose config
├── fly.toml                  # Fly.io deployment config
└── render.yaml               # Render deployment config
```

---

## Setup & Installation

### Prerequisites
- **Node.js 22.5+** (required for native `node:sqlite`)
- **Google Gemini API Key** (free at [aistudio.google.com](https://aistudio.google.com/app/apikey))

### Steps

```bash
# 1. Clone the repository
git clone https://github.com/hamzakalyar/automated-call-agent.git
cd automated-call-agent

# 2. Install dependencies
npm install

# 3. Create your environment file
cp .env.example .env
# Edit .env and add your GEMINI_API_KEY

# 4. Start the dev server (auto-reload on changes)
npm run dev

# 5. Open in browser
# http://localhost:3000
```

### Optional: Expose for Webhooks
```bash
# For Twilio/Vapi webhooks to reach your local server
npm run tunnel
```

---

## Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `GEMINI_API_KEY` | **Yes** | Google Gemini AI — powers voice agent Riley and lead extraction |
| `GEMINI_MODEL` | No | Model name (default: `gemini-3.5-flash-lite`) |
| `TWILIO_ACCOUNT_SID` | No | Twilio SMS/WhatsApp — live customer notifications |
| `TWILIO_AUTH_TOKEN` | No | Twilio authentication |
| `TWILIO_FROM_NUMBER` | No | Outbound SMS sender number |
| `SLACK_WEBHOOK_URL` | No | Slack channel alerts for new bookings |
| `CALCOM_API_KEY` | No | Cal.com calendar sync |
| `AIRTABLE_ACCESS_TOKEN` | No | Airtable cloud CRM dual-sync |
| `BUSINESS_NAME` | No | Your company name (shown in UI and AI voice) |
| `SUPPORT_PHONE` | No | Customer support hotline number |

> **Note:** The system works fully without any optional keys. AI voice uses Gemini, CRM uses built-in SQLite, and notifications log to console when external services aren't configured.

---

## Multi-Role Portals

### 1. Public Landing Page (`/home`)
- Customer-facing booking form with emergency/scheduled toggle
- Service catalog grid
- Live order tracking (by Lead ID or phone)
- AI voice call button ("Call Riley")
- FAQ section

### 2. Admin Command Center (`/admin`)
- Full leads table with status filters (All, Booked, In Progress, Needs Attention, etc.)
- Inline technician assignment and status override dropdowns
- Double-booking collision detection with visual warnings
- Out-of-service-area alerts
- Field team roster with active job counts
- Dynamic services catalog editor (add/edit/delete)
- Staff leave request approval center
- Immutable audit log timeline per lead
- 1-click demo scenario cards for live call simulation
- Settings panel (Slack webhook, Cal.com, notification channel)

### 3. Staff Technician Portal (`/staff`)
- Jobs filtered to the logged-in technician only
- Status update workflow: En Route → On Site → In Progress → Completed
- Leave request submission
- Direct customer messaging

### 4. Customer Portal (`/customer`)
- View assigned job details and technician info
- Real-time status tracking
- Direct messaging with assigned technician

---

## API Endpoints

### Public (No Auth)
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/home` | Landing page |
| `GET` | `/admin` | Admin portal |
| `GET` | `/staff` | Staff portal |
| `GET` | `/customer` | Customer portal |
| `POST` | `/api/public/book` | Book a service (returns tracking ID) |
| `GET` | `/api/public/track` | Track order by Lead ID or phone |

### Voice AI
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/voice/gemini-web-turn` | Send speech to Riley, get AI response + audio |
| `POST` | `/api/voice/end-call` | Finalize call and ingest into CRM |
| `POST` | `/api/voice/incoming` | Twilio/Vapi inbound call webhook |

### CRM (Admin)
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/leads` | List all leads (scoped by role) |
| `POST` | `/api/leads/sync` | Sync client-side leads to server |
| `GET` | `/api/leads/:id` | Get single lead |
| `PATCH` | `/api/leads/:id` | Update lead fields |
| `PATCH` | `/api/leads/:id/status` | Change lead status |
| `PATCH` | `/api/leads/:id/assign` | Assign technician |
| `DELETE` | `/api/leads/:id` | Delete lead |
| `GET` | `/api/leads/export/csv` | Export leads as CSV |

### Services, Users, Team
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/services` | List service catalog |
| `POST` | `/api/services` | Add service |
| `GET` | `/api/users` | List users by role |
| `GET` | `/api/team` | List technicians |
| `POST` | `/api/leave` | Submit leave request |
| `PATCH` | `/api/leave/:id` | Approve/reject leave |

### Webhooks
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/webhooks/twilio` | Inbound SMS processing |
| `POST` | `/api/webhooks/whatsapp` | Inbound WhatsApp processing |
| `POST` | `/api/simulate-call` | 1-click demo call transcript intake |

---

## Deployment (Vercel)

The project is configured for one-click Vercel deployment.

### How It Works
- `vercel.json` routes all requests through `api/index.js`
- `api/index.js` imports the Express app from `src/server.js`
- Runs as a serverless function on Node.js 22

### Steps
1. Push code to GitHub
2. Import the repo in [Vercel Dashboard](https://vercel.com/new)
3. Add environment variables:
   - `GEMINI_API_KEY` (required)
   - Any optional keys (Twilio, Slack, etc.)
4. Deploy — Vercel auto-builds on every push to `main`

### Important Note on Data
On Vercel, the SQLite database lives in `/tmp/` (ephemeral). This means:
- The database is **re-created with demo seed data** on each cold start
- Leads created during a session persist for the life of that serverless instance
- The client browser also caches leads in `localStorage` and syncs them back
- **For production use**, swap SQLite for a cloud database (Vercel Postgres, Supabase, etc.)

---

## Data Storage

### How Leads Are Stored

| Layer | Storage | Persistence |
|-------|---------|-------------|
| **Server** | SQLite in `/tmp/` (Vercel) or `./data/` (local) | Ephemeral on Vercel, persistent locally |
| **Client** | `localStorage` (`apex_client_created_leads`) | Persists per browser until cleared |
| **Sync** | Client → Server via `POST /api/leads/sync` | Runs on every polling cycle (4s) |
| **Optional** | Airtable cloud CRM | Persistent if configured |

### Database Tables

| Table | Purpose |
|-------|---------|
| `users` | Admin, staff, and customer accounts with RBAC |
| `leads` | All service requests — the core CRM record |
| `services` | Dynamic service catalog (drives AI prompt + booking form) |
| `technicians` | Field team roster with certifications and zones |
| `leave_requests` | Staff time-off requests with approval workflow |
| `status_log` | Immutable audit trail for every status change |

---

## License

MIT
