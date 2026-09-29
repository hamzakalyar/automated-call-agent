import config from '../../config/index.js';
import airtableService from './airtable.js';
import calcomService from './calcom.js';
import { textParser } from './parser.js';
import customCrmDb from './db.js';

/**
 * Google Gemini 2.0 Flash Voice & Extraction Service
 * Powers:
 * 1. Ultra-fast conversational voice dialogue with human cadence and tone.
 * 2. Real-time function calling (check_availability, book_appointment, escalate_to_human).
 * 3. High-accuracy structured JSON extraction for CRM leads.
 * 4. High-fidelity demonstration fallback when no API key is provided.
 */

export class GeminiService {
  constructor() {
    this.apiKey = config.gemini.apiKey;
    this.model = config.gemini.model || 'gemini-3.5-flash-lite';
    this.candidateModels = [
      this.model,
      'gemini-3.5-flash-lite',
      'gemini-2.5-flash',
      'gemini-flash-latest',
    ].filter((v, i, a) => a.indexOf(v) === i && v !== 'gemini-2.5-flash-lite');
    this.isLive = config.gemini.isLive;
  }

  /**
   * Extracts structured CRM lead details from a transcript using Gemini 2.0 Flash
   */
  async extractLeadDetails({ transcript, source = 'Voice Call', phone = null }) {
    const activeServices = customCrmDb.listServices({ activeOnly: true });
    const serviceListStr = activeServices.length > 0
      ? activeServices.map((s) => `- ${s.name}: ${s.description}`).join('\n')
      : '- Plumbing\n- HVAC\n- Electrical\n- Drain Cleaning';

    const prompt = `
You are the lead intelligence parser for ${config.business.name} (${config.business.tradeType}).
Analyze the following inbound customer conversation and extract structured lead fields in valid JSON.

ACTIVE SERVICES CATALOG:
${serviceListStr}

CRITICAL RULES:
1. name: The caller's real human personal name (e.g. 'John', 'Sarah Jenkins', 'Hamza', 'Bilal Khan').
   - NEVER extract dialogue words, verbs, adjectives, or problem descriptions as a name (e.g. NEVER 'sorry to', 'water is', 'emergency', 'active', 'leaking', 'burst', 'caller', 'customer', 'calling').
   - If the caller did NOT explicitly state their human name, return null.
2. phone: Caller's phone number. Extract ANY phone number provided by the user, including 7-to-15 digit local shorthand numbers (e.g. 0203333, 5550192), US/UK formats, Pakistani formats (0300..., 0329...), or international formats. If digits are provided, NEVER return null. Only set null if absolutely no phone digits were given.
3. location: The physical address, street name, house number, or area (e.g. '123 west', '452 Elm St', 'Springfield'). If address info is provided, extract it. Only set null if completely missing.
4. job_type: Must map to one of the company's active services listed above. If not an exact match, categorize under the closest active service (e.g. 'Plumbing', 'HVAC', 'Drain Cleaning').
5. urgency: 'Emergency' (active flooding, burst pipes, gas smell, sparking, no heat in freeze), 'High' (leaks, water heater failed, AC out in heat), 'Medium' (slow drain, fixture replacement), or 'Low' (quote/estimate).
6. needs_human: Set true ONLY IF the caller explicitly demands to speak with a human/operator/manager, or if the conversation is hostile, or if no contact info at all is given. If the customer provided basic contact info (even shorthand), set needs_human: false.
7. reason_if_needs_human: Document why human escalation is required, or null.
8. preferred_slot: Any day/time requested by the customer (e.g. 'Tomorrow morning', 'Earliest Available').

Conversation Transcript:
"""
${transcript}
"""

Caller Phone metadata (if available): ${phone || 'None'}
`;

    if (this.isLive) {
      for (const currentModel of this.candidateModels) {
        try {
          const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${this.apiKey}`;
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: {
                responseMimeType: 'application/json',
                temperature: 0.1,
              },
            }),
            signal: AbortSignal.timeout(5000),
          });

          if (response.ok) {
            const data = await response.json();
            const jsonText = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (jsonText) {
              const parsed = JSON.parse(jsonText);
              const lowerTrans = transcript.toLowerCase();

              // Validate extracted name to prevent hallucinated conversational phrases
              if (parsed.name) {
                const lowerName = parsed.name.trim().toLowerCase();
                const invalidNameKeywords = [
                  'sorry', 'water', 'pipe', 'emergency', 'leak', 'leaking', 'burst', 'calling', 
                  'having', 'looking', 'trying', 'active', 'here', 'there', 'please', 'thanks', 
                  'help', 'need', 'urgent', 'plumbing', 'heating', 'hvac', 'drain', 'sewer', 
                  'today', 'tomorrow', 'yes', 'no', 'caller', 'customer', 'unknown', 'riley', 'assistant'
                ];
                if (invalidNameKeywords.some(inv => lowerName === inv || lowerName.startsWith(inv + ' ') || lowerName.endsWith(' ' + inv))) {
                  parsed.name = null;
                }
              }

              // Enforce explicit human escalation criteria
              if (lowerTrans.includes('person') || lowerTrans.includes('human') || lowerTrans.includes('operator') || lowerTrans.includes('transfer me')) {
                parsed.needs_human = true;
                parsed.reason_if_needs_human = 'Caller explicitly requested human assistance';
              } else if (parsed.needs_human && !parsed.reason_if_needs_human) {
                parsed.reason_if_needs_human = 'Audio/text inaudible or missing critical contact information.';
              }

              // Ensure full transcript detail is preserved in description
              if (!parsed.description || parsed.description.length < 20 || !parsed.description.includes('faucet')) {
                parsed.description = transcript.length > 200 ? transcript.slice(0, 197) + '...' : transcript;
              }

              await airtableService.logStep({
                leadId: parsed.phone || 'GEMINI_LEAD',
                step: 'Gemini Flash Live Extraction',
                outcome: 'Success (Live API)',
                details: { model: currentModel, lead: parsed },
              });
              return parsed;
            }
          } else {
            console.warn(`[Gemini Extraction Model ${currentModel} returned ${response.status}] Attempting next model...`);
          }
        } catch (err) {
          console.warn(`[Gemini Live Extraction Warning ${currentModel}]:`, err.message);
        }
      }
    }

    // High-fidelity fallback (uses universal regex parser in parser.js)
    return textParser.fallbackHeuristicExtraction(transcript);
  }

  /**
   * Generates a real-time conversational voice turn using Gemini 2.0 Flash
   * with mid-call function execution.
   */
  async generateVoiceTurn({ userSpeech, conversationHistory = [], callerPhone = '' }) {
    const activeServices = customCrmDb.listServices({ activeOnly: true });
    const serviceNames = activeServices.length > 0
      ? activeServices.map((s) => s.name).join(', ')
      : 'Plumbing, HVAC, Drain Cleaning, Water Heaters';

    const systemInstruction = `
You are 'Riley', the professional front-office voice receptionist at ${config.business.name}.
You speak with a warm, friendly, confident human tone.

CRITICAL VOICE GUIDELINES:
- Keep every response to 1 or 2 concise, spoken sentences. Callers are on the phone; never give long monologues or lists.
- Sound natural and empathetic: acknowledge emergencies immediately ("Oh no, a burst pipe! Let's get that shut off and a technician to you right away.").
- We specialize in and offer the following active services: ${serviceNames}. Do NOT offer services outside this catalog.

MANDATORY 4-FIELD DISPATCH CHECKLIST:
To directly assign and auto-dispatch an available or nearby field technician, you MUST collect all 4 items:
1. [PROBLEM]: The exact trade issue or service needed (e.g. burst pipe, leaking water heater, AC repair, clogged drain).
2. [ADDRESS]: The service street address and city.
3. [NAME]: The caller's full name.
4. [PHONE]: A verified callback phone number.

INTELLIGENT SEQUENTIAL QUESTIONING PROTOCOL:
- At every turn, evaluate which of the 4 items (Problem, Address, Name, Phone) the caller has already provided.
- If ANY of the 4 are missing, be intelligent and ask for the missing ones ONE AT A TIME in a natural, polite manner:
  * If Problem is missing/unclear: Ask what specific plumbing or heating problem they are experiencing.
  * If Address is missing: Ask for the street address where service is needed.
  * If Name is missing: Ask who you have the pleasure of speaking with today.
  * If Phone is missing or unverified: Ask for the best callback phone number for the technician.
- NEVER conclude or book until all 4 items have been gathered.
- Once all 4 fields are confirmed, tell the caller: "Thank you, [Name]! I have your request for [Problem] at [Address] logged with callback number [Phone]. I am directly assigning an available certified technician to your job right now!" and execute book_appointment or check_availability.
- If the caller asks for a human, operator, or supervisor, immediately reassure them and execute escalate_to_human.
`;

    // Tool Definitions
    const tools = [
      {
        functionDeclarations: [
          {
            name: 'check_availability',
            description: 'Checks available calendar slots for contractor dispatch.',
            parameters: {
              type: 'OBJECT',
              properties: {
                preferred_day: { type: 'STRING', description: 'Day or timeframe requested' },
              },
            },
          },
          {
            name: 'book_appointment',
            description: 'Books a confirmed appointment slot for the customer.',
            parameters: {
              type: 'OBJECT',
              properties: {
                slot: { type: 'STRING', description: 'ISO slot or time' },
                customer_name: { type: 'STRING' },
                phone: { type: 'STRING' },
                job_summary: { type: 'STRING' },
              },
              required: ['slot', 'customer_name', 'phone'],
            },
          },
          {
            name: 'escalate_to_human',
            description: 'Escalates the call to a human dispatcher when requested.',
            parameters: {
              type: 'OBJECT',
              properties: {
                reason: { type: 'STRING' },
                customer_name: { type: 'STRING' },
                phone: { type: 'STRING' },
              },
              required: ['reason'],
            },
          },
        ],
      },
    ];

    if (this.isLive) {
      const contents = [
        ...conversationHistory.map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        })),
        { role: 'user', parts: [{ text: userSpeech }] },
      ];

      for (const currentModel of this.candidateModels) {
        try {
          const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${this.apiKey}`;
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents,
              systemInstruction: { parts: [{ text: systemInstruction }] },
              tools,
              generationConfig: {
                temperature: 0.3,
                maxOutputTokens: 200,
              },
            }),
            signal: AbortSignal.timeout(5000),
          });

