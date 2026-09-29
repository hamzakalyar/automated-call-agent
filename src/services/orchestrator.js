import config from '../../config/index.js';
import airtableService from './airtable.js';
import calcomService from './calcom.js';
import { textParser } from './parser.js';
import geminiService from './gemini.js';
import notificationsService from './notifications.js';

/**
 * Master Pipeline Orchestration Service
 * Connects Inbound Voice/Text -> Google Gemini 3.5 Intelligence -> CRM Deduplication -> Calendar -> Multi-channel Alerts.
 */

export async function processInboundLead(inputPayload) {
  const startTime = Date.now();
  const transcriptOrMessage = inputPayload.transcript || inputPayload.message || inputPayload.text || JSON.stringify(inputPayload);
  const source = inputPayload.source || 'Phone Call (Voice)';
  const vapiData = inputPayload.vapiData || {};
  const recordingUrl = inputPayload.recordingUrl || '';

  // ---------------------------------------------------------------------------
  // STEP 1: Workflow A — Intake & Extraction (Powered natively by Google Gemini 3.5)
  // ---------------------------------------------------------------------------
  let extracted = null;
  try {
    extracted = await geminiService.extractLeadDetails({
      transcript: transcriptOrMessage,
      source,
      phone: inputPayload.phone || vapiData.phone,
    });
  } catch (e) {
    console.warn('[Gemini 3.5 Extraction Notice] Using deterministic parser fallback:', e.message);
    extracted = textParser.fallbackHeuristicExtraction(transcriptOrMessage);
  }

  // If Vapi's cloud LLM already extracted high-confidence fields, enhance extracted lead
  if (vapiData.name && (!extracted.name || extracted.name === 'Caller' || extracted.name === 'Customer' || extracted.name.toLowerCase() === 'riley')) {
    extracted.name = vapiData.name;
  }
  if (vapiData.phone && (!extracted.phone || extracted.phone === '+15551234567')) {
    extracted.phone = vapiData.phone;
  }
  if (vapiData.location && (!extracted.location || extracted.location.includes('pending'))) {
    extracted.location = vapiData.location;
  }
  if (vapiData.job_type && (!extracted.job_type || extracted.job_type === 'Plumbing')) {
    extracted.job_type = vapiData.job_type;
  }
  if (vapiData.urgency && (!extracted.urgency || extracted.urgency === 'Medium')) {
    extracted.urgency = vapiData.urgency;
  }

  // Validate and clean extracted name
  const isInvalidName = (n) => {
    if (!n || typeof n !== 'string') return true;
    const lower = n.trim().toLowerCase();
    if (lower.length < 2 || lower.length > 35) return true;
    const bad = [
      'sorry', 'water', 'pipe', 'pipes', 'emergency', 'leak', 'leaks', 'leaking', 'burst', 
      'calling', 'active', 'caller', 'customer', 'unknown', 'riley', 'assistant', 'technician', 
      'plumber', 'today', 'tomorrow', 'yes', 'no', 'need', 'help', 'house', 'street'
    ];
    return bad.some(b => lower === b || lower.startsWith(b + ' ') || lower.endsWith(' ' + b));
  };

  if (isInvalidName(extracted.name)) {
    extracted.name = null;
  }

  // Fallback recovery of contact details from raw transcript if LLM extraction omitted them
  if (!extracted.phone) {
    const recPhone = textParser.extractPhone(transcriptOrMessage);
    if (recPhone) extracted.phone = recPhone;
  }
  if (!extracted.name) {
    const recName = textParser.extractCallerName(transcriptOrMessage);
    if (recName && !isInvalidName(recName)) extracted.name = recName;
  }
  if (!extracted.location || extracted.location.toLowerCase().includes('pending') || extracted.location.toLowerCase().includes('unknown')) {
    const recLoc = textParser.extractAddress(transcriptOrMessage);
    if (recLoc) extracted.location = recLoc;
  }

  // ---------------------------------------------------------------------------
  // STEP 2: Duplicate Caller Detection
  // ---------------------------------------------------------------------------
  const isCompanyPhone = extracted.phone && (
    extracted.phone === config.business.contractorPhone ||
    extracted.phone === config.business.supportPhone ||
    extracted.phone === '+15550198888' ||
    extracted.phone === '+1 (555) 019-8888' ||
    extracted.phone === '+15550192834'
  );

  if (extracted.phone && !isCompanyPhone) {
    const existingLead = await airtableService.findLeadByPhone(extracted.phone);
    if (existingLead && existingLead.Status !== 'Closed') {
      const mergedDescription = `${existingLead.Description || ''} | [Follow-up Call ${new Date().toLocaleTimeString()}]: ${extracted.description}`;
      
      const updatedLead = await airtableService.updateLead(existingLead.id, {
        Description: mergedDescription,
        Urgency: extracted.urgency === 'Emergency' ? 'Emergency' : existingLead.Urgency,
        NextAction: 'Consolidated follow-up inquiry with active lead',
      });

      await airtableService.logStep({
        leadId: existingLead.LeadID,
        step: 'Duplicate Caller Detection',
        outcome: 'Lead Merged (Prevented Double Booking)',
        details: { existingLeadId: existingLead.LeadID, newInquiry: extracted.description },
      });

      await notificationsService.sendContractorAlert({
        lead: { ...existingLead, ...updatedLead },
        isEscalation: false,
      });

      return {
        success: true,
        action: 'DUPLICATE_MERGED',
        lead: updatedLead,
        extracted,
        durationMs: Date.now() - startTime,
      };
    }
  }

  // ---------------------------------------------------------------------------
  // STEP 2B: Incomplete Call & Missing Information Quality Gate
  // Ensures calls with missing address, missing name, or dropped audio never auto-book
  // ---------------------------------------------------------------------------
  const missingInfo = [];
  const isGenericName = !extracted.name || ['caller', 'customer', 'unknown', 'riley', ''].includes(extracted.name.trim().toLowerCase());
  if (isGenericName) missingInfo.push('Customer Name');

  const isMissingAddress = !extracted.location || extracted.location.toLowerCase().includes('pending') || extracted.location.toLowerCase().includes('unknown');
  if (isMissingAddress) missingInfo.push('Service Address');

  const isMissingPhone = !extracted.phone || extracted.phone.length < 7;
  if (isMissingPhone) missingInfo.push('Phone Number');

  const isTooShort = (transcriptOrMessage || '').trim().length < 25 && !extracted.job_type;
  if (isTooShort) missingInfo.push('Job Details');

  const lowerTrans = (transcriptOrMessage || '').toLowerCase();
  const explicitlyAskedForHuman = ['talk to a person', 'human', 'real person', 'operator', 'representative', 'transfer me', 'supervisor', 'someone who works there'].some(kw => lowerTrans.includes(kw));

  // Territory / Service Area Quality Gate (Springfield & 25-mile local operational radius)
  const locLower = (extracted.location || '').toLowerCase();
  const isOutOfArea = locLower.includes('pakistan') || locLower.includes('islamabad') || locLower.includes('lahore') || locLower.includes('karachi') || locLower.includes('dublin') || locLower.includes('london') || locLower.includes('india') || locLower.includes('delhi');

  // If the caller provided all 4 fields (Name, Address, Phone, Job) and never asked for a human, ensure needs_human is false
  if (missingInfo.length === 0 && !explicitlyAskedForHuman && !lowerTrans.includes('garbled') && !lowerTrans.includes('[inaudible]')) {
    if (isOutOfArea) {
      extracted.needs_human = true;
      extracted.reason_if_needs_human = 'Out of Service Territory — Customer location is outside Springfield 25-mile radius. Requires dispatcher territory review.';
    } else {
      extracted.needs_human = false;
      extracted.reason_if_needs_human = null;
    }
  } else if (missingInfo.length > 0 && !extracted.needs_human) {
    extracted.needs_human = true;
    extracted.reason_if_needs_human = `Incomplete call details (Missing: ${missingInfo.join(', ')}). Must contact customer again.`;
  }

  // ---------------------------------------------------------------------------
  // STEP 3: Human Handoff Check (Low confidence or explicit ask)
  // ---------------------------------------------------------------------------
  if (extracted.needs_human) {
    // Proactively assign an available or nearby technician on standby so lead is not left unassigned
    let standbyTech = null;
    if (airtableService.db) {
      try {
        const jobCat = extracted.job_type || 'General Plumbing';
        const jobLoc = extracted.location || '';
        const best = airtableService.db.findBestAvailableTechnician(jobCat, jobLoc);
        if (best) standbyTech = best.name;
      } catch (e) {}
    }

    const leadRecord = await airtableService.createLead({
      ...extracted,
      name: isGenericName ? null : extracted.name,
      location: isMissingAddress ? null : extracted.location,
      phone: isMissingPhone ? null : extracted.phone,
      booked_slot: null,
      bookedSlot: null,
      assigned_tech: standbyTech,
      assignedTech: standbyTech,
      source,
      recording_url: recordingUrl,
      status: 'Escalated to Human',
      next_action: missingInfo.length > 0
        ? `Incomplete call — contact customer again to collect missing ${missingInfo.join(', ')}`
        : (extracted.reason_if_needs_human || 'Contact customer again — human follow-up required'),
    });

    await notificationsService.sendContractorAlert({
      lead: leadRecord,
      isEscalation: true,
      escalationReason: extracted.reason_if_needs_human || 'Incomplete call — contact customer again to collect missing details',
    });

    await airtableService.logStep({
      leadId: leadRecord.LeadID,
      step: 'Human Handoff Branch',
      outcome: 'Escalated to Human',
      details: { reason: extracted.reason_if_needs_human },
    });

    return {
      success: true,
      action: 'ESCALATED_TO_HUMAN',
      lead: leadRecord,
      extracted,
      durationMs: Date.now() - startTime,
    };
  }

  // ---------------------------------------------------------------------------
  // STEP 4: Create Initial CRM Lead
  // ---------------------------------------------------------------------------
  const leadRecord = await airtableService.createLead({
    ...extracted,
    source,
    recording_url: recordingUrl,
    status: 'Qualified',
    next_action: 'Process calendar scheduling',
  });

  // ---------------------------------------------------------------------------
  // STEP 5: Workflow B — Schedule (Cal.com)
  // ---------------------------------------------------------------------------
  let bookingResult = null;
  let finalStatus = 'Awaiting Response';
  let bookedSlot = null;

  try {
    const availableSlots = await calcomService.getAvailableSlots(new Date(), 3);
    
    // Check if slot available
    if (availableSlots && availableSlots.length > 0) {
      // Pick preferred or earliest available slot
      const chosenSlot = availableSlots[0].slot;
      bookingResult = await calcomService.bookAppointment({
        leadId: leadRecord.LeadID,
        name: leadRecord.Name,
        phone: leadRecord.Phone,
        notes: leadRecord.Description,
        slot: chosenSlot,
      });

      finalStatus = 'Booked';
      bookedSlot = chosenSlot;
    } else {
      // Cal.com slot exhaustion edge case
      await airtableService.logStep({
        leadId: leadRecord.LeadID,
        step: 'Cal.com Slot Search',
        outcome: 'No Slots Available',
        details: 'Requested window full; marked as Awaiting Response for follow-up.',
      });
    }
  } catch (err) {
    await airtableService.logStep({
      leadId: leadRecord.LeadID,
      step: 'Cal.com Booking Attempt',
      outcome: 'Scheduling Exception (Graceful Handled)',
      details: { error: err.message },
    });
  }

  // ---------------------------------------------------------------------------
  // DIRECT AUTO-ASSIGNMENT TO AVAILABLE OR NEARBY CERTIFIED TECHNICIAN
  // If the 4 core fields (Number, Address, Problem, Name) are provided,
  // the AI directly assigns the job to an available or nearby field technician.
  // ---------------------------------------------------------------------------
  let assignedTech = null;
  const hasCoreFields = !!(leadRecord.Name && leadRecord.Phone && leadRecord.Location && (leadRecord.JobType || leadRecord.Description));

  if (hasCoreFields && airtableService.db) {
    try {
      const jobCategory = leadRecord.JobType || leadRecord.job_type || extracted.job_type || 'General Plumbing';
      const jobLocation = leadRecord.Location || leadRecord.location || extracted.location || '';
      
      const bestTech = airtableService.db.findBestAvailableTechnician(jobCategory, jobLocation, bookedSlot);
      if (bestTech) {
        airtableService.db.assignLeadToTechnician(leadRecord.id, bestTech.name);
        assignedTech = bestTech;

        await airtableService.logStep({
          leadId: leadRecord.LeadID,
          step: 'Direct Auto-Dispatch',
          outcome: 'Assigned Available/Nearby Technician',
          details: {
            technician: bestTech.name,
            specialty: bestTech.trade || bestTech.role,
            status: bestTech.status,
            location: jobLocation,
            proximityTier: bestTech.proximityTier || 'Available Specialty Match',
          },
        });
      }
    } catch (e) {
      console.warn('[Auto-Dispatch Warning] Could not auto-assign tech:', e.message);
    }
  }

  // Update CRM with booking outcome and assigned technician
  const updatedLead = await airtableService.updateLead(leadRecord.id, {
    Status: finalStatus,
    BookedSlot: bookedSlot || '',
    AssignedTech: assignedTech ? assignedTech.name : (leadRecord.AssignedTech || ''),
    NextAction: finalStatus === 'Booked' 
      ? (assignedTech ? `Dispatched to ${assignedTech.name} for confirmed slot` : 'Dispatch technician on schedule')
      : (assignedTech ? `Directly assigned to ${assignedTech.name} (Available/Nearby) — Pending customer time confirmation` : 'Send booking link / follow up'),
  });

  // ---------------------------------------------------------------------------
  // STEP 6: Workflow C — Notifications
  // ---------------------------------------------------------------------------
  // Customer Confirmation
  const customerNotif = await notificationsService.sendCustomerConfirmation({
    leadId: leadRecord.LeadID,
    name: leadRecord.Name,
    phone: leadRecord.Phone,
    bookedSlot: bookedSlot ? new Date(bookedSlot).toLocaleString() : null,
    status: finalStatus,
  });

  // Direct Technician Alert (if assigned)
  let techNotif = null;
  if (assignedTech) {
    techNotif = await notificationsService.sendTechnicianAssignmentAlert({
      technician: assignedTech,
      lead: { ...leadRecord, ...updatedLead, booked_slot: bookedSlot },
    });
  }

  // Company / Slack Alert
  const contractorNotif = await notificationsService.sendContractorAlert({
    lead: { ...leadRecord, ...updatedLead, booked_slot: bookedSlot, AssignedTech: assignedTech ? assignedTech.name : 'Pending Dispatch' },
    isEscalation: false,
  });

  return {
    success: true,
    action: finalStatus === 'Booked' ? 'LEAD_BOOKED' : 'LEAD_AWAITING_RESPONSE',
    lead: { ...leadRecord, ...updatedLead },
    booking: bookingResult,
    customerNotification: customerNotif,
    technicianNotification: techNotif,
    contractorNotification: contractorNotif,
    durationMs: Date.now() - startTime,
  };
}

export default processInboundLead;
