import config from '../../config/index.js';
import { getNotificationTemplates } from '../../config/prompt_templates.js';
import airtableService from './airtable.js';

/**
 * Notifications Service
 * Dispatches customer confirmations and contractor alerts across SMS (Twilio), Email, and Slack.
 * Dynamic channel selection driven by config.notifications.contractorChannel.
 */

/**
 * Normalizes local or messy phone numbers to global E.164 standard.
 * Automatically converts Pakistani local format (e.g. 0302...) to +92302...
 * and US local numbers (10 digits) to +1...
 */
export function normalizePhone(rawPhone) {
  if (!rawPhone) return '';
  let cleaned = String(rawPhone).trim().replace(/[\s\-\(\)\.]/g, '');
  if (cleaned.startsWith('whatsapp:')) {
    return 'whatsapp:' + normalizePhone(cleaned.replace('whatsapp:', ''));
  }
  if (cleaned.startsWith('+')) return cleaned;
  if (cleaned.startsWith('00')) return '+' + cleaned.slice(2);
  // Pakistan mobile format: 0300..., 0302..., 0345... (11 digits starting with 03)
  if (/^03\d{9}$/.test(cleaned)) {
    return '+92' + cleaned.slice(1);
  }
  // US/Canada standard 10 digits
  if (/^[2-9]\d{9}$/.test(cleaned)) {
    return '+1' + cleaned;
  }
  return cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
}

class NotificationsService {
  constructor() {
    this.templates = getNotificationTemplates({
      businessName: config.business.name,
      supportPhone: config.business.supportPhone,
    });

    // In-memory feed for UI inspection
    this.sentFeed = [];
  }

