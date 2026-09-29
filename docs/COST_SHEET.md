# Monthly Cost Sheet & Free-Tier Operational Limits

This document outlines the exact pricing, free-tier limits, overage behavior, and estimated monthly costs for deploying and running the **Contractor Front Office Automation** system in production.

---

## 1. Service Breakdown & Free-Tier Specifications

| Service | Free-Tier Allowance | Overage Rate (After Free Tier) | Overage Behavior | Notes |
|---|---|---|---|---|
| **Vapi (Voice AI)** | $10 free credit (~70–100 free call minutes) | $0.05 / min platform fee + STT ($0.004/min) + TTS ($0.015/min) + LLM pass-through (~$0.05/min) &rarr; **~$0.12–$0.15 / minute** | Account pauses call handling when balance reaches $0 unless auto-recharge is enabled. | Telephone carrier fees: ~$0.01/min inbound. |
| **Anthropic Claude API** | $5 free credit on new console accounts | Claude 3.5 Sonnet: **$3.00 / 1M input tokens**, **$15.00 / 1M output tokens** (~$0.0054 per call extraction) | Returns HTTP 429 Rate Limit / Insufficient Credits error. | The system has built-in graceful fallback to local heuristics to prevent disruption. |
| **n8n Orchestrator** | **100% Free** (Community Self-Hosted via Docker) | **$0.00** unlimited executions on your own server/VPS | Server hardware bound (CPU/RAM). | A $5–$10/mo DigitalOcean or Hetzner droplet can easily process 50,000+ monthly workflow executions. |
| **Airtable (Demo CRM)** | Free forever plan: Up to **1,000 records per base**, 1 GB attachments | Team plan: **$20 / user / month** (expands to 50,000 records per base) | Base goes into read-only mode for additions if 1,000 record cap is breached. | The one-click demo reset feature clears test rows, keeping demo bases perpetually free. |
| **Cal.com** | Individual Free Plan: **Unlimited bookings**, 1 calendar sync | Standard Team Plan: **$12 / user / month** | Free plan does not expire; upgrades only needed for round-robin team dispatching. | Webhook and API access are fully unlocked on the free individual tier. |
| **Twilio (SMS Gateway)** | $15 free trial balance (~1,800 free US SMS segments) | **$0.0079 / SMS segment** + **$1.15 / month** for dedicated local phone number | Trial accounts require recipient number verification in console. Production accounts require A2P 10DLC registration. | Average lead uses 2–3 SMS (Confirmation, Follow-up, Review) &rarr; ~$0.024 per lead. |
| **Slack (Contractor Alerts)** | Free forever plan: 90-day message history, unlimited incoming webhooks | Pro plan: $7.25 / user / month | Older messages roll off after 90 days, but live alert delivery never stops. | Zero cost notification channel for dispatchers. |

---

## 2. Estimated Monthly Operating Costs at Scale

Assumptions: Average contractor voice intake call duration = 2.0 minutes. Each lead generates 1 intake call, 1 Claude extraction, 2 SMS messages, and 1 Slack notification.

### Tier 1: Demo / Proof of Concept (0–50 calls / month)
- **Vapi**: $0.00 (within $10 free credit)
- **Anthropic**: $0.00 (within $5 free credit)
- **n8n**: $0.00 (self-hosted local or free cloud tier)
- **Airtable**: $0.00 (well under 1,000 records)
- **Cal.com**: $0.00 (free tier)
- **Twilio**: $0.00 (within $15 trial credit)
- **Slack**: $0.00 (free tier)
- **Total Estimated Cost: $0.00 / month**

### Tier 2: Solo Trade Contractor (250 calls / month)
- **Vapi (500 minutes @ $0.14/min)**: $70.00
- **Anthropic (250 extractions @ $0.0054)**: $1.35
- **n8n Self-Hosted (Cloud Droplet)**: $6.00
- **Airtable Free Tier**: $0.00
- **Cal.com Free Tier**: $0.00
- **Twilio (500 SMS @ $0.0079 + $1.15 phone number)**: $5.10
- **Slack Free Tier**: $0.00
- **Total Estimated Cost: ~$82.45 / month** (~$0.33 per qualified, scheduled job lead)

### Tier 3: Busy Trade Shop (1,000 calls / month)
- **Vapi (2,000 minutes @ $0.14/min)**: $280.00
- **Anthropic (1,000 extractions @ $0.0054)**: $5.40
- **n8n Self-Hosted VPS**: $12.00
- **Airtable Team Plan (50,000 records)**: $20.00
- **Cal.com Free or Team**: $0.00 – $12.00
- **Twilio (2,500 SMS + number)**: $20.90
- **Slack Free**: $0.00
- **Total Estimated Cost: ~$318.30 – $330.30 / month** (~$0.32 per qualified job lead)

---

## 3. Comparison vs. Traditional Human Answering Services

| Metric | Traditional Answering Service (e.g. Ruby, AnswerConnect) | Contractor Front Office Automation |
|---|---|---|
| **Base Monthly Retainer** | $350 – $600 / month | **$0 – $20 / month** |
| **Per-Minute Charge** | $1.75 – $2.50 / minute | **~$0.14 / minute** |
| **After-Hours / Weekend Surcharge** | +20% to +50% extra | **$0 extra (24/7/365)** |
| **Instant CRM Integration** | No (manual email summary typed by human) | **Instant (< 1 second structured CRM entry)** |
| **Live Calendar Booking** | Rarely supported or error-prone | **Direct Cal.com integration** |
| **Monthly Cost for 250 Calls** | **$875 – $1,250 / month** | **~$82.45 / month** (Over 90% savings) |
