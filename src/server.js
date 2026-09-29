import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import config from '../config/index.js';
import airtableService from './services/airtable.js';
import calcomService from './services/calcom.js';
import notificationsService from './services/notifications.js';
import followupService from './services/followup.js';
import resetDemoEnvironment from './services/reset.js';
import processInboundLead from './services/orchestrator.js';
import geminiService from './services/gemini.js';
import customCrmDb from './services/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = fs.existsSync(path.join(__dirname, 'public'))
  ? path.join(__dirname, 'public')
  : path.resolve(process.cwd(), 'src', 'public');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(publicDir, { index: false }));

app.get('/favicon.ico', (req, res) => {
  res.type('image/svg+xml').sendFile(path.join(publicDir, 'favicon.svg'));
});

// Clean URL routing: root redirects directly to /home
app.get('/', (req, res) => {
  res.redirect(302, '/home');
});

// Clean pages & role portals
app.get(['/home', '/admin', '/staff', '/customer', '/portal', '/landing', '/book', '/tracking', '/services'], (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.get(['/tech', '/van'], (req, res) => {
  res.sendFile(path.join(publicDir, 'tech.html'));
});

/**
 * Authentication & Active Session Resolver
 * Resolves current user from x-user-id header or query param.
 * Defaults to Admin Dispatcher in demo environment when unauthenticated.
 */
function resolveUser(req) {
  const authHeader = req.headers['x-user-id'] || req.headers['authorization'];
  const queryUser = req.query.as_user || req.query.userId;
  const idOrEmail = authHeader ? authHeader.replace(/^Bearer\s+/i, '').trim() : (queryUser ? String(queryUser).trim() : null);

  if (idOrEmail) {
    const user = customCrmDb.getUser(idOrEmail);
    if (user && user.active) return user;
  }

  // Default to Admin Dispatcher for demo convenience
  const admin = customCrmDb.getUser('admin@apexelite.demo');
  return admin || { id: 1, name: 'Admin Dispatcher', role: 'admin', email: 'admin@apexelite.demo' };
}

// =============================================================================
// WEBHOOK INGESTION ENDPOINTS
// =============================================================================

/**
 * Vapi Inbound Call Webhook
 * Ingests call completion payloads or mid-call tool execution requests.
 */
app.post('/api/webhooks/vapi', async (req, res) => {
  try {
    const payload = req.body;
    const message = payload.message || payload;
    console.log(`[Vapi Webhook] Inbound event type: ${message.type || 'unknown'}`);

    // Handle mid-call tool execution if Vapi is querying availability
    if (message.type === 'tool-calls') {
      const toolCall = message.toolCalls?.[0];
      if (toolCall?.function?.name === 'check_availability') {
        const slots = await calcomService.getAvailableSlots(new Date(), 2);
        return res.json({
          results: [{ toolCallId: toolCall.id, result: JSON.stringify(slots.slice(0, 3)) }],
        });
      }
      return res.json({ results: [] });
    }

    // Ignore all mid-call streaming events (conversation-update, speech-update, status-update, etc.)
    // Only process the single final 'end-of-call-report' when the call has concluded.
    if (message.type && message.type !== 'end-of-call-report') {
      return res.json({ success: true, message: `Ignored live stream event: ${message.type}` });
    }

    // End of call report or standard transcript
    const transcript = message.transcript || 
                       message.call?.transcript || 
                       message.analysis?.summary || 
                       JSON.stringify(payload);

    // Extract structured data from Vapi cloud analysis if available
    const vapiStructured = message.analysis?.structuredData || {};
    const vapiCustomer = message.call?.customer || {};
    const vapiSummary = message.analysis?.summary || message.summary;

    const vapiData = {
      name: vapiStructured.name || vapiCustomer.name || null,
      phone: vapiStructured.phone || vapiCustomer.number || null,
      location: vapiStructured.location || vapiStructured.address || null,
      job_type: vapiStructured.job_type || null,
      urgency: vapiStructured.urgency || null,
      description: vapiStructured.description || vapiSummary || null,
    };

    const recordingUrl = message.recordingUrl || message.call?.recordingUrl || payload.recordingUrl || '';

    console.log(`[Vapi Webhook] Processing call lead transcript (${transcript.length} chars)...`);
    const result = await processInboundLead({ 
      transcript, 
      source: 'Vapi Voice Agent',
      vapiData,
      recordingUrl,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[Vapi Webhook Error]', err);
    await airtableService.logStep({
      leadId: 'VAPI_ERROR',
      step: 'Vapi Webhook Ingestion',
      outcome: 'Error',
      details: err.message,
    });
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Twilio Inbound SMS & WhatsApp Webhook
 */
app.post(['/api/webhooks/twilio', '/api/webhooks/whatsapp'], async (req, res) => {
  try {
    const rawFrom = req.body.From || '';
    const body = req.body.Body || '';
    const isWhatsApp = rawFrom.startsWith('whatsapp:');
    const cleanPhone = rawFrom.replace('whatsapp:', '').trim();
    const channelSource = isWhatsApp ? 'WhatsApp Business' : 'Twilio SMS';

    console.log(`[${channelSource}] Inbound message from ${cleanPhone}: "${body.slice(0, 60)}..."`);

    const result = await processInboundLead({
      transcript: `${channelSource} from ${cleanPhone}: ${body}`,
      phone: cleanPhone,
      source: channelSource,
    });

    let replyMsg = `Hi! Thank you for contacting ${config.business.name}. We have logged your inquiry and a specialist will contact you shortly.`;
    if (result.action === 'LEAD_BOOKED' && result.lead) {
      replyMsg = `Hi ${result.lead.Name || 'there'}! Your service request has been confirmed. Technician ${result.lead.AssignedTech || 'on duty'} is dispatched to ${result.lead.Location}. Ref: ${result.lead.LeadID}.`;
    } else if (result.action === 'DUPLICATE_MERGED' && result.lead) {
      replyMsg = `Hi ${result.lead.Name || 'there'}, we received your update and attached it to your active service order (${result.lead.LeadID}).`;
    } else if (result.lead) {
      replyMsg = `Hi! We received your request. Our emergency dispatch manager has been alerted and will contact you at this number immediately. Ref: ${result.lead.LeadID}.`;
    }

    const xmlReply = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${replyMsg.replace(/[<>&"]/g, '')}</Message>
</Response>`;

    res.type('text/xml').send(xmlReply);
  } catch (err) {
    console.error('[SMS/WhatsApp Webhook Error]', err);
    res.status(500).send('<Response></Response>');
  }
});

// =============================================================================
// GOOGLE GEMINI 2.0 FLASH VOICE ENGINE ENDPOINTS
// =============================================================================

/**
 * Interactive Web Audio Dialogue Turn (Microphone -> Gemini -> Speaker)
 */
app.post('/api/voice/gemini-web-turn', async (req, res) => {
  try {
    const { userSpeech = '', history = [], callerPhone = '', needAudio = false } = req.body;
    console.log(`[Gemini Voice Turn] Inbound speech: "${userSpeech}" (needAudio: ${needAudio})`);

    const turn = await geminiService.generateVoiceTurn({
      userSpeech,
      conversationHistory: history,
      callerPhone,
    });

    let audioDataUri = null;
    if (needAudio && turn.replyText) {
      try {
        audioDataUri = await geminiService.synthesizeSpeech(turn.replyText);
      } catch (audioErr) {
        console.warn('[Gemini Voice Audio Generation Notice]:', audioErr.message);
      }
    }

    let leadResult = null;
    const fullTranscript = [
      ...history.map((h) => `${h.role === 'user' ? 'Customer' : 'Riley'}: ${h.content}`),
      `Customer: ${userSpeech}`,
      `Riley: ${turn.replyText}`,
    ].join('\n');

    // Ingest into CRM during live call ONLY if booking completed or explicit escalation triggered
    if (turn.toolExecuted === 'book_appointment' || turn.toolExecuted === 'escalate_to_human') {
      leadResult = await processInboundLead({
        transcript: fullTranscript,
        source: 'Gemini Voice Agent',
        phone: callerPhone,
      });
    }

    res.json({
      success: true,
      replyText: turn.replyText,
      audioDataUri,
      toolExecuted: turn.toolExecuted,
      toolArgs: turn.toolArgs,
      leadResult,
    });
  } catch (err) {
    console.error('[Gemini Voice Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * End-of-Call Web Voice Finalizer
 * Safely processes the full completed conversation when the caller hangs up,
 * without premature mid-call duplication.
 */
app.post('/api/voice/end-call', async (req, res) => {
  try {
    const { transcript = '', history = [], callerPhone = '' } = req.body;
    let fullTranscript = transcript;
    if (!fullTranscript && Array.isArray(history) && history.length > 0) {
      fullTranscript = history.map((h) => `${h.role === 'user' ? 'Customer' : 'Riley'}: ${h.content}`).join('\n');
    }

    if (!fullTranscript || fullTranscript.trim().length < 15) {
      return res.json({ success: true, message: 'Call transcript too short, skipped.' });
    }

    console.log(`[Voice Call Ended] Processing final transcript (${fullTranscript.length} chars)...`);
    const leadResult = await processInboundLead({
      transcript: fullTranscript,
      source: 'Gemini Voice Agent',
      phone: callerPhone,
    });

    res.json({ success: true, leadResult });
  } catch (err) {
    console.error('[Voice End-Call Processing Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Direct Twilio Phone Inbound Call (Twilio Voice -> Gemini)
 * Completely eliminates Vapi fees while providing natural conversational speech.
 */
app.post('/api/voice/incoming', (req, res) => {
  const caller = req.body.From || 'Caller';
  console.log(`[Twilio Voice Direct] Incoming telephone call from ${caller}`);

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Danielle-Neural">Thanks for calling Apex Elite Plumbing and Heating. My name is Riley.</Say>
  <Gather input="speech" action="/api/voice/gemini-turn" timeout="4" speechTimeout="auto">
    <Say voice="Polly.Danielle-Neural">Are you looking to schedule a service visit, or do you have an active emergency?</Say>
  </Gather>
</Response>`;

  res.type('text/xml').send(twiml);
});

/**
 * Twilio Voice Follow-up Turn
 */
app.post('/api/voice/gemini-turn', async (req, res) => {
  try {
    const caller = req.body.From || '';
    const userSpeech = req.body.SpeechResult || req.body.speechResult || '';
    console.log(`[Twilio Voice Speech] From ${caller}: "${userSpeech}"`);

    const turn = await geminiService.generateVoiceTurn({
      userSpeech,
      callerPhone: caller,
    });

    if (userSpeech.length > 5) {
      processInboundLead({
        transcript: `Customer (${caller}): ${userSpeech}\nRiley: ${turn.replyText}`,
        source: 'Gemini Voice Agent',
        phone: caller,
      }).catch((e) => console.warn('[Async Lead Error]', e.message));
    }

    const isFinished = turn.toolExecuted === 'book_appointment' || turn.toolExecuted === 'escalate_to_human';
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Danielle-Neural">${turn.replyText.replace(/[<>&"]/g, '')}</Say>
  ${
    isFinished
      ? '<Hangup/>'
      : '<Gather input="speech" action="/api/voice/gemini-turn" timeout="5" speechTimeout="auto"></Gather>'
  }
</Response>`;

    res.type('text/xml').send(twiml);
  } catch (err) {
    console.error('[Twilio Voice Turn Error]', err);
    res.type('text/xml').send('<Response><Say>Thank you, our dispatch manager will call you right back.</Say><Hangup/></Response>');
  }
});

// =============================================================================
// ADMIN & DEMONSTRATION CONTROL API
// =============================================================================

/**
 * Service Status & Architecture Health
 */
app.get('/api/status', (req, res) => {
  res.json({
    business: config.business,
    status: config.getServiceStatus(),
    timestamp: new Date().toISOString(),
  });
});

// =============================================================================
// ROLE-BASED AUTHENTICATION & ACCESS CONTROL API
// =============================================================================

/**
 * User Login / Identifier Lookup (Email, Phone, or User ID)
 */
app.post('/api/auth/login', (req, res) => {
  try {
    const { identifier } = req.body;
    if (!identifier) return res.status(400).json({ error: 'Email, phone, or User ID is required' });

    let user = customCrmDb.getUser(identifier);

    // Auto-create customer profile for new client lookups
    if (!user) {
      const isEmail = identifier.includes('@');
      const isPhone = /^\+?[\d\s\-()]{7,}$/.test(identifier);
      if (isEmail || isPhone) {
        user = customCrmDb.createUser({
          name: isEmail ? identifier.split('@')[0].replace(/[._]/g, ' ') : 'Customer',
          email: isEmail ? identifier.toLowerCase() : `cust_${Date.now().toString(36)}@apexelite.demo`,
          phone: isPhone ? identifier : '',
          role: 'customer',
        });
      }
    }

    if (!user) {
      return res.status(404).json({ error: 'User account not found' });
    }
    if (!user.active) {
      return res.status(403).json({ error: 'This account has been deactivated. Please contact an admin.' });
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        userId: user.user_id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Get Active Session Profile
 */
app.get('/api/auth/me', (req, res) => {
  const user = resolveUser(req);
  res.json({ user });
});

/**
 * List Demo Users (for instant 1-click role switching in demo mode)
 */
app.get('/api/auth/demo-users', (req, res) => {
  try {
    const allUsers = customCrmDb.listUsers({ activeOnly: true });
    res.json({
      admins: allUsers.filter((u) => u.role === 'admin'),
      staff: allUsers.filter((u) => u.role === 'staff'),
      customers: allUsers.filter((u) => u.role === 'customer'),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.json({ success: true, message: 'Session terminated' });
});

// =============================================================================
// PUBLIC CUSTOMER LANDING & FAST BOOKING API (NO ACCOUNT REQUIRED)
// =============================================================================

/**
 * Public Fast Booking API (Zero Account Creation Required)
 * Instant dispatch booking for homeowners and commercial clients.
 * Generates tracking code, auto-assigns technician by trade, creates customer record, and alerts dispatcher.
 */
app.post('/api/public/book', async (req, res) => {
  try {
    const {
      name,
      phone,
      email = '',
      location,
      job_type = 'General Plumbing',
      urgency = 'Medium',
      preferred_date = '',
      preferred_slot = '',
      description = '',
    } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Customer name is required' });
    }
    if (!phone || !phone.trim()) {
      return res.status(400).json({ error: 'Contact phone number is required for dispatch updates' });
    }
    if (!location || !location.trim()) {
      return res.status(400).json({ error: 'Service address is required' });
    }

    // Auto-create or link customer account profile (zero password needed)
    let customerUser = customCrmDb.getUser(phone);
    if (!customerUser && email) {
      customerUser = customCrmDb.getUser(email);
    }
    if (!customerUser) {
      customerUser = customCrmDb.createUser({
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim() || `cust_${Date.now().toString(36)}@apexelite.demo`,
        role: 'customer',
        active: 1,
      });
    }

    // Determine booked arrival window and urgency
    const lowerJob = (job_type + ' ' + description).toLowerCase();
    const isEmergency = urgency === 'Emergency' || lowerJob.includes('emergency') || lowerJob.includes('burst');
    let finalSlot = '';
    let arrivalEstimate = '';

    if (isEmergency) {
      finalSlot = 'Immediate Emergency Dispatch (Within 45-60 Mins)';
      arrivalEstimate = 'Within 45 to 60 minutes';
    } else if (preferred_slot) {
      finalSlot = preferred_date ? `${preferred_date} • ${preferred_slot}` : preferred_slot;
      arrivalEstimate = finalSlot;
    } else {
      finalSlot = 'Next Available Dispatch Window (Today 2:00 PM - 5:00 PM)';
      arrivalEstimate = 'Today between 2:00 PM - 5:00 PM';
    }

    // Auto-assign certified field technician with schedule collision prevention
    let assignedTechName = 'Dave Miller';
    let assignedStaffId = null;
    const bestTech = customCrmDb.findBestAvailableTechnician(job_type, location, finalSlot);
    if (bestTech) {
      assignedTechName = bestTech.name;
      assignedStaffId = bestTech.id || null;
    }

    // Generate readable trade-based lead ID
    const tradeSuffix = lowerJob.includes('hvac') || lowerJob.includes('ac') ? 'HV' : (lowerJob.includes('drain') ? 'DR' : 'PL');
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    const leadId = `LD-${randomNum}-${tradeSuffix}`;

    // Check territory boundary
    const locLower = (location || '').toLowerCase();
    const isOutOfArea = locLower.includes('pakistan') || locLower.includes('islamabad') || locLower.includes('lahore') || locLower.includes('karachi') || locLower.includes('dublin') || locLower.includes('london') || locLower.includes('india') || locLower.includes('delhi');

    const leadData = {
      leadId: leadId,
      lead_id: leadId,
      LeadID: leadId,
      customer_id: customerUser ? customerUser.id : null,
      assigned_staff_id: assignedStaffId,
      assigned_tech: assignedTechName,
      name: name.trim(),
      phone: phone.trim(),
      email: email.trim(),
      location: location.trim(),
      job_type: job_type.trim(),
      urgency: isEmergency ? 'Emergency' : (urgency || 'Medium'),
      status: isOutOfArea ? 'Escalated to Human' : 'Booked',
      booked_slot: finalSlot,
      description: description.trim() || `Instant booking for ${job_type}`,
      next_action: isOutOfArea 
        ? '⚠️ Out of Service Area — Contact customer for remote review or service territory referral'
        : (isEmergency ? 'Emergency technician en route' : 'Technician scheduled for arrival window'),
      source: 'Public Web Fast Booking',
    };

    const saved = customCrmDb.createLead(leadData);

    // Record immutable status audit log
    customCrmDb.logStatusChange({
      entityType: 'lead',
      entityId: saved.leadId || leadId,
      changedBy: 'Public Web Booking (No Account)',
      oldStatus: 'None',
      newStatus: 'Booked',
      note: `Customer booked ${job_type} at ${location}. Dispatched to ${assignedTechName}.`,
    });

    // Multi-channel dispatch notification alert
    notificationsService.sendContractorAlert({
      lead: saved,
      isEscalation: isEmergency,
    }).catch(e => console.warn('[Public Booking Notification Warning]', e.message));

    // Direct SMS notification dispatched to assigned technician's mobile phone
    const targetTech = activeStaff.find(s => s.name === assignedTechName) || (activeStaff.length > 0 ? activeStaff[0] : null);
    if (targetTech) {
      notificationsService.sendTechnicianAssignmentAlert({
        technician: targetTech,
        lead: saved,
      }).catch(e => console.warn('[Technician SMS Dispatch Warning]', e.message));
    }

    // Customer SMS booking confirmation with arrival window & tracking details
    notificationsService.sendCustomerConfirmation({
      leadId: saved.leadId || leadId,
      name: name.trim(),
      phone: phone.trim(),
      email: email.trim(),
      bookedSlot: finalSlot,
      status: 'Booked',
      source: 'Public Web Fast Booking',
    }).catch(e => console.warn('[Customer SMS Dispatch Warning]', e.message));

    // First name format for privacy
    const techParts = assignedTechName.split(' ');
    const publicTechName = techParts.length > 1 ? `${techParts[0]} ${techParts[1][0]}.` : techParts[0];

    const actualTrackingId = saved.leadId || saved.LeadID || leadId;

    res.json({
      success: true,
      lead: saved,
      trackingId: actualTrackingId,
      customerName: name.trim(),
      customerPhone: phone.trim(),
      assignedTech: publicTechName,
      estimatedArrival: arrivalEstimate,
      bookedSlot: finalSlot,
      magicLink: `/home#trackingSection`,
      message: 'Service booking confirmed! Dispatcher and field technician have been alerted.',
    });
  } catch (err) {
    console.error('[Public Booking Error]', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Public Order Tracking API (No Login Required)
 * Allows any customer to look up their job status using Tracking ID (e.g. LD-8041-PL) or Phone Number.
 */
app.get('/api/public/track', (req, res) => {
  try {
    const rawQuery = String(req.query.query || req.query.id || req.query.phone || '').trim();
    if (!rawQuery) {
      return res.status(400).json({ error: 'Please enter a Tracking ID or Phone Number' });
    }

    const cleanDigits = rawQuery.replace(/[^\d+]/g, '');
    const allLeads = customCrmDb.listLeadsScoped({ user: { role: 'admin' }, limit: 200 });

    let match = null;

    // 1. Match by Lead ID (exact or case-insensitive)
    match = allLeads.find(l => (l.leadId || '').toLowerCase() === rawQuery.toLowerCase());

    // 2. Match by partial Lead ID (e.g. 8041)
    if (!match && rawQuery.length >= 3) {
      match = allLeads.find(l => (l.leadId || '').toLowerCase().includes(rawQuery.toLowerCase()));
    }

    // 3. Match by Phone Number
    if (!match && cleanDigits.length >= 7) {
      match = allLeads.find(l => {
        const leadDigits = (l.phone || '').replace(/[^\d+]/g, '');
        return leadDigits.endsWith(cleanDigits.slice(-7)) || cleanDigits.endsWith(leadDigits.slice(-7));
      });
    }

    // 4. Match by Email
    if (!match && rawQuery.includes('@')) {
      match = allLeads.find(l => (l.email || '').toLowerCase() === rawQuery.toLowerCase());
    }

    if (!match) {
      return res.status(404).json({ error: 'No active service booking found for that Tracking ID or Phone Number.' });
    }

    // Anonymize technician to first name only for customer privacy
    let publicTech = 'Dispatched Technician';
    if (match.assignedTech) {
      const parts = match.assignedTech.split(' ');
      publicTech = parts.length > 1 ? `${parts[0]} ${parts[1][0]}.` : parts[0];
    }

    // Mask phone for privacy in public tracker
    const rawPhone = match.phone || '';
    const maskedPhone = rawPhone.length > 4 ? `***-***-${rawPhone.slice(-4)}` : rawPhone;

    // Get audit timeline logs for this lead
    const timeline = customCrmDb.listStatusLogs({ entityId: match.leadId, limit: 10 });

    res.json({
      success: true,
      lead: {
        leadId: match.leadId,
        jobType: match.jobType,
        urgency: match.urgency,
        status: match.status,
        bookedSlot: match.bookedSlot,
        assignedTech: publicTech,
        location: match.location,
        description: match.description,
        customerNotes: match.customerNotes,
        technicianNotes: match.technicianNotes,
        createdAt: match.createdAt,
        updatedAt: match.updatedAt,
        phoneMasked: maskedPhone,
        customerName: match.name,
        magicLink: `/home#trackingSection`,
      },
      timeline,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// ROLE-GATED LEADS & CRM API
// =============================================================================

/**
 * List CRM Leads (Scoped with Row-Level Security)
 * - Admin: sees all leads
 * - Staff: sees only leads assigned to them
 * - Customer: sees only their own leads
 */
app.get('/api/leads', async (req, res) => {
  try {
    const user = resolveUser(req);

    // If live Airtable is connected, sync any cloud leads into CRM
    if (airtableService.isLive) {
      try {
        const cloudLeads = await airtableService.listLeads(100);
        if (Array.isArray(cloudLeads)) {
          for (const cl of cloudLeads) {
            customCrmDb.createLead(cl);
          }
        }
      } catch (e) {
        console.warn('[Airtable Sync Notice]', e.message);
      }
    }

    const leads = customCrmDb.listLeadsScoped({ user, limit: 100 });
    res.json({
      leads,
      user: { id: user.id, name: user.name, role: user.role },
      layer: airtableService.isLive ? 'Live Airtable Cloud CRM' : 'Custom SQLite Native Relational CRM',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Bulk Sync Client-Created Leads
 * Allows client browser sessions on Vercel to sync newly created leads to the active serverless container
 */
app.post('/api/leads/sync', (req, res) => {
  try {
    const { leads = [] } = req.body;
    let synced = 0;
    if (Array.isArray(leads)) {
      for (const item of leads) {
        if (item && (item.leadId || item.lead_id || item.LeadID)) {
          customCrmDb.createLead(item);
          synced++;
        }
      }
    }
    res.json({ success: true, synced });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Get Single Lead by ID (Enforces Data-Layer Ownership)
 */
app.get('/api/leads/:id', (req, res) => {
  try {
    const user = resolveUser(req);
    const lead = customCrmDb.getLead(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    // Enforce Row-Level Security
    if (user.role === 'customer') {
      const isOwner = lead.customerId === user.id ||
        (user.phone && (lead.phone || '').replace(/[^\d+]/g, '') === (user.phone || '').replace(/[^\d+]/g, '')) ||
        (user.email && (lead.email || '').toLowerCase() === user.email.toLowerCase());
      if (!isOwner) {
        return res.status(403).json({ error: 'Access denied: You can only view your own service order' });
      }
      // Anonymize technician name to first name only
      if (lead.assignedTech) {
        const parts = lead.assignedTech.split(' ');
        lead.assignedTech = parts.length > 1 ? `${parts[0]} ${parts[1][0]}.` : parts[0];
        lead.AssignedTech = lead.assignedTech;
      }
    } else if (user.role === 'staff') {
      const isAssigned = lead.assignedStaffId === user.id || lead.assignedTech === user.name;
      if (!isAssigned) {
        return res.status(403).json({ error: 'Access denied: You can only inspect work orders assigned to you' });
      }
    }

    res.json({ lead });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Update Lead / Status Transition (Role-Gated)
 */
app.patch(['/api/leads/:id', '/api/leads/:id/status'], async (req, res) => {
  try {
    const user = resolveUser(req);
    const { id } = req.params;
    const existing = customCrmDb.getLead(id);
    if (!existing) return res.status(404).json({ error: 'Lead not found' });

    // Customers cannot directly override status
    if (user.role === 'customer') {
      return res.status(403).json({ error: 'Access denied: Customers cannot alter status directly. Use the message / reschedule request.' });
    }

    // Staff can only update their assigned jobs
    if (user.role === 'staff') {
      const isAssigned = existing.assignedStaffId === user.id || existing.assignedTech === user.name;
      if (!isAssigned) {
        return res.status(403).json({ error: 'Access denied: You can only update work orders assigned to you' });
      }
    }

    const updates = req.body;
    updates.changedBy = `${user.name} (${user.role.toUpperCase()})`;
    const updated = customCrmDb.updateLead(id, updates);

    // If status changed to In Progress or Completed, trigger customer notification
    if (updates.status && updates.status !== existing.status) {
      await notificationsService.sendCustomerStatusUpdate({
        lead: updated,
        oldStatus: existing.status,
        newStatus: updates.status,
      });
    }

    res.json({ success: true, lead: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Customer Reschedule Request or Message Submission
 */
app.post('/api/leads/:id/message', async (req, res) => {
  try {
    const user = resolveUser(req);
    const { id } = req.params;
    const { message = '', requestedSlot = '', holdVan = true } = req.body;
    const existing = customCrmDb.getLead(id);
    if (!existing) return res.status(404).json({ error: 'Lead not found' });

    if (user.role === 'customer') {
      const isOwner = existing.customerId === user.id ||
        (user.phone && (existing.phone || '').replace(/[^\d+]/g, '') === (user.phone || '').replace(/[^\d+]/g, '')) ||
        (user.email && (existing.email || '').toLowerCase() === user.email.toLowerCase());
      if (!isOwner) return res.status(403).json({ error: 'Access denied' });
    }

    const stamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const noteEntry = requestedSlot
      ? `[${stamp} Reschedule Request for ${requestedSlot}]: ${message || 'Customer requested reschedule'}`
      : `[${stamp} Customer Note${holdVan ? ' (HOLD REQUESTED)' : ''}]: ${message}`;

    const mergedNotes = existing.customerNotes ? `${existing.customerNotes}\n${noteEntry}` : noteEntry;

    // Put technician on hold if requested or if reschedule request submitted
    const newStatus = holdVan ? 'Awaiting Customer' : existing.status;
    const nextAction = holdVan
      ? `🛑 ON HOLD: ${message ? message.slice(0, 80) : 'Awaiting Customer Instructions'}`
      : existing.nextAction;

    const updated = customCrmDb.updateLead(id, {
      status: newStatus,
      customer_notes: mergedNotes,
      next_action: nextAction,
    });

    customCrmDb.logStatusChange({
      entityType: 'lead',
      entityId: existing.leadId,
      changedBy: `${user.name} (Customer)`,
      oldStatus: existing.status,
      newStatus: newStatus,
      note: holdVan ? `HOLD APPLIED: ${noteEntry}` : noteEntry,
    });

    // Notify assigned technician immediately via SMS & in-van alert
    if (holdVan && notificationsService.sendTechnicianHoldAlert) {
      await notificationsService.sendTechnicianHoldAlert({
        lead: updated,
        message,
        customerName: user.name,
        holdRequested: true,
      });
    }

    res.json({ 
      success: true, 
      lead: updated, 
      holdApplied: holdVan,
      message: holdVan 
        ? 'Your technician has been placed ON STANDBY and notified of your instructions.'
        : 'Your message has been submitted to your assigned technician.' 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Release Van Hold & Resume Dispatch (Customer or Technician)
 */
app.post('/api/leads/:id/release-hold', (req, res) => {
  try {
    const user = resolveUser(req);
    const { id } = req.params;
    const existing = customCrmDb.getLead(id);
    if (!existing) return res.status(404).json({ error: 'Lead not found' });

    // Restore to In Progress if previously booked/dispatched
    const resumedStatus = 'In Progress';
    const stamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const resumeNote = `[${stamp} Standby Released by ${user.name}]: Dispatch resumed to site.`;

    const updated = customCrmDb.updateLead(id, {
      status: resumedStatus,
      next_action: 'Dispatch active - Technician en route to property',
    });

    customCrmDb.logStatusChange({
      entityType: 'lead',
      entityId: existing.leadId,
      changedBy: `${user.name} (${user.role})`,
      oldStatus: existing.status,
      newStatus: resumedStatus,
      note: resumeNote,
    });

    res.json({
      success: true,
      lead: updated,
      message: 'Technician standby released. Dispatch is actively proceeding.',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/leads/:id/assign', async (req, res) => {
  try {
    const user = resolveUser(req);
    if (user.role === 'customer') return res.status(403).json({ error: 'Access denied' });

    const { id } = req.params;
    const { techName } = req.body;
    const lead = customCrmDb.updateLead(id, {
      assigned_tech: techName || '',
      changedBy: `${user.name} (Admin Dispatcher)`,
      statusNote: `Reassigned work order to ${techName || 'Unassigned'}`,
    });

    await airtableService.logStep({
      leadId: lead?.LeadID || id,
      step: 'Technician Field Dispatch',
      outcome: `Assigned to ${techName || 'Unassigned'}`,
      details: { technician: techName, leadId: id },
    });

    // Alert technician if valid staff
    if (lead && techName) {
      const staffList = customCrmDb.listUsers({ role: 'staff' });
      const tech = staffList.find((t) => t.name === techName);
      if (tech) {
        await notificationsService.sendTechnicianAssignmentAlert({
          technician: tech,
          lead,
        });
      }
    }

    res.json({ success: true, lead });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Export CRM Leads as CSV
 */
app.get('/api/leads/export/csv', (req, res) => {
  try {
    const csv = customCrmDb.exportCSV();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="apex_elite_leads.csv"');
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Delete Lead (Admin Only)
 */
app.delete('/api/leads/:id', (req, res) => {
  try {
    const user = resolveUser(req);
    if (user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

    const { id } = req.params;
    const success = customCrmDb.deleteLead(id);
    res.json({ success });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// DYNAMIC SERVICES CATALOG API (DRIVES AI PROMPT & CUSTOMER DISPLAY)
// =============================================================================

app.get('/api/services', (req, res) => {
  try {
    const authHeader = req.headers['x-user-id'] || req.headers['authorization'];
    const user = authHeader ? resolveUser(req) : null;
    const showAll = Boolean(user && user.role === 'admin' && req.query.all === 'true');
    const activeOnly = !showAll;
    const services = customCrmDb.listServices({ activeOnly });
    res.json({ services });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/services', (req, res) => {
  try {
    const user = resolveUser(req);
    if (user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const created = customCrmDb.createService({ ...req.body, created_by: user.name });
    res.json({ success: true, service: created });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/services/:id', (req, res) => {
  try {
    const user = resolveUser(req);
    if (user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const updated = customCrmDb.updateService(req.params.id, req.body);
    res.json({ success: true, service: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/services/:id', (req, res) => {
  try {
    const user = resolveUser(req);
    if (user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const success = customCrmDb.deleteService(req.params.id);
    res.json({ success });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// USER & TEAM MANAGEMENT API
// =============================================================================

app.get('/api/users', (req, res) => {
  try {
    const user = resolveUser(req);
    const role = req.query.role;
    // Allow staff queries so dispatch assignment dropdowns work
    if (user.role !== 'admin' && role !== 'staff') {
      return res.status(403).json({ error: 'Admin only' });
    }
    const users = customCrmDb.listUsers({ role });
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users', (req, res) => {
  try {
    const user = resolveUser(req);
    if (user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const created = customCrmDb.createUser(req.body);
    res.json({ success: true, user: created });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/users/:id', (req, res) => {
  try {
    const user = resolveUser(req);
    if (user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const updated = customCrmDb.updateUser(req.params.id, req.body);
    res.json({ success: true, user: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// STAFF LEAVE REQUESTS API
// =============================================================================

app.get('/api/leave', (req, res) => {
  try {
    const user = resolveUser(req);
    if (user.role === 'customer') return res.status(403).json({ error: 'Access denied' });
    const staffId = user.role === 'staff' ? user.id : req.query.staffId;
    const requests = customCrmDb.listLeaveRequests({ staffId });
    res.json({ requests });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/leave', (req, res) => {
  try {
    const user = resolveUser(req);
    if (user.role !== 'staff' && user.role !== 'admin') {
      return res.status(403).json({ error: 'Only staff can submit leave requests' });
    }
    const created = customCrmDb.createLeaveRequest({
      staff_id: user.id,
      staff_name: user.name,
      start_date: req.body.startDate || req.body.start_date,
      end_date: req.body.endDate || req.body.end_date,
      reason: req.body.reason,
    });
    res.json({ success: true, request: created });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/leave/:id', (req, res) => {
  try {
    const user = resolveUser(req);
    if (user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const updated = customCrmDb.updateLeaveRequest(req.params.id, {
      status: req.body.status,
      reviewed_by: user.name,
      admin_notes: req.body.adminNotes || req.body.admin_notes || '',
    });
    res.json({ success: true, request: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// STATUS AUDIT LOG API
// =============================================================================

app.get('/api/status-log/:entityId', (req, res) => {
  try {
    const user = resolveUser(req);
    const { entityId } = req.params;
    const logs = customCrmDb.listStatusLogs({ entityId });
    res.json({ logs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Backward-compatible team endpoints
app.get('/api/team', (req, res) => {
  try {
    const team = customCrmDb.listTechnicians();
    res.json({ team });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/team', (req, res) => {
  try {
    const created = customCrmDb.addTechnician(req.body);
    res.json({ success: true, member: created });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/team/:id', (req, res) => {
  try {
    const success = customCrmDb.deleteTechnician(req.params.id);
    res.json({ success });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/team/:id', (req, res) => {
  try {
    const updated = customCrmDb.updateTechnicianStatus(req.params.id, req.body.status);
    res.json({ success: true, member: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// INTEGRATIONS & DISPATCH SETTINGS API (SLACK & CAL.COM)
// =============================================================================

/**
 * Get Current Integration Settings
 */
app.get('/api/settings', (req, res) => {
  res.json({
    slack: {
      webhookUrl: config.notifications.slackWebhookUrl,
      isLive: config.notifications.isSlackLive,
      channel: config.notifications.contractorChannel,
    },
    calcom: {
      apiKey: config.calcom.apiKey ? '••••••••' + config.calcom.apiKey.slice(-4) : '',
      eventTypeId: config.calcom.eventTypeId,
      username: config.calcom.username,
      isLive: config.calcom.isLive,
    },
    delays: config.delays,
    business: config.business,
  });
});

/**
 * Update Integration Settings at Runtime
 */
app.post('/api/settings', (req, res) => {
  try {
    const { slackWebhookUrl, contractorChannel, calcomApiKey, calcomEventTypeId, followupDelayHours } = req.body;

    if (slackWebhookUrl !== undefined) {
      config.notifications.slackWebhookUrl = slackWebhookUrl.trim();
      config.notifications.isSlackLive = Boolean(slackWebhookUrl && slackWebhookUrl.startsWith('https://hooks.slack.com'));
    }

    if (contractorChannel !== undefined) {
      config.notifications.contractorChannel = contractorChannel.toLowerCase();
    }

    if (calcomApiKey !== undefined && calcomApiKey.trim()) {
      config.calcom.apiKey = calcomApiKey.trim();
    }

    if (calcomEventTypeId !== undefined) {
      config.calcom.eventTypeId = calcomEventTypeId.trim();
      config.calcom.isLive = Boolean(config.calcom.apiKey && config.calcom.eventTypeId);
      calcomService.isLive = config.calcom.isLive;
      calcomService.apiKey = config.calcom.apiKey;
      calcomService.eventTypeId = config.calcom.eventTypeId;
    }

    if (followupDelayHours !== undefined) {
      config.delays.followupDelayHours = parseFloat(followupDelayHours);
    }

    res.json({
      success: true,
      settings: {
        slack: {
          webhookUrl: config.notifications.slackWebhookUrl,
          isLive: config.notifications.isSlackLive,
          channel: config.notifications.contractorChannel,
        },
        calcom: {
          isLive: config.calcom.isLive,
          eventTypeId: config.calcom.eventTypeId,
        },
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Test Slack Alert Dispatch
 */
app.post('/api/settings/test-slack', async (req, res) => {
  try {
    const dummyLead = {
      LeadID: 'TEST-DISPATCH',
      Name: 'Sample Customer',
      Phone: '+1 (555) 019-2834',
      JobType: 'Emergency Plumbing Diagnostic',
      Urgency: 'Emergency',
      Location: '742 Evergreen Terrace',
      Description: 'Live test ping sent from Apex Elite Settings Panel to verify Slack channel delivery.',
      AssignedTech: 'Dave Miller (Master Plumber)',
      BookedSlot: 'Tomorrow at 9:00 AM',
    };

    const delivered = await notificationsService.sendContractorAlert({
      lead: dummyLead,
      isEscalation: false,
    });

    res.json({
      success: true,
      delivered: Boolean(delivered),
      channel: config.notifications.contractorChannel,
      isLive: config.notifications.isSlackLive,
      message: config.notifications.isSlackLive
        ? 'Live Slack alert sent to your channel!'
        : 'Alert logged in activity feed. (Configure Slack incoming webhook in Settings to route directly to channel).',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Test Cal.com Availability Query
 */
app.post('/api/settings/test-calcom', async (req, res) => {
  try {
    const slots = await calcomService.getAvailableSlots(new Date(), 3);
    res.json({
      success: true,
      isLive: calcomService.isLive,
      engine: calcomService.isLive ? 'Live Cal.com REST API' : 'Dynamic Local Trade Calendar Engine',
      slotsCount: slots.length,
      sampleSlots: slots.slice(0, 4),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Manual Contractor Override / Update Lead
 * Admin view acts as source of truth.
 */
app.patch('/api/leads/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    const updated = await airtableService.updateLead(id, updates);
    res.json({ success: true, lead: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * List Audit Execution Logs
 */
app.get('/api/logs', async (req, res) => {
  try {
    const logs = await airtableService.listLogs(100);
    res.json({ logs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * List Outbound Notification Feed
 */
app.get('/api/notifications', (req, res) => {
  res.json({ notifications: notificationsService.getRecentNotifications() });
});

/**
 * Interactive Call Simulation Trigger
 */
app.post('/api/simulate-call', async (req, res) => {
  try {
    const { transcript, customLead } = req.body;
    if (customLead) {
      // Directly ingest custom lead details
      const result = await processInboundLead({ transcript: JSON.stringify(customLead) });
      return res.json({ success: true, ...result });
    }
    const result = await processInboundLead({ transcript });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[Simulation Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Trigger Timer Follow-ups Check
 */
app.post('/api/followup/run', async (req, res) => {
  try {
    const results = await followupService.checkAndRunFollowups();
    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Force Follow-up or Second Stage on specific lead
 */
app.post('/api/followup/trigger/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { stage } = req.body; // 'nudge' | 'escalate' | 'review'
    const leads = await airtableService.listLeads(100);
    const lead = leads.find((l) => l.id === id || l.LeadID === id);

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    let outcome;
    if (stage === 'review') {
      outcome = await followupService.triggerSecondStage(lead);
    } else if (stage === 'escalate') {
      outcome = await followupService.escalateUnresponsiveLead(lead);
    } else {
      outcome = await followupService.triggerLeadFollowup(lead);
    }

    res.json({ success: true, outcome });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * One-Click System Reset
 */
app.post('/api/reset', async (req, res) => {
  try {
    const reseed = req.query.reseed === 'false' || req.body?.reseed === false ? false : true;
    const summary = await resetDemoEnvironment({ reseed });
    res.json(summary);
  } catch (err) {
    console.error('[Reset Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Fallback to index.html for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Start Server if not running in a serverless environment (e.g. Vercel)
const PORT = config.port;
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`=================================================================`);
    console.log(` Contractor Front Office Automation — Command Center Active`);
    console.log(` Port: ${PORT}`);
    console.log(` Inbound Voice Webhook: http://localhost:${PORT}/api/voice/incoming`);
    console.log(` Command Console: http://localhost:${PORT}`);
    console.log(` CRM Layer: ${airtableService.isLive ? 'Live Airtable API' : 'Enterprise SQLite CRM'}`);
    console.log(` Contractor Notification Channel: ${config.notifications.contractorChannel.toUpperCase()}`);
    console.log(`=================================================================`);
  });
}

export default app;
