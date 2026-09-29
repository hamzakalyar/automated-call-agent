/**
 * Deterministic Text Parsing & Heuristic Fallback Utility
 * Provides fast regular expression extraction for phone numbers, street addresses,
 * and verified caller names, plus a local fallback engine when offline.
 */

export class TextParser {
  /**
   * Extracts caller human name with strict pattern recognition and English vocabulary filtering
   */
  extractCallerName(text) {
    if (!text) return null;

    const nonNameWords = new Set([
      'sorry', 'water', 'pipe', 'pipes', 'emergency', 'emergencies', 'leak', 'leaks', 
      'leaking', 'burst', 'bursting', 'calling', 'called', 'having', 'looking', 'trying', 
      'active', 'here', 'there', 'please', 'thanks', 'thank', 'help', 'need', 'needs', 
      'want', 'wants', 'house', 'home', 'street', 'road', 'avenue', 'urgent', 'asap', 
      'soon', 'fast', 'plumbing', 'heating', 'hvac', 'drain', 'sewer', 'toilet', 'sink', 
      'faucet', 'morning', 'afternoon', 'evening', 'today', 'tomorrow', 'yes', 'no', 
      'okay', 'sure', 'fine', 'good', 'well', 'just', 'still', 'also', 'about', 'some', 
      'any', 'that', 'this', 'what', 'where', 'when', 'who', 'how', 'why', 'much', 
      'many', 'customer', 'caller', 'agent', 'riley', 'assistant', 'technician', 'plumber', 
      'electrician', 'service', 'services', 'repair', 'issue', 'problem', 'flooded', 
      'flooding', 'cold', 'hot', 'heater', 'boiler', 'furnace', 'ac', 'air', 'unit', 
      'line', 'backed', 'clogged', 'apex', 'elite', 'an', 'a', 'the', 'is', 'to', 'in', 
      'at', 'my', 'your', 'our', 'it', 'its', 'so', 'very', 'not', 'talking', 'talk',
      'have', 'had', 'has', 'am', 'are', 'was', 'were', 'be', 'been', 'being', 
      'i', 'you', 'he', 'she', 'they', 'we', 'his', 'her', 'their', 'me', 'him', 'them', 'us',
      'got', 'get', 'getting', 'do', 'does', 'did', 'doing', 'can', 'could', 'would', 'should', 'will'
    ]);

    const isValidNameCandidate = (candidate) => {
      if (!candidate || candidate.length < 2 || candidate.length > 35) return false;
      const words = candidate.trim().toLowerCase().split(/\s+/);
      if (words.some((w) => nonNameWords.has(w))) return false;
      if (!/^[a-zA-Z\s\-']+$/.test(candidate)) return false;
      return true;
    };

    // Filter out assistant lines and strip caller speaker labels
    const lines = text.split('\n');
    const callerLines = lines
      .filter((line) => !line.match(/^(?:AI|Riley|Agent|Agent Riley|Assistant|Bot|System|Dispatcher|Receptionist):/i))
      .map((line) => line.replace(/^(?:Customer|Caller|You|User):\s*/i, ''))
      .join(' ');
    const sourceText = callerLines.trim().length > 3 ? callerLines : text;

    // Strict introductory patterns only
    const patterns = [
      /(?:my name is|my name's|call me|name is)\s+([A-Za-z]+(?:\s+[A-Za-z]+)?)/i,
      /(?:this is)\s+([A-Za-z]+(?:\s+[A-Za-z]+)?)\s+(?:speaking|calling|here)\b/i,
      /(?:caller\s+name|customer\s+name|name)[:\s]+([A-Za-z]+(?:\s+[A-Za-z]+)?)/i,
    ];

    for (const pat of patterns) {
      const match = sourceText.match(pat);
      if (match && match[1]) {
        const candidate = match[1].trim();
        if (isValidNameCandidate(candidate)) {
          return candidate.replace(/\b\w/g, (c) => c.toUpperCase());
        }
      }
    }

    // Shorthand leading caller name (e.g. "hamza 123 west 0203333...", "john at 55 garden...")
    const shorthandName = sourceText.match(/^(?:(?:You|Caller|Customer):\s*)?([A-Za-z]{3,20})\s+(?:at\s+)?\d+/i);
    if (shorthandName && shorthandName[1]) {
      const candidate = shorthandName[1].trim();
      if (isValidNameCandidate(candidate)) {
        return candidate.charAt(0).toUpperCase() + candidate.slice(1).toLowerCase();
      }
    }

    return null;
  }

  /**
   * Extracts phone numbers across international, Pakistani, US, and 7-to-15 digit shorthand formats
   */
  extractPhone(text) {
    if (!text) return null;

    // 1. Pakistani mobile formats: 0300-1234567, 0302 5551234, 03xx xxxxxxx, +923xx...
    const pkMatch = text.match(/(?:\+?92|0092|0)?3\d{2}[-.\s]?\d{7}\b/);
    if (pkMatch) return pkMatch[0].trim();

    // 2. International E.164 numbers (+1, +44, +92, etc.)
    const intlMatch = text.match(/\+\d{1,4}[-.\s]?(?:\(?\d{1,4}\)?[-.\s]?){1,4}\d{3,5}\b/);
    if (intlMatch) return intlMatch[0].trim();

    // 3. US / North American numbers: (555) 234-5678, 555-234-5678, +1 555...
    const usMatch = text.match(/(?:\+?1[-.\s]?)?\(?[2-9][0-9]{2}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}\b/);
    if (usMatch) return usMatch[0].trim();

    // 4. Contextual phone number phrases: "phone: 0302...", "call me at 555...", "number is..."
    const contextMatch = text.match(/(?:phone|number|mobile|call(?:\s+me)?(?:\s+at)?|cell|tel)[:\s]*([+0-9][0-9\s\-]{7,15}\d)/i);
    if (contextMatch && contextMatch[1]) return contextMatch[1].trim();

    // 5. Standalone 7 to 15 digit telephone/mobile sequence (e.g. 0203333, 5551234, 03001234567)
    const anyDigitsMatch = text.match(/\b\d{7,15}\b/);
    if (anyDigitsMatch) return anyDigitsMatch[0].trim();

    return null;
  }

  /**
   * Extracts service addresses, street numbers, Pakistani sectors, or shorthand locations
   */
  extractAddress(text) {
    if (!text) return null;
    const lines = text.split('\n');
    const callerLines = lines
      .filter((line) => !line.match(/^(?:AI|Riley|Assistant|Bot|System|Dispatcher):/i))
      .join(' ');
    const sourceText = callerLines.trim().length > 5 ? callerLines : text;

    // 1. Explicit caller address phrases: "my address is...", "address:", "located at...", "live at..."
    const phraseRegex = /(?:my\s+address\s+is|address\s+is|address:|located\s+at|living\s+at|live\s+at|house\s+at)\s+([A-Za-z0-9\s,\-\/#]+?)(?=(?:\.\s*|\s+(?:my\s+phone|phone|call\s+me|can\s+you|please|my\s+number)|$))/i;
    const phraseMatch = sourceText.match(phraseRegex);
    if (phraseMatch && phraseMatch[1] && phraseMatch[1].trim().length > 5) {
      const addr = phraseMatch[1].trim().replace(/[,\.]$/, '');
      if (!addr.match(/^(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)|tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i)) {
        return addr;
      }
    }

    // 2. Pakistani & Asian style addresses (House/Plot/Flat/Sector/Block/Phase) with strict word boundaries
    const pkRegex = /\b(?:House|Plot|Flat|Bungalow|Apartment|Apt|Sector|Block|Phase)\s+[A-Za-z0-9\-\/,\s]+?(?:Islamabad|Lahore|Karachi|Rawalpindi|Peshawar|Faisalabad|Multan|Springfield|City|Town|\.|$)/i;
    const pkMatch = sourceText.match(pkRegex);
    if (pkMatch && pkMatch[0].length > 8) {
      return pkMatch[0].replace(/[\.]$/, '').trim();
    }

    // 3. Standard Western street address (e.g. 410 Oakwood Drive, 55 Oak Terrace, 120 Elmwood St)
    const suffixRegex = /\b\d{1,5}\s+[A-Za-z0-9\s]{2,30}\b(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd|Way|Terrace|Terr|Court|Ct|Place|Pl|Creek|Circle|Cir|Parkway|Pkwy|Highway|Hwy)\b/i;
    const match = sourceText.match(suffixRegex);
    if (match) return match[0].trim();

    // 4. "in [location]" (e.g. in Springfield, in Islamabad F-7)
    const inRegex = /(?:in|near)\s+([A-Za-z0-9\s,\-\/]{4,35}(?:Springfield|Islamabad|Lahore|Karachi|Downtown|Suburbs))/i;
    const inMatch = sourceText.match(inRegex);
    if (inMatch && inMatch[1]) return inMatch[1].trim();

    // 5. Shorthand street address format (e.g. "123 west", "45 main", "77 oak")
    const shorthandRegex = /\b\d{1,5}\s+(?:north|south|east|west|[A-Za-z]{3,20})\b/i;
    const shortMatch = sourceText.match(shorthandRegex);
    if (shortMatch) {
      const candidate = shortMatch[0].trim();
      const lowerCandidate = candidate.toLowerCase();
      if (!lowerCandidate.includes('am') && !lowerCandidate.includes('pm') && !lowerCandidate.includes('hour') && !lowerCandidate.includes('minute') && !lowerCandidate.includes('gallon')) {
        return candidate.replace(/\b\w/g, (c) => c.toUpperCase());
      }
    }

    return null;
  }

  /**
   * Deterministic local heuristic extraction fallback when API network is unreachable
   */
  fallbackHeuristicExtraction(text) {
    const lower = (text || '').toLowerCase();

    // 1. Explicit Human Request detection
    const humanKeywords = ['talk to a person', 'human', 'real person', 'operator', 'representative', 'transfer me', 'supervisor', 'someone who works there'];
    const askedForHuman = humanKeywords.some((kw) => lower.includes(kw));

    if (askedForHuman) {
      return {
        name: this.extractCallerName(text) || null,
        phone: this.extractPhone(text) || null,
        location: this.extractAddress(text) || null,
        job_type: 'General Inquiry / Escalation',
        urgency: 'High',
        description: text.slice(0, 150),
        photo_links: [],
        preferred_slot: null,
        needs_human: true,
        reason_if_needs_human: 'Caller explicitly requested human assistance',
      };
    }

    // 2. Garbled / Incoherent input detection
    const isGarbled = lower.includes('garbled') || 
                      lower.includes('muffled') || 
                      lower.includes('static') ||
                      lower.includes('[inaudible]') ||
                      (text.length < 15 && !lower.includes('help'));

    if (isGarbled) {
      return {
        name: null,
        phone: null,
        location: null,
        job_type: 'Unknown',
        urgency: 'Medium',
        description: 'Audio or message content was inaudible/garbled.',
        photo_links: [],
        preferred_slot: null,
        needs_human: true,
        reason_if_needs_human: 'Audio/text inaudible or missing critical contact information.',
      };
    }

    // 3. Extract Name, Phone, and Address
    const name = this.extractCallerName(text);
    const phone = this.extractPhone(text);
    const location = this.extractAddress(text);

    // 4. Urgency & Job Type Classification
    let urgency = 'Medium';
    let jobType = 'Plumbing';

    if (lower.includes('burst') || lower.includes('flood') || lower.includes('gushing') || lower.includes('gas') || lower.includes('sparking') || lower.includes('emergency')) {
      urgency = 'Emergency';
    } else if (lower.includes('leak') || lower.includes('water heater') || lower.includes('no heat') || lower.includes('ac broken') || lower.includes('backed up') || lower.includes('freeze') || lower.includes('cold air')) {
      urgency = 'High';
    } else if (lower.includes('quote') || lower.includes('estimate') || lower.includes('remodel') || lower.includes('next week') || lower.includes('not ready to book')) {
      urgency = 'Low';
    }

    if (lower.includes('pipe') || lower.includes('drain') || lower.includes('faucet') || lower.includes('water') || lower.includes('toilet') || lower.includes('sink')) {
      jobType = 'Plumbing';
    } else if (lower.includes('heat') || lower.includes('ac') || lower.includes('air conditioning') || lower.includes('furnace') || lower.includes('hvac')) {
      jobType = 'HVAC';
    } else if (lower.includes('wire') || lower.includes('breaker') || lower.includes('panel') || lower.includes('outlet') || lower.includes('electrical')) {
      jobType = 'Electrical';
    } else if (lower.includes('roof') || lower.includes('shingle') || lower.includes('gutter')) {
      jobType = 'Roofing';
    }

    const missingCritical = !phone || !name || !location;

    return {
      name: name || null,
      phone: phone || null,
      location: location || null,
      job_type: jobType,
      urgency: urgency,
      description: text.length > 200 ? text.slice(0, 197) + '...' : text,
      photo_links: [],
      preferred_slot: missingCritical ? null : (lower.includes('tomorrow') ? 'Tomorrow at 10:00 AM' : 'Earliest Available'),
      needs_human: missingCritical,
      reason_if_needs_human: missingCritical ? 'Incomplete information — contact customer again to collect missing details' : null,
    };
  }
}

export const textParser = new TextParser();
export default textParser;
