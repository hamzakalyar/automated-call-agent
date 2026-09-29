import config from '../../config/index.js';
import customCrmDb from './db.js';

/**
 * Apex CRM Service
 * Backed natively by high-performance embedded SQLite database (data/apex_crm.sqlite),
 * with optional dual-sync support for Airtable REST API if external cloud keys are provided.
 */

class AirtableService {
  constructor() {
    this.isLive = config.airtable.isLive;
    this.baseId = config.airtable.baseId;
    this.leadsTable = config.airtable.leadsTable;
    this.logTable = config.airtable.logTable;
    this.token = config.airtable.accessToken;
    this.db = customCrmDb;
  }

  async createLead(leadData) {
    const recordFields = {
      LeadID: leadData.leadId || leadData.LeadID || `LD-${Date.now().toString(36).toUpperCase()}`,
      Name: leadData.name || leadData.Name || 'Unknown Caller',
      Phone: leadData.phone || leadData.Phone || '',
      Location: leadData.location || leadData.Location || '',
      JobType: leadData.job_type || leadData.jobType || leadData.JobType || 'General Plumbing',
      Urgency: leadData.urgency || leadData.Urgency || 'Medium',
      Description: leadData.description || leadData.Description || '',
      PhotoLinks: Array.isArray(leadData.photo_links) ? leadData.photo_links.join(', ') : (leadData.photo_links || ''),
      Status: leadData.status || leadData.Status || 'New Lead',
      CreatedAt: new Date().toISOString(),
      BookedSlot: leadData.booked_slot || leadData.bookedSlot || leadData.BookedSlot || '',
      NextAction: leadData.next_action || leadData.nextAction || leadData.NextAction || 'Schedule appointment',
      Source: leadData.source || leadData.Source || 'Inbound Voice',
      RecordingUrl: leadData.recording_url || leadData.recordingUrl || leadData.RecordingUrl || '',
      TechnicianNotes: leadData.technician_notes || leadData.technicianNotes || leadData.TechnicianNotes || '',
    };

    if (this.isLive) {
      try {
        const res = await fetch(`https://api.airtable.com/v0/${this.baseId}/${encodeURIComponent(this.leadsTable)}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ fields: recordFields }),
        });

        if (res.ok) {
          const data = await res.json();
          await this.logStep({
            leadId: recordFields.LeadID,
            step: 'CRM Lead Creation',
            outcome: 'Success (Live Airtable)',
            details: { recordId: data.id, ...recordFields },
          });
          return { id: data.id, ...data.fields };
        }
      } catch (err) {
        console.error('[Airtable Live Error] Fallback to Custom SQLite CRM:', err.message);
      }
    }

    // Persist in native SQLite CRM database
    const saved = this.db.createLead(recordFields);

    await this.logStep({
      leadId: recordFields.LeadID,
      step: 'CRM Lead Creation',
      outcome: 'Success (Custom SQLite CRM)',
      details: recordFields,
    });

    return saved;
  }

  async updateLead(leadIdOrRecordId, updates) {
    if (this.isLive) {
      try {
        const res = await fetch(`https://api.airtable.com/v0/${this.baseId}/${encodeURIComponent(this.leadsTable)}/${leadIdOrRecordId}`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${this.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ fields: updates }),
        });

        if (res.ok) {
          const data = await res.json();
          await this.logStep({
            leadId: data.fields.LeadID || leadIdOrRecordId,
            step: 'CRM Lead Update',
            outcome: 'Success (Live Airtable)',
            details: updates,
          });
          return { id: data.id, ...data.fields };
        }
      } catch (err) {
        console.warn('[Airtable Update Error] Updating custom SQLite database:', err.message);
      }
    }

    // Update in native SQLite database
    const updated = this.db.updateLead(leadIdOrRecordId, updates);
    if (updated) {
      await this.logStep({
        leadId: updated.LeadID,
        step: 'CRM Lead Update',
        outcome: 'Success (Custom SQLite CRM)',
        details: updates,
      });
      return updated;
    }

    return null;
  }

  async deleteLead(leadIdOrRecordId) {
    return this.db.deleteLead(leadIdOrRecordId);
  }

  async findLeadByPhone(phone) {
    if (!phone) return null;
    const cleanPhone = phone.replace(/[^\d+]/g, '');

    if (this.isLive) {
      try {
        const formula = encodeURIComponent(`{Phone} = '${cleanPhone}'`);
        const res = await fetch(`https://api.airtable.com/v0/${this.baseId}/${encodeURIComponent(this.leadsTable)}?filterByFormula=${formula}`, {
          headers: { Authorization: `Bearer ${this.token}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (data.records && data.records.length > 0) {
            return { id: data.records[0].id, ...data.records[0].fields };
          }
        }
      } catch (err) {
        console.warn('[Airtable Lookup Error] Checking custom SQLite database:', err.message);
      }
    }

    return this.db.findLeadByPhone(phone);
  }

  async listLeads(limit = 100) {
    if (this.isLive) {
      try {
        const res = await fetch(`https://api.airtable.com/v0/${this.baseId}/${encodeURIComponent(this.leadsTable)}?maxRecords=${limit}`, {
          headers: { Authorization: `Bearer ${this.token}` },
        });
        if (res.ok) {
          const data = await res.json();
          return data.records.map((r) => ({ id: r.id, ...r.fields }));
        }
      } catch (err) {
        console.warn('[Airtable List Error] Reading custom SQLite database:', err.message);
      }
    }

    return this.db.listLeads(limit);
  }

  async logStep({ leadId, step, outcome, details }) {
    const logItem = {
      Timestamp: new Date().toISOString(),
      LeadID: leadId || 'SYSTEM',
      Step: step,
      Outcome: outcome,
      Details: typeof details === 'object' ? JSON.stringify(details) : String(details || ''),
    };

    if (this.isLive) {
      try {
        await fetch(`https://api.airtable.com/v0/${this.baseId}/${encodeURIComponent(this.logTable)}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ fields: logItem }),
        });
      } catch (err) {
        // Fallback silently to custom SQLite logs
      }
    }

    return this.db.logStep({ leadId, step, outcome, details });
  }

  async listLogs(limit = 100) {
    if (this.isLive) {
      try {
        const res = await fetch(`https://api.airtable.com/v0/${this.baseId}/${encodeURIComponent(this.logTable)}?maxRecords=${limit}&sort[0][field]=Timestamp&sort[0][direction]=desc`, {
          headers: { Authorization: `Bearer ${this.token}` },
        });
        if (res.ok) {
          const data = await res.json();
          return data.records.map((r) => ({ id: r.id, ...r.fields }));
        }
      } catch (err) {
        // Fall back to custom SQLite logs
      }
    }

    return this.db.listLogs(limit);
  }

  /**
   * Reset demonstration data back to pristine state.
   */
  async clearDemoData(options = {}) {
    const res = this.db.clearData(options);

    await this.logStep({
      leadId: 'SYSTEM',
      step: 'System Reset',
      outcome: 'Success (Custom SQLite CRM)',
      details: `Cleared ${res.clearedLeads} records back to baseline state.`,
    });

    return { clearedLeads: res.clearedLeads, success: true };
  }

  exportCSV() {
    return this.db.exportCSV();
  }
}

export const airtableService = new AirtableService();
export default airtableService;