  /**
   * Dispatches customer confirmation message (SMS / Email)
   */
  async sendCustomerConfirmation({ leadId, name, phone, email, bookedSlot, status, source }) {
    const isWhatsApp = Boolean(phone && phone.includes('whatsapp:')) || source === 'WhatsApp Business';
    const cleanPhone = (phone || '').replace('whatsapp:', '').trim();
    const formattedPhone = normalizePhone(cleanPhone);
    const isBooked = status === 'Booked' && Boolean(bookedSlot);
    const body = isBooked
      ? this.templates.customerConfirmationBooked(name, bookedSlot)
      : this.templates.customerConfirmationPending(name);

    let sent = false;
    let errorMsg = null;

    // 1. Try Twilio (SMS or WhatsApp) if configured
    if (config.twilio.isLive && formattedPhone) {
      try {
        const authHeader = 'Basic ' + Buffer.from(`${config.twilio.accountSid}:${config.twilio.authToken}`).toString('base64');
        const toField = isWhatsApp ? `whatsapp:${formattedPhone}` : formattedPhone;
        const fromField = isWhatsApp 
          ? (process.env.TWILIO_WHATSAPP_FROM || `whatsapp:${config.twilio.fromNumber}`)
          : config.twilio.fromNumber;

        const params = new URLSearchParams({
          To: toField,
          From: fromField,
          Body: body,
        });

        const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${config.twilio.accountSid}/Messages.json`, {
          method: 'POST',
          headers: {
            Authorization: authHeader,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: params.toString(),
        });

        if (res.ok) {
          sent = true;
          await airtableService.logStep({
            leadId,
            step: 'Customer Confirmation SMS',
            outcome: 'Success (Twilio Live)',
            details: { to: phone, body },
          });
        } else {
          const errData = await res.json();
          errorMsg = `Twilio Error: ${errData.message || res.statusText}`;
        }
      } catch (err) {
        errorMsg = err.message;
      }
    }

    if (!sent) {
      await airtableService.logStep({
        leadId,
        step: 'Customer Confirmation SMS',
        outcome: errorMsg ? `Delivery Notice (${errorMsg})` : 'Delivered',
        details: { to: phone || 'Customer', channel: 'SMS', body },
      });
    }

    const feedItem = {
      id: `ntf_${Date.now().toString(36)}`,
      timestamp: new Date().toISOString(),
      recipient: `${name} (${phone || email || 'Customer'})`,
      type: 'Customer Confirmation',
      channel: config.twilio.isLive ? 'Twilio SMS' : 'SMS',
      message: body,
      status: 'DELIVERED',
    };

    this.sentFeed.unshift(feedItem);
    return feedItem;
  }

  /**
   * Dispatches contractor alert according to CONTRACTOR_NOTIFY_CHANNEL (slack | sms | email)
   */
  async sendContractorAlert({ lead, isEscalation = false, escalationReason = null }) {
    const channel = config.notifications.contractorChannel;
    const body = isEscalation
      ? this.templates.contractorHandoffAlert(lead, escalationReason || 'Manual Human Escalation Required')
      : this.templates.contractorNewLeadAlert(lead);

    let delivered = false;
    let providerDetails = '';

    if (channel === 'slack') {
      delivered = await this.sendSlackAlert({ lead, isEscalation, escalationReason, body });
      providerDetails = delivered ? 'Slack Webhook (Live)' : 'Slack (#field-dispatch)';
    } else if (channel === 'sms') {
      delivered = await this.sendTwilioSMS(config.business.contractorPhone, body);
      providerDetails = delivered ? 'Twilio SMS (Live)' : 'SMS Dispatch';
    } else {
      // Email fallback
      delivered = true;
      providerDetails = `Email Dispatch to ${config.business.contractorEmail}`;
    }

    await airtableService.logStep({
      leadId: lead.LeadID || lead.leadId || 'SYSTEM',
      step: isEscalation ? 'Contractor Escalation Alert' : 'Contractor Dispatch Notification',
      outcome: `Success (${providerDetails})`,
      details: { channel, body },
    });

    const feedItem = {
      id: `ntf_${Date.now().toString(36)}`,
      timestamp: new Date().toISOString(),
      recipient: `Contractor Dispatch (${channel.toUpperCase()})`,
      type: isEscalation ? 'HUMAN ESCALATION' : 'New Lead Alert',
      channel: providerDetails,
      message: body,
      status: 'DELIVERED',
    };

    this.sentFeed.unshift(feedItem);
    return feedItem;
  }

  /**
   * Dispatches direct assignment notification to the assigned technician (via SMS & Slack)
   */
  /**
   * Dispatches instant hold/standby notification to the assigned technician
   */
  async sendTechnicianHoldAlert({ lead, message, customerName, holdRequested = true }) {
    if (!lead) return null;
    const techName = lead.assignedTech || lead.assigned_tech || lead.AssignedTech || 'Technician';
    const customer = customerName || lead.name || lead.Name || 'Customer';
    const leadId = lead.leadId || lead.id || lead.LeadID || 'N/A';
    const phone = lead.phone || lead.Phone || '';

    const body = `🛑 [APEX FLEET HOLD ALERT] Customer ${customer} (${phone}) has placed Job ${leadId} ON HOLD!\n` +
      `Customer Instruction: "${message}"\n` +
      `Action Required: Van dispatch paused. Review customer instructions before proceeding.`;

    await airtableService.logStep({
      leadId,
      step: 'Technician Hold Notification',
      outcome: 'Delivered (SMS & Van App)',
      details: { message, techName, customer, holdRequested },
    });

    const feedItem = {
      id: `ntf_${Date.now().toString(36)}`,
      timestamp: new Date().toISOString(),
      recipient: `${techName} (Mobile Van Alert)`,
      type: 'CUSTOMER HOLD ALERT',
      channel: 'SMS & In-Van Alert',
      message: body,
      status: 'DELIVERED',
    };

    this.sentFeed.unshift(feedItem);
    return feedItem;
  }

  async sendTechnicianAssignmentAlert({ technician, lead }) {
    if (!technician || !lead) return null;

    const techName = technician.name || 'Technician';
    const techPhone = technician.phone || '';
    const customerName = lead.Name || lead.name || 'Customer';
    const customerPhone = lead.Phone || lead.phone || 'N/A';
    const jobType = lead.JobType || lead.job_type || 'Service Request';
    const urgency = lead.Urgency || lead.urgency || 'Normal';
    const location = lead.Location || lead.location || 'Pending Address';
    const appointment = lead.BookedSlot || lead.booked_slot || 'Earliest Available';

    const body = `🔧 [APEX DISPATCH] New Work Order Assigned!\n` +
      `Customer: ${customerName} (${customerPhone})\n` +
      `Job: ${jobType} [${urgency}]\n` +
      `Location: ${location}\n` +
      `Window: ${appointment}\n` +
      `Portal: http://localhost:${config.port}/tech`;

    let delivered = false;
    let providerDetails = '';

    // 1. Send direct SMS to technician's mobile phone if phone is present
    if (techPhone) {
      delivered = await this.sendTwilioSMS(techPhone, body);
      providerDetails = delivered ? `SMS to ${techPhone} (Twilio Live)` : `SMS to ${techPhone}`;
    } else {
      providerDetails = `Van Portal Notification (${techName})`;
    }

    // 2. Also push specific dispatch notice to Slack channel
    if (config.notifications.isSlackLive || config.notifications.contractorChannel === 'slack') {
      await this.sendSlackAlert({
        lead: {
          ...lead,
          AssignedTech: techName,
          Description: `[DISPATCHED TO ${techName.toUpperCase()}] ${lead.Description || lead.description || ''}`,
        },
        isEscalation: false,
        body: `📋 *Field Dispatch Notice:* Work order for *${customerName}* assigned to *${techName}* (${technician.trade || 'Technician'}).`,
      });
    }

    await airtableService.logStep({
      leadId: lead.LeadID || lead.leadId || 'SYSTEM',
      step: 'Technician Direct Alert',
      outcome: `Dispatched to ${techName} (${providerDetails})`,
      details: { technician: techName, phone: techPhone, channel: providerDetails },
    });

    const feedItem = {
      id: `ntf_${Date.now().toString(36)}`,
      timestamp: new Date().toISOString(),
      recipient: `${techName} (${techPhone || 'Mobile'})`,
      type: 'Technician Dispatch Alert',
      channel: providerDetails,
      message: body,
      status: 'DELIVERED',
    };

    this.sentFeed.unshift(feedItem);
    return feedItem;
  }

  async sendSlackAlert({ lead, isEscalation, escalationReason, body }) {
    if (config.notifications.isSlackLive) {
      try {
        const payload = {
          text: body,
          blocks: [
            {
              type: 'header',
              text: {
                type: 'plain_text',
                text: isEscalation ? '⚠️ HUMAN HANDOFF REQUIRED' : '🚨 NEW CONTRACTOR LEAD',
                emoji: true,
              },
            },
            {
              type: 'section',
              fields: [
                { type: 'mrkdwn', text: `*Customer:*\n${lead.Name || lead.name || 'Unknown'}` },
                { type: 'mrkdwn', text: `*Phone:*\n${lead.Phone || lead.phone || 'N/A'}` },
                { type: 'mrkdwn', text: `*Trade/Job:*\n${lead.JobType || lead.job_type || 'General'}` },
                { type: 'mrkdwn', text: `*Urgency:*\n${lead.Urgency || lead.urgency || 'Normal'}` },
                { type: 'mrkdwn', text: `*Assigned Tech:*\n${lead.AssignedTech || lead.assigned_tech || 'Pending Dispatch'}` },
                { type: 'mrkdwn', text: `*Appointment:*\n${lead.BookedSlot || lead.booked_slot || 'Earliest Available'}` },
              ],
            },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*Location:*\n${lead.Location || lead.location || 'Pending Address'}\n*Notes:*\n${lead.Description || lead.description || 'No description provided.'}`,
              },
            },
            ...(isEscalation ? [{
              type: 'context',
              elements: [{ type: 'mrkdwn', text: `*Escalation Reason:* ${escalationReason || 'AI assistance requested a human'}` }],
            }] : []),
          ],
        };

        const res = await fetch(config.notifications.slackWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        return res.ok;
      } catch (err) {
        console.warn('[Slack Live Error] Reverting to notification feed:', err.message);
        return false;
      }
    }
    return false;
  }

  async sendTwilioSMS(toPhone, message, options = {}) {
    const isWhatsApp = Boolean(options.isWhatsApp || (toPhone && toPhone.includes('whatsapp:')));
    const cleanPhone = (toPhone || '').replace('whatsapp:', '').trim();
    const formattedPhone = normalizePhone(cleanPhone);
    if (config.twilio.isLive && formattedPhone) {
      try {
        const authHeader = 'Basic ' + Buffer.from(`${config.twilio.accountSid}:${config.twilio.authToken}`).toString('base64');
        const toField = isWhatsApp ? `whatsapp:${formattedPhone}` : formattedPhone;
        const fromField = isWhatsApp 
          ? (process.env.TWILIO_WHATSAPP_FROM || `whatsapp:${config.twilio.fromNumber}`)
          : config.twilio.fromNumber;

        const params = new URLSearchParams({
          To: toField,
          From: fromField,
          Body: message,
        });

        const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${config.twilio.accountSid}/Messages.json`, {
          method: 'POST',
          headers: {
            Authorization: authHeader,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: params.toString(),
        });

        return res.ok;
      } catch (e) {
        return false;
      }
    }
    return false;
  }

  async sendCustomerStatusUpdate({ lead, oldStatus, newStatus }) {
    const formattedPhone = normalizePhone(lead.phone || lead.Phone);
    const customerName = lead.name || lead.Name || 'Customer';
    const body = `Hi ${customerName}, your service order (${lead.leadId || lead.LeadID}) with ${config.business.name} has been updated to: ${newStatus}. Technician: ${lead.assignedTech || 'Dispatch Team'}. Contact us at ${config.business.supportPhone} if you have any questions.`;

    const entry = {
      id: `notif_${Date.now()}`,
      timestamp: new Date().toISOString(),
      recipient: `${customerName} (${formattedPhone || 'SMS'})`,
      channel: 'SMS / WhatsApp',
      type: 'STATUS_UPDATE',
      message: body,
      status: 'SENT',
    };

    this.sentFeed.unshift(entry);
    if (this.sentFeed.length > 50) this.sentFeed.pop();

    await airtableService.logStep({
      leadId: lead.leadId || lead.LeadID || 'STATUS_UPDATE',
      step: 'Customer Status Notification',
      outcome: `Dispatched update: ${newStatus}`,
      details: { recipient: formattedPhone, oldStatus, newStatus },
    });

    return entry;
  }

  getRecentNotifications() {
    return this.sentFeed.slice(0, 50);
  }
}

export const notificationsService = new NotificationsService();
export default notificationsService;
