import airtableService from './airtable.js';
import calcomService from './calcom.js';
import notificationsService from './notifications.js';

/**
 * System Reset Service (Workflow F)
 * Restores the demonstration environment to a pristine state before sales meetings or test runs.
 */

export async function resetDemoEnvironment(options = {}) {
  const crmReset = await airtableService.clearDemoData(options);
  const calReset = await calcomService.resetTestBookings();
  
  // Clear in-memory notification log
  const clearedNotifications = notificationsService.sentFeed.length;
  notificationsService.sentFeed = [];

  const summary = {
    success: true,
    timestamp: new Date().toISOString(),
    clearedLeads: crmReset.clearedLeads,
    cancelledBookings: calReset.cancelledBookings,
    clearedNotifications,
    message: 'System successfully reset to clean baseline.',
  };

  await airtableService.logStep({
    leadId: 'SYSTEM',
    step: 'System Baseline Reset',
    outcome: 'Success',
    details: summary,
  });

  return summary;
}

export default resetDemoEnvironment;
