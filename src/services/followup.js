import config from '../../config/index.js';
import airtableService from './airtable.js';
import notificationsService from './notifications.js';
import { getNotificationTemplates } from '../../config/prompt_templates.js';

/**
 * Follow-up & Second-Stage Automation Engine
 * Handles timer-based nudges for unbooked leads and post-service review requests.
 */

class FollowupService {
  constructor() {
    this.templates = getNotificationTemplates({
      businessName: config.business.name,
      supportPhone: config.business.supportPhone,
    });
  }

  /**
   * Evaluates all unprogressed and completed leads against the configured delay windows.
   */
  async checkAndRunFollowups() {
    const leads = await airtableService.listLeads(200);
    const now = Date.now();
    const followupWindowMs = config.delays.followupDelayHours * 60 * 60 * 1000;
    const secondStageWindowMs = config.delays.secondStageDelayHours * 60 * 60 * 1000;

    const results = {
      followedUp: [],
      escalated: [],
      secondStageTriggered: [],
    };

    for (const lead of leads) {
      const createdTime = new Date(lead.CreatedAt || lead.createdTime || now).getTime();
      const ageMs = now - createdTime;

      // 1. Stage 1 Follow-up: 'Awaiting Response' -> 'Followed Up'
      if (lead.Status === 'Awaiting Response') {
        if (ageMs >= followupWindowMs) {
          const res = await this.triggerLeadFollowup(lead);
          results.followedUp.push(res);
        }
      }

      // 2. Stage 2 Follow-up: 'Followed Up' -> 'Escalated to Human'
      else if (lead.Status === 'Followed Up') {
        if (ageMs >= followupWindowMs * 2) {
          const res = await this.escalateUnresponsiveLead(lead);
          results.escalated.push(res);
        }
      }

      // 3. Second-Stage: 'Booked' and slot passed -> Review Request
      else if (lead.Status === 'Booked' && lead.BookedSlot) {
        const slotTime = new Date(lead.BookedSlot).getTime();
        if (now > slotTime && (now - slotTime) >= secondStageWindowMs) {
          const res = await this.triggerSecondStage(lead);
          results.secondStageTriggered.push(res);
        }
      }
    }

    return results;
  }

  /**
   * Executes follow-up nudge for an unbooked lead.
   */
  async triggerLeadFollowup(lead) {
    const leadId = lead.LeadID || lead.leadId || lead.id;
    const name = lead.Name || lead.name || 'Valued Customer';
    const phone = lead.Phone || lead.phone;

    const message = this.templates.customerFollowupNudge(name);

    // Send SMS / Email nudge
    await notificationsService.sendTwilioSMS(phone, message);

    // Update Airtable
    await airtableService.updateLead(lead.id || leadId, {
      Status: 'Followed Up',
      NextAction: 'Awaiting customer response to nudge',
    });

    await airtableService.logStep({
      leadId,
      step: 'Follow-up Timer Check',
      outcome: 'Triggered (Followed Up)',
      details: {
        configuredDelayHours: config.delays.followupDelayHours,
        nudgeMessage: message,
      },
    });

    notificationsService.sentFeed.unshift({
      id: `flw_${Date.now().toString(36)}`,
      timestamp: new Date().toISOString(),
      recipient: `${name} (${phone})`,
      type: 'Follow-up Nudge',
      channel: 'SMS Follow-up',
      message,
      status: 'DELIVERED',
    });

    return { leadId, status: 'Followed Up' };
  }

  /**
   * Escalates unresponsive lead to human contractor after multiple missed attempts.
   */
  async escalateUnresponsiveLead(lead) {
    const leadId = lead.LeadID || lead.leadId || lead.id;
    const reason = `Lead remained unbooked after ${config.delays.followupDelayHours * 2} hours and multiple automated nudges.`;

    await airtableService.updateLead(lead.id || leadId, {
      Status: 'Escalated to Human',
      NextAction: 'Contractor phone call required',
    });

    await notificationsService.sendContractorAlert({
      lead,
      isEscalation: true,
      escalationReason: reason,
    });

    await airtableService.logStep({
      leadId,
      step: 'Unresponsive Lead Escalation',
      outcome: 'Escalated to Human',
      details: { reason },
    });

    return { leadId, status: 'Escalated to Human', reason };
  }

  /**
   * Executes Second-Stage Automation: Post-job review request or quote follow-up.
   */
  async triggerSecondStage(lead) {
    const leadId = lead.LeadID || lead.leadId || lead.id;
    const name = lead.Name || lead.name || 'Valued Customer';
    const phone = lead.Phone || lead.phone;

    const reviewMsg = this.templates.customerReviewRequest(name);
    await notificationsService.sendTwilioSMS(phone, reviewMsg);

    await airtableService.updateLead(lead.id || leadId, {
      Status: 'Closed',
      NextAction: 'Review request sent / service completed',
    });

    await airtableService.logStep({
      leadId,
      step: 'Second-Stage Automation',
      outcome: 'Success (Review Request Sent)',
      details: { reviewMsg },
    });

    notificationsService.sentFeed.unshift({
      id: `rev_${Date.now().toString(36)}`,
      timestamp: new Date().toISOString(),
      recipient: `${name} (${phone})`,
      type: 'Second-Stage: Review Request',
      channel: 'SMS Review Automation',
      message: reviewMsg,
      status: 'DELIVERED',
    });

    return { leadId, status: 'Closed', reviewSent: true };
  }
}

export const followupService = new FollowupService();
export default followupService;
