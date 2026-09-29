# Documented Real-World Limitations: Contractor Front Office Automation

In accordance with Section 10 of the build specification, this document transparently details the operational boundaries, technological constraints, and trade-specific edge cases of the current system.

---

## 1. Speech Recognition & Street Address Accuracy

### The Constraint
- **Audio Noise**: In the trades, homeowners frequently call while standing next to active water leaks, loud HVAC compressors, running generators, or highway traffic. Deepgram STT accuracy can degrade on noisy background audio.
- **Unusual Street Names & Municipalities**: Homophones and uncommon phonetics (e.g., "742 Bellerive" vs. "742 Bell Reef") can result in transcription discrepancies.

### Mitigation in this Architecture
- The system includes a **two-attempt clarification rule** in the Vapi system prompt.
- If the AI fails to confirm the street address or phone number after one clarification attempt, it does not invent an address; it sets `needs_human: true` and immediately routes the caller for an urgent human callback.
- The outbound confirmation SMS asks the customer to verify the service address with a simple text reply.

---

## 2. Demonstration CRM vs. Native Trade FSM Systems

### The Constraint
- **Airtable is a Demonstration CRM Layer**: It is not a replacement for full-featured Field Service Management (FSM) platforms such as **ServiceTitan**, **Housecall Pro**, **Jobber**, or **FieldEdge**.
- **Missing FSM Capabilities**:
  - Technician GPS live truck tracking
  - Flat-rate dynamic pricebook lookup and job costing
  - Multi-van inventory management
  - Local building permit databases

### Recommended Production Evolution
- In production, Airtable is swapped for the contractor's existing FSM via n8n webhook nodes (see [docs/MODULARITY_GUIDE.md](file:///d:/Softskills%20Engineering/Agent/docs/MODULARITY_GUIDE.md)).
- The fields extracted (`name`, `phone`, `location`, `job_type`, `urgency`, `description`) map directly to ServiceTitan's `POST /crm/v2/tenant/{tenant}/jobs` endpoint.

---

## 3. Absence of Upfront Deposit / Diagnostic Fee Collection

### The Constraint
- High-end plumbing, HVAC, and electrical contractors frequently charge a **$79 – $149 dispatch / diagnostic fee** to roll a truck to an emergency.
- Capturing credit card numbers over a voice AI phone call requires PCI-DSS Level 1 certified IVR masking (such as Twilio `<Pay>`).

### Recommended Mitigation
- The current build sends an instant SMS link upon booking:
  *"Hi John, to lock in your emergency slot, please authorize our standard $89 diagnostic fee here: [secure link]"*.
- If the customer does not complete payment within 30 minutes, Workflow D triggers a follow-up reminder.

---

## 4. Calendar Slot Race Conditions

### The Constraint
- If two homeowners call within 10 seconds of each other and both request "Tomorrow at 9:00 AM", there is a potential race condition before Cal.com commits the first booking.

### Mitigation in this Architecture
- If Cal.com returns a 409 Conflict or 0 available slots for the chosen window, the system catches the exception gracefully, marks the lead as `Awaiting Response`, logs the conflict in the audit table, and sends a selection link rather than crashing.

---

## 5. Telephony Carrier Live Call Transfer on Free Tier

### The Constraint
- Performing a **warm transfer** (transferring the active audio call directly from the AI to the contractor's mobile phone) requires an active SIP trunk or a telephony provider like Twilio Elastic SIP Trunking.
- On free-tier Vapi and Twilio accounts, live bridging can incur carrier restrictions or require pre-verified caller IDs.

### Mitigation in this Architecture
- The architecture implements a rapid **"Asynchronous Escalation"** model: when human handoff is requested, the AI promises an immediate callback, disconnects politely, and instantly dispatches a high-priority Slack/SMS alert to the contractor with the caller's phone number clickable on mobile.
