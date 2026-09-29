# Operational Runbook: Contractor Front Office Automation

This guide provides end-to-end instructions for deploying, configuring, testing, demonstrating, and troubleshooting the system.

---

## 1. Quickstart (Under 3 Minutes)

### Prerequisites
- **Node.js**: v18.0+ (v20+ recommended)
- **Docker & Docker Compose**: Optional, for self-hosting n8n
- **Public Tunnel**: ngrok or Cloudflare Tunnel (if testing live incoming phone calls from Vapi/Twilio to your local machine)

### Step 1: Clone & Install
```bash
git clone <repo-url> contractor-front-office
cd contractor-front-office
npm install
```

### Step 2: Configure Environment
Copy the `.env.example` template:
```bash
cp .env.example .env
```
Open `.env` in your editor and populate your keys (see Section 2 below for instructions on getting free-tier keys). If you do not have keys yet, the system will automatically run in **Demonstration Mode** with a persistent local store and simulated voice/SMS webhooks!

### Step 3: Start the Application
```bash
npm run dev
```
Open your browser to: **`http://localhost:3000`**

---

## 2. Setting Up Third-Party Free Tier Services

### A. Vapi Voice AI Setup
1. Sign up for a free trial at [vapi.ai](https://vapi.ai/) ($10 free credit included).
2. Go to **Assistants** &rarr; **Create Assistant**.
3. Copy the configuration from [vapi/assistant_config.json](file:///d:/Softskills%20Engineering/Agent/vapi/assistant_config.json) into the Assistant Settings.
4. Set the **Server URL** to your public webhook endpoint: `https://<your-tunnel-url>/api/webhooks/vapi`.
5. Buy or assign a free trial phone number in the **Phone Numbers** tab and attach your assistant.
6. Set `VAPI_API_KEY` and `VAPI_PHONE_NUMBER` in your `.env`.

### B. Anthropic Claude API Setup
1. Sign up at [console.anthropic.com](https://console.anthropic.com/).
2. Create an API Key in **API Keys** tab.
3. Paste the key into `ANTHROPIC_API_KEY` in `.env`.
4. Ensure `ANTHROPIC_MODEL=claude-3-5-sonnet-20241022` is selected.

### C. Airtable (Demonstration CRM Layer) Setup
1. Sign up at [airtable.com](https://airtable.com/) (free tier).
2. Create a new base named **"Contractor CRM Demo"**.
3. Create two tables with the exact field names below:
   - **`Leads` Table**:
     - `LeadID` (Single line text)
     - `Name` (Single line text)
     - `Phone` (Phone number)
     - `Location` (Single line text)
     - `JobType` (Single select: Plumbing, Electrical, HVAC, Roofing, Drain Cleaning, Emergency, Other)
     - `Urgency` (Single select: Emergency, High, Medium, Low)
     - `Description` (Long text)
     - `PhotoLinks` (Long text)
     - `Status` (Single select: New, Qualified, Booked, Awaiting Response, Followed Up, Escalated to Human, Closed)
     - `CreatedAt` (Date / Time)
     - `BookedSlot` (Single line text)
     - `NextAction` (Single line text)
   - **`Logs` Table**:
     - `Timestamp` (Single line text / Date)
     - `LeadID` (Single line text)
     - `Step` (Single line text)
     - `Outcome` (Single line text)
     - `Details` (Long text)
4. Create a Personal Access Token at `airtable.com/create/tokens` with `data.records:read` and `data.records:write` scopes.
5. Copy your **Base ID** from the Airtable URL (`https://airtable.com/appXXXXXXXXXXXXXX/...`).
6. Set `AIRTABLE_ACCESS_TOKEN` and `AIRTABLE_BASE_ID` in `.env`.

> *Note: If Airtable tokens are left blank, the app uses its native embedded SQLite database (`data/apex_crm.sqlite`), providing multi-role RBAC, persistent lead tracking, and audit logs.*

### D. Cal.com Scheduling Setup
1. Sign up at [cal.com](https://cal.com/) (free tier).
2. Create an event type named **"Standard Contractor Visit"** (length: 60 or 120 mins).
3. Copy the **Event Type ID** from the event settings URL.
4. Go to **Settings** &rarr; **Developer** &rarr; **API Keys** &rarr; Create Key.
5. Set `CALCOM_API_KEY` and `CALCOM_EVENT_TYPE_ID` in `.env`.

### E. Notifications (Twilio & Slack)
- **Slack Alert Channel** (Recommended for instant visual demo):
  1. In Slack, go to your workspace's app directory and add **Incoming WebHooks**.
  2. Select a channel (e.g. `#leads-dispatch`) and copy the Webhook URL.
  3. Set `CONTRACTOR_NOTIFY_CHANNEL=slack` and `SLACK_WEBHOOK_URL=https://hooks.slack.com/...` in `.env`.
- **Twilio SMS**:
  1. Sign up at [twilio.com](https://www.twilio.com/) (free trial with $15 balance).
  2. Copy Account SID, Auth Token, and trial phone number into `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM_NUMBER`.

---

## 3. Self-Hosting n8n (Orchestration Engine)

If you wish to run the orchestration inside n8n directly:
```bash
docker compose up -d
```
1. Visit **`http://localhost:5678`** in your browser.
2. Complete initial local admin setup.
3. Import the workflows from the `n8n/workflows/` folder:
   - `workflow_master_contractor_frontoffice.json`
   - `workflow_a_intake_qualify.json`
   - `workflow_b_schedule.json`
   - `workflow_c_notify.json`
   - `workflow_d_followup.json`
   - `workflow_e_second_stage.json`
   - `workflow_f_reset.json`
4. All environment variables configured in `.env` are passed directly into the container.

---

## 4. Sales Meeting Demo Script (Step-by-Step)

1. Open `http://localhost:3000`. Point out the **Integration Status Pills** (Vapi, Claude, Cal.com, Slack).
2. **Scenario 1: Burst Pipe Emergency (The "Wow" Lead)**:
   - Click the 🚨 **Burst Pipe Emergency** button.
   - Show the real-time telemetry card: Claude structured JSON extraction in <200ms.
   - Show the new row appearing in the **CRM Leads Table** with `Status: Booked`, emergency urgency badge, and confirmed Cal.com slot.
   - Show the outbound **Live Notification Feed** with customer confirmation SMS and contractor alert.
3. **Scenario 2: Low-Confidence & Human Handoff**:
   - Click the ⚠️ **Garbled / Missing Address** button or 👤 **Explicit Human Ask**.
   - Show that the system detects the need for human intervention (`needs_human: true`).
   - Show lead status immediately set to `Escalated to Human` without double-booking or getting stuck.
   - Show the contractor Slack alert highlighting the exact reason for escalation.
4. **Scenario 3: Duplicate Caller Protection**:
   - Click 🔄 **Duplicate Customer Call** (same customer calling again).
   - Show that the system merges notes into the existing record rather than creating duplicate appointments.
5. **Scenario 4: Follow-up Timer Simulation**:
   - Click ⏳ **Water Heater Quote (Unbooked)**.
   - Click the **"Nudge"** button or top **"Run Follow-up Check"**.
   - Show status transition from `Awaiting Response` &rarr; `Followed Up` &rarr; `Escalated to Human`.
6. **Scenario 5: Post-Service Review Automation**:
   - Click the **"Review"** button on any booked lead.
   - Show automated Google review request dispatched.
7. **One-Click Reset**:
   - Before ending the meeting, click **"Reset Demo Data"**.
   - Watch all test records, bookings, and logs clean up instantly, ready for the next pitch.

---

## 5. Troubleshooting Matrix

| Symptom | Probable Cause | Remedy |
|---|---|---|
| Webhook from Vapi returns 404 or fails | Public tunnel is not running or incorrect path | Ensure ngrok/cloudflared is forwarding port 3000 and URL path ends with `/api/webhooks/vapi`. |
| Cal.com booking returns 401 | Invalid API key or expired token | Check Developer settings in Cal.com and verify `CALCOM_API_KEY` in `.env`. |
| Twilio SMS fails to send to unverified number | Twilio trial account limitation | On Twilio free trial, recipient phone numbers must be added to "Verified Caller IDs" in Twilio console. |
| Leads table does not update in UI | Browser blocked background polling | Hard refresh the page (`Ctrl + F5`) or click any filter button to force an instant fetch. |
| Claude extraction throws 429 Rate Limit | Anthropic tier usage limit reached | The system will automatically fall back to the built-in heuristic extraction engine without crashing. |
| Reset button doesn't clear Airtable rows | Airtable token lacks delete permissions | Ensure Personal Access Token has `data.records:write` scope enabled. |
