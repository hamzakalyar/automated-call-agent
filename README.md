# Apex Elite Contractor AI Front-Office Platform

An end-to-end, production-ready AI automation platform for contractor and home-service businesses (Plumbing, HVAC, Electrical, Drain Cleaning, Roofing).

This system captures incoming telephone calls, SMS messages, and WhatsApp inquiries via **Voice AI (Google Gemini 2.0 Flash / Twilio / Vapi)**, dynamically qualifies and extracts customer details without hardcoding, checks technician availability and proximity, auto-assigns dispatches in an embedded **Enterprise SQLite Relational CRM**, dispatches multi-channel customer & contractor alerts, and provides a full **Multi-Role RBAC Command Center** (Admin, Staff Technician, Customer Tracking Portal).

---

## 🔑 Where to Place Your API Keys & Quick Setup

All API keys and credentials are kept strictly in a single, secure file:
👉 **`.env`** (located in the root folder of this project)

### Quick Setup (3 Steps):
1. **Open the `.env` file** in the project root:
   ```bash
   # If you need a fresh copy from the template:
   cp .env.example .env
   ```
2. **Add your API Keys** in the designated sections of `.env`:
   - **Google Gemini AI Key** (Required for Voice & Lead Intelligence):
     Get your free key at [Google AI Studio](https://aistudio.google.com/app/apikey).
     ```env
     GEMINI_API_KEY=your_gemini_api_key_here
     GEMINI_MODEL=gemini-3.5-flash-lite
     VOICE_ENGINE=gemini
     ```
   - **Twilio Credentials** (Required for Live SMS & WhatsApp Lead Ingestion):
     Get free trial credits at [Twilio Console](https://console.twilio.com/).
     ```env
     TWILIO_ACCOUNT_SID=your_account_sid_here
     TWILIO_AUTH_TOKEN=your_auth_token_here
     TWILIO_FROM_NUMBER=+15550190000
     TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
     ```
3. **Start the Platform**:
   ```bash
   npm run dev
   ```
   Open **`http://localhost:3000`** in your browser.

---

## 🛡️ Zero Hardcoded Data Guarantee

- **No Hardcoded API Keys or Secrets**: All credentials, tokens, phone numbers, and webhooks are read dynamically from `process.env` via [`config/index.js`](file:///d:/Softskills%20Engineering/Agent/config/index.js).
- **No Mock or Hardcoded Customers**: All incoming speech, SMS texts, and WhatsApp messages are processed dynamically through Google Gemini's live LLM API (`https://generativelanguage.googleapis.com/v1beta/models/...`).
- **Dynamic Field & Shorthand Parsing**: The system intelligently parses full addresses, street names, and 7-to-15 digit local shorthand numbers (e.g. `0203333` or `03001234567`) in real time.
- **Dynamic Proximity Matching**: Technicians are matched algorithmically in SQLite ([`src/services/db.js`](file:///d:/Softskills%20Engineering/Agent/src/services/db.js)) based on active job workload, certified trade specialties, and neighborhood proximity.

---

## 📦 Architecture Overview

```
Inbound Voice Call / SMS / WhatsApp
               │
               ▼
┌──────────────────────────────────────────────┐
│  Multi-Channel Voice & Messaging Gateway     │
│  - Interactive Gemini 2.0 Web Voice Agent    │
│  - Twilio Voice Direct (/api/voice/incoming) │
│  - Twilio SMS (/api/webhooks/twilio)         │
│  - WhatsApp Business (/api/webhooks/whatsapp)│
└──────────────────────┬───────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────┐
│  AI Lead Intelligence & Quality Gate         │
│  - Real-time Gemini 2.0 Flash Extraction     │
│  - Mandatory 4-Field Quality Gate            │
│    (Name, Phone, Address, Problem)           │
│  - Standalone digit & shorthand recovery     │
│  - Low-confidence Human Escalation Detector  │
└──────────────────────┬───────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────┐
│  Dynamic Dispatch Engine                     │
│  - SQLite Multi-Role Relational Database     │
│  - Active Workload & Certified Trade Filter  │
│  - Neighborhood Proximity Matching           │
└──────────────────────┬───────────────────────┘
                       │
          ┌────────────┴────────────┐
          ▼                         ▼
┌──────────────────┐      ┌────────────────────┐
│ Auto-Dispatched  │      │ Human Review Queue │
│ Technician Alert │      │ (Admin Console)    │
└─────────┬────────┘      └─────────┬──────────┘
          │                         │
          └────────────┬────────────┘
                       ▼
┌──────────────────────────────────────────────┐
│  Instant Customer Confirmation               │
│  - Real-time 2-Way TwiML SMS / WhatsApp      │
│  - Unique Magic Tracking Link                │
│    (/api/public/track?id=...)                │
│  - Direct In-App Technician Messaging        │
└──────────────────────────────────────────────┘
```

---

## 📱 Live Portals & RBAC Roles

The system provides complete multi-role isolation accessible from the top navigation bar:

1. **Admin Dispatch Command Center** (`/?role=admin`):
   - Full lead registry, live dispatch status, manual technician reassignment.
   - Dynamic service catalog editor (add/remove plumbing, HVAC, electrical services).
   - Staff leave management & approval center.
   - Comprehensive audit logging trail.
2. **Staff Technician Portal** (`/?role=staff`):
   - Dedicated technician workspace filtered strictly to assigned jobs.
   - Live dispatch status updater (`En Route`, `On Site`, `In Progress`, `Completed`).
   - Time-off and leave request submission.
   - Direct two-way messaging with assigned customers.
3. **Customer Fast Booking & Tracking** (`/?role=customer`):
   - Public online booking without mandatory login (`/api/public/book`).
   - Real-time job status tracking by Lead ID or Phone Number (`/api/public/track`).
   - Direct messaging with the assigned field technician.

---

## 🔌 API Key Reference Table

| Service | Environment Variable(s) | Required? | Purpose |
|---|---|---|---|
| **Google Gemini 3.5 AI** | `GEMINI_API_KEY`, `GEMINI_MODEL` | **Required** | Sole native AI engine: powers real-time conversational voice receptionist (Riley), multi-turn slot elicitation, and high-accuracy structured JSON lead extraction. |
| **Twilio SMS & WhatsApp** | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `TWILIO_WHATSAPP_FROM` | **Recommended** | Ingests inbound SMS & WhatsApp leads with 100% verified carrier numbers and dispatches real-time confirmations. |
| **Vapi Cloud Voice** | `VAPI_API_KEY`, `VAPI_ASSISTANT_ID`, `VAPI_PHONE_NUMBER` | *Optional* | Routes inbound phone calls through Vapi telephony. |
| **Cal.com** | `CALCOM_API_KEY`, `CALCOM_EVENT_TYPE_ID` | *Optional* | Syncs appointment slots with an external calendar. |
| **Airtable** | `AIRTABLE_ACCESS_TOKEN`, `AIRTABLE_BASE_ID` | *Optional* | Dual-cloud CRM backup (System runs on native SQLite by default). |
| **Slack** | `SLACK_WEBHOOK_URL` | *Optional* | Real-time contractor channel emergency alerts. |

---

## 🚀 Running the Project

```bash
# 1. Install dependencies
npm install

# 2. Run the server with auto-reload
npm run dev

# 3. Expose local server for Twilio/Vapi webhooks
npm run tunnel
```