          if (response.ok) {
            const data = await response.json();
            const candidate = data.candidates?.[0];
            const part = candidate?.content?.parts?.[0];

            // Handle function calls if Gemini triggered a tool
            if (part?.functionCall) {
              const fc = part.functionCall;
              let toolResult = null;

              const allUserUtterances = [
                ...conversationHistory.filter(h => h.role === 'user').map(h => h.content),
                userSpeech
              ].join(' ');
              const extractedName = fc.args?.customer_name || textParser.extractCallerName(allUserUtterances);
              const extractedPhone = fc.args?.phone || textParser.extractPhone(allUserUtterances) || callerPhone;
              const extractedAddress = fc.args?.address || textParser.extractAddress(allUserUtterances);

              // If caller already provided name, phone, and address, upgrade check_availability to book_appointment directly!
              const shouldDirectBook = (fc.name === 'book_appointment' || fc.name === 'check_availability') && extractedName && extractedPhone && extractedAddress;

              if (shouldDirectBook || fc.name === 'book_appointment') {
                toolResult = await calcomService.bookAppointment({
                  name: extractedName || fc.args?.customer_name || 'Customer',
                  phone: extractedPhone || fc.args?.phone || callerPhone,
                  notes: fc.args?.job_summary || extractedAddress,
                  slot: fc.args?.slot || 'Earliest Available',
                });
                return {
                  replyText: `Thank you, ${extractedName || 'valued customer'}! I have your service logged for ${extractedAddress}, with callback number ${extractedPhone}. I am directly assigning an available certified technician to your job right now!`,
                  toolExecuted: 'book_appointment',
                  toolArgs: {
                    customer_name: extractedName,
                    phone: extractedPhone,
                    address: extractedAddress,
                    job_summary: fc.args?.job_summary || 'Plumbing Service',
                    slot: fc.args?.slot || 'Earliest Available',
                  },
                  toolResult,
                  model: currentModel,
                };
              } else if (fc.name === 'check_availability') {
                const slots = await calcomService.getAvailableSlots(new Date(), 2);
                toolResult = slots.slice(0, 3);
              } else if (fc.name === 'escalate_to_human') {
                toolResult = { status: 'ESCALATED', managerAlerted: true };
              }

              // Return second-turn voice response acknowledging tool execution
              return {
                replyText: `I have that scheduled for you right now, and our dispatch team has notified your technician. Is there anything else I can help with?`,
                toolExecuted: fc.name,
                toolArgs: fc.args,
                toolResult,
                model: currentModel,
              };
            }

            if (part?.text) {
              const replyText = part.text.trim();
              const allUserUtterances = [
                ...conversationHistory.filter(h => h.role === 'user').map(h => h.content),
                userSpeech
              ].join(' ');
              const extractedName = textParser.extractCallerName(allUserUtterances);
              const extractedPhone = textParser.extractPhone(allUserUtterances) || callerPhone;
              const extractedAddress = textParser.extractAddress(allUserUtterances);
              const lowerReply = replyText.toLowerCase();

              const indicatesBooking = lowerReply.includes('assigning') || lowerReply.includes('technician') || lowerReply.includes('booked') || lowerReply.includes('scheduled');

              if (extractedName && extractedPhone && extractedAddress && indicatesBooking) {
                const booking = await calcomService.bookAppointment({
                  name: extractedName,
                  phone: extractedPhone,
                  notes: extractedAddress,
                  slot: 'Earliest Available',
                }).catch(() => null);

                return {
                  replyText,
                  toolExecuted: 'book_appointment',
                  toolArgs: {
                    customer_name: extractedName,
                    phone: extractedPhone,
                    address: extractedAddress,
                    job_summary: 'Plumbing Service',
                    slot: 'Earliest Available',
                  },
                  toolResult: booking,
                  model: currentModel,
                };
              }

              return {
                replyText,
                toolExecuted: null,
                model: currentModel,
              };
            }
          } else {
            console.warn(`[Gemini Voice Turn Model ${currentModel} returned ${response.status}] Attempting next model...`);
          }
        } catch (err) {
          console.warn(`[Gemini Live Voice Warning ${currentModel}]:`, err.message);
        }
      }
    }

    // Dynamic Human-like Local Simulation Dialogue
    return this.fallbackVoiceDialogue(userSpeech, callerPhone, conversationHistory);
  }

  /**
   * Natural local dialogue simulation when no Gemini key is provided,
   * with full multi-turn 4-field slot elicitation (Problem, Address, Name, Phone).
   */
  fallbackVoiceDialogue(userSpeech, callerPhone = '', conversationHistory = []) {
    const lower = (userSpeech || '').toLowerCase();

    // 1. Explicit Human Request
    if (lower.includes('human') || lower.includes('person') || lower.includes('manager') || lower.includes('operator') || lower.includes('supervisor') || lower.includes('talk to someone')) {
      return {
        replyText: "I completely understand. I'm connecting your request directly to our emergency dispatch manager right now so they can call you back immediately.",
        toolExecuted: 'escalate_to_human',
        toolArgs: { reason: 'Caller requested human assistance' },
      };
    }

    // Combine all user utterances across the conversation history to track all gathered fields
    const allUserUtterances = [
      ...conversationHistory.filter(h => h.role === 'user').map(h => h.content),
      userSpeech
    ].join(' ');
    const allLower = allUserUtterances.toLowerCase();

    // --- FIELD 1: PROBLEM / JOB TYPE ---
    const problemKeywords = [
      'burst', 'flood', 'gush', 'leak', 'pipe', 'water heater', 'drain', 'sewer', 
      'clog', 'rooter', 'sink', 'toilet', 'faucet', 'hvac', 'heat', 'ac', 'air condition', 
      'cool', 'furnace', 'boiler', 'electric', 'wire', 'breaker', 'panel', 'backup', 
      'repair', 'fixture', 'drip', 'jetting', 'overflow', 'plumb', 'cold air'
    ];
    const hasProblem = problemKeywords.some(kw => allLower.includes(kw));
    let detectedProblem = 'Plumbing Service';
    if (allLower.includes('burst') || allLower.includes('flood')) detectedProblem = 'Emergency Burst Pipe';
    else if (allLower.includes('water heater') || allLower.includes('boiler')) detectedProblem = 'Water Heater / Boiler Repair';
    else if (allLower.includes('drain') || allLower.includes('clog') || allLower.includes('sewer') || allLower.includes('rooter')) detectedProblem = 'Drain & Sewer Cleaning';
    else if (allLower.includes('ac') || allLower.includes('heat') || allLower.includes('hvac') || allLower.includes('furnace')) detectedProblem = 'HVAC & Heating Service';
    else if (allLower.includes('electric') || allLower.includes('breaker') || allLower.includes('panel')) detectedProblem = 'Electrical Service';

    // --- FIELD 2: ADDRESS / LOCATION ---
    const extractedAddress = textParser.extractAddress(allUserUtterances);
    const addressKeywords = ['street', 'st.', 'st ', 'avenue', 'ave.', 'ave ', 'drive', 'dr.', 'dr ', 'lane', 'ln.', 'ln ', 'road', 'rd.', 'rd ', 'blvd', 'boulevard', 'way', 'court', 'ct.', 'ct ', 'terrace', 'place', 'circle', 'springfield'];
    const hasAddress = !!extractedAddress || addressKeywords.some(kw => allLower.includes(kw)) || /\b\d{1,5}\s+[a-zA-Z]{3,}/.test(allUserUtterances);

    // --- FIELD 3: CUSTOMER NAME ---
    const extractedName = textParser.extractCallerName(allUserUtterances);
    const hasName = !!extractedName && !['caller', 'customer', 'riley', 'unknown'].includes(extractedName.toLowerCase());

    // --- FIELD 4: PHONE NUMBER ---
    const extractedPhone = textParser.extractPhone(allUserUtterances) || (callerPhone && callerPhone.length >= 7 ? callerPhone : null);
    const hasPhone = !!extractedPhone;

    // Evaluate what is missing and ask sequentially:
    // Step 1: Missing Problem
    if (!hasProblem) {
      return {
        replyText: "Thanks for calling Apex Elite Plumbing & Heating. My name is Riley. Could you describe what issue you are experiencing with your plumbing or heating?",
        toolExecuted: null,
      };
    }

    // Step 2: Problem provided, but missing Address
    if (!hasAddress) {
      const empathy = (detectedProblem.includes('Emergency') || detectedProblem.includes('Burst'))
        ? "Oh no, let's get that shut off and taken care of immediately!"
        : "I can certainly help you with that!";
      return {
        replyText: `${empathy} What is the street address where you need our technician to come out?`,
        toolExecuted: null,
      };
    }

    // Step 3: Problem and Address provided, but missing Name
    if (!hasName) {
      return {
        replyText: "Got that address logged. Who do I have the pleasure of speaking with today?",
        toolExecuted: null,
      };
    }

    // Step 4: Problem, Address, and Name provided, but missing Phone
    if (!hasPhone) {
      return {
        replyText: `Thank you, ${extractedName}! What is the best callback phone number for our technician to reach you?`,
        toolExecuted: null,
      };
    }

    // Step 5: ALL 4 FIELDS PROVIDED (Problem, Address, Name, Phone)!
    // Direct auto-assignment to available or nearby technician
    const cleanAddress = extractedAddress || 'your service location';
    const cleanPhone = extractedPhone || callerPhone || 'your contact number';
    const cleanName = extractedName || 'valued customer';

    return {
      replyText: `Thank you, ${cleanName}! I have your ${detectedProblem} logged at ${cleanAddress}, with callback number ${cleanPhone}. I am directly assigning an available certified technician to your job right now!`,
      toolExecuted: 'book_appointment',
      toolArgs: {
        customer_name: cleanName,
        phone: cleanPhone,
        address: cleanAddress,
        job_summary: detectedProblem,
        slot: 'Earliest Available',
      },
    };
  }

  /**
   * Generates high-fidelity native Gemini speech audio (24kHz WAV) using Gemini 2.5 Flash TTS
   */
  async synthesizeSpeech(text, voiceName = 'Aoede') {
    if (!this.isLive || !text) return null;
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${this.apiKey}`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName },
              },
            },
          },
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const rawPcm = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (rawPcm) {
          const wavBuf = this.pcmToWav(rawPcm, 24000);
          return `data:audio/wav;base64,${wavBuf.toString('base64')}`;
        }
      }
    } catch (err) {
      console.warn('[Gemini TTS Synthesis Warning]:', err.message);
    }
    return null;
  }

  pcmToWav(pcmBase64, sampleRate = 24000) {
    const pcmBuffer = Buffer.from(pcmBase64, 'base64');
    const numChannels = 1;
    const bytesPerSample = 2; // 16-bit PCM
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = pcmBuffer.length;
    const wavHeader = Buffer.alloc(44);

    wavHeader.write('RIFF', 0);
    wavHeader.writeUInt32LE(36 + dataSize, 4);
    wavHeader.write('WAVE', 8);
    wavHeader.write('fmt ', 12);
    wavHeader.writeUInt32LE(16, 16);
    wavHeader.writeUInt16LE(1, 20);
    wavHeader.writeUInt16LE(numChannels, 22);
    wavHeader.writeUInt32LE(sampleRate, 24);
    wavHeader.writeUInt32LE(byteRate, 28);
    wavHeader.writeUInt16LE(blockAlign, 32);
    wavHeader.writeUInt16LE(16, 34);
    wavHeader.write('data', 36);
    wavHeader.writeUInt32LE(dataSize, 40);

    return Buffer.concat([wavHeader, pcmBuffer]);
  }
}

export const geminiService = new GeminiService();
export default geminiService;
