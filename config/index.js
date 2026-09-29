import dotenv from 'dotenv';
dotenv.config();

/**
 * Centralized Configuration Module
 * Single source of truth for all environment variables, credentials, business profiles, and timeouts.
 * Strict rule: No hard-coded keys, IDs, phone numbers, or delays anywhere else in the application.
 */

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),

  // Business & Branding Profile
  business: {
    name: process.env.BUSINESS_NAME || 'Apex Elite Plumbing & Heating',
    tradeType: process.env.TRADE_TYPE || 'Plumbing, Heating & Drain Specialists',
    supportPhone: process.env.SUPPORT_PHONE || '+15550192834',
    contractorPhone: process.env.CONTRACTOR_PHONE || '+15550198888',
    contractorEmail: process.env.CONTRACTOR_EMAIL || 'dispatch@apexeliteplumbing.demo',
  },

  // Google Gemini AI (Sole Native Intelligence & Voice Engine)
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
    isLive: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 10),
  },

  // Active Voice Engine ('gemini' or 'vapi')
  voiceEngine: process.env.VOICE_ENGINE || 'gemini',

  // Voice AI (Vapi / Retell)
  vapi: {
    apiKey: process.env.VAPI_API_KEY || '',
    assistantId: process.env.VAPI_ASSISTANT_ID || '',
    phoneNumber: process.env.VAPI_PHONE_NUMBER || '+15550109999',
    retellApiKey: process.env.RETELL_API_KEY || '',
    isLive: Boolean(process.env.VAPI_API_KEY && process.env.VAPI_API_KEY.trim().length > 10),
  },

  // Twilio SMS
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    fromNumber: process.env.TWILIO_FROM_NUMBER || '+15550190000',
    testToNumber: process.env.TWILIO_TO_TEST_NUMBER || '+15550191111',
    isLive: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
  },

  // Airtable Demonstration CRM
  airtable: {
    accessToken: process.env.AIRTABLE_ACCESS_TOKEN || '',
    baseId: process.env.AIRTABLE_BASE_ID || '',
    leadsTable: process.env.AIRTABLE_LEADS_TABLE || 'Leads',
    logTable: process.env.AIRTABLE_LOG_TABLE || 'Logs',
    isLive: Boolean(process.env.AIRTABLE_ACCESS_TOKEN && process.env.AIRTABLE_BASE_ID),
  },

  // Cal.com Scheduling
  calcom: {
    apiKey: process.env.CALCOM_API_KEY || '',
    eventTypeId: process.env.CALCOM_EVENT_TYPE_ID || '',
    username: process.env.CALCOM_USERNAME || 'apex-elite',
    isLive: Boolean(process.env.CALCOM_API_KEY && process.env.CALCOM_EVENT_TYPE_ID),
  },

  // Notifications & Alerts
  notifications: {
    // Channel can be 'sms', 'email', or 'slack'
    contractorChannel: (process.env.CONTRACTOR_NOTIFY_CHANNEL || 'slack').toLowerCase(),
    slackWebhookUrl: process.env.SLACK_WEBHOOK_URL || '',
    isSlackLive: Boolean(process.env.SLACK_WEBHOOK_URL && process.env.SLACK_WEBHOOK_URL.startsWith('https://hooks.slack.com')),
  },

  // Automation Delays (in hours, float permitted for fast demo validation)
  delays: {
    followupDelayHours: parseFloat(process.env.FOLLOWUP_DELAY_HOURS || '24'),
    secondStageDelayHours: parseFloat(process.env.SECOND_STAGE_DELAY_HOURS || '48'),
  },

  /**
   * Returns a clean health status object indicating which external APIs are connected live
   * and which are using the verified demonstration fallback layer.
   */
  getServiceStatus() {
    return {
      gemini: {
        live: this.gemini.isLive,
        mode: this.gemini.isLive ? 'Live Google Gemini 3.5 Flash' : 'Demonstration Layer (Deterministic Parser)',
        model: this.gemini.model,
      },
      voiceAI: {
        live: this.vapi.isLive,
        mode: this.vapi.isLive ? 'Live Vapi API' : 'Demonstration Layer (Simulated Webhook / Inbound)',
        number: this.vapi.phoneNumber,
      },
      airtable: {
        live: this.airtable.isLive,
        mode: this.airtable.isLive ? 'Live Airtable Base' : 'Demonstration CRM Layer (In-memory / Persistent store)',
        baseId: this.airtable.baseId || 'demo-airtable-base',
      },
      calcom: {
        live: this.calcom.isLive,
        mode: this.calcom.isLive ? 'Live Cal.com API' : 'Demonstration Calendar Engine (Real slot engine)',
      },
      notifications: {
        activeChannel: this.notifications.contractorChannel,
        twilioLive: this.twilio.isLive,
        slackLive: this.notifications.isSlackLive,
      },
      delays: this.delays,
    };
  },
};

export default config;
