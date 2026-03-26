import OpenAI from 'openai';

const VALID_INTENTS = ['niche', 'single-website', 'general-chat', 'unknown'];

/**
 * Detect user intent and extract URL from a natural language query.
 * @param {string} userQuery - Raw user message
 * @param {string} apiKey - OpenAI API key
 * @returns {Promise<{ intent: 'niche'|'single-website'|'general-chat'|'unknown', nicheSearchUrl?: string, websiteUrl?: string, message?: string }>}
 */
export async function detectIntent(userQuery, apiKey = process.env.OPENAI_API_KEY) {
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required for intent detection.');
  }

  const openai = new OpenAI({ apiKey });

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `You are an intent classifier for a contact-scraping agent. Classify the user's request into one of four intents and extract the relevant URL when needed.

**niche**: The user wants to scrape or search Niche.com (the school-ratings website). Treat ALL of these as intent "niche" with the default URL when no URL is given: "run niche", "scrape niche", "scrape the niche website", "scraped the niche website", "the niche site", "niche.com", "best schools", or any Niche.com search/list URL. Here "niche" means the brand/site Niche.com, not the word "niche" meaning specialized. Set intent to "niche". Use nicheSearchUrl from the user if they provided a Niche.com URL; otherwise use "https://www.niche.com/k12/search/best-schools/?geoip=true". Never return "unknown" when the user clearly refers to scraping or searching Niche/the Niche website.

**single-website**: The user provides one specific website URL (not niche.com) to scrape for contacts, e.g. "extract contacts from https://lincolnschool.edu" or "scrape this school site: https://example-school.org". Set intent to "single-website" and put that URL in websiteUrl. Normalize the URL to start with https:// if the user omitted scheme.

**general-chat**: The user is chatting normally and is not asking to run a scrape. Examples: "hello", "how are you", "what can you do?", "help me", or other general questions. Set intent to "general-chat".

**unknown**: The user appears to want scraping/contact extraction, but the request is still too ambiguous or incomplete to run safely. Set intent to "unknown" and include a short "message" suggesting the user provide either a Niche search URL or a single website URL.

Return ONLY valid JSON with this shape (no markdown, no extra text):
{
  "intent": "niche" | "single-website" | "general-chat" | "unknown",
  "nicheSearchUrl": "url or null",
  "websiteUrl": "url or null",
  "message": "optional clarification message when intent is unknown"
}`,
      },
      {
        role: 'user',
        content: userQuery.trim() || 'No query provided.',
      },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.1,
  });

  let parsed;
  try {
    const text = response.choices[0]?.message?.content?.trim() || '{}';
    parsed = JSON.parse(text);
  } catch (e) {
    return {
      intent: 'unknown',
      message: 'Could not parse intent. Please provide a Niche search URL or a single website URL.',
    };
  }

  const trimmed = (userQuery || '').trim();
  let intent = VALID_INTENTS.includes(parsed.intent) ? parsed.intent : 'unknown';
  const nicheSearchUrl = parseUrl(parsed.nicheSearchUrl);
  const websiteUrl = parseUrl(parsed.websiteUrl);

  const DEFAULT_NICHE_URL = 'https://www.niche.com/k12/search/best-schools/?geoip=true';

  // Fallback: if model said "unknown" but user clearly refers to Niche.com (e.g. "scrape the niche website"), treat as niche
  const mentionsNicheSite = /\bniche\s*(website|site|\.com|search)?\b|\bscraped?\s*(the\s*)?niche|niche\s*(website|site)/i.test(trimmed);
  if (intent === 'unknown' && !websiteUrl && mentionsNicheSite) {
    intent = 'niche';
  }

  // Niche agent: use default URL when user asked for niche but didn't provide a URL
  if (intent === 'niche' && !nicheSearchUrl) {
    return {
      intent: 'niche',
      nicheSearchUrl: DEFAULT_NICHE_URL,
      ...(parsed.message && { message: parsed.message }),
    };
  }
  if (intent === 'single-website' && !websiteUrl) {
    return {
      intent: 'unknown',
      message: parsed.message || 'Please provide a valid website URL to scrape.',
    };
  }

  if (intent === 'general-chat') {
    return { intent: 'general-chat' };
  }

  return {
    intent,
    ...(nicheSearchUrl && { nicheSearchUrl }),
    ...(websiteUrl && { websiteUrl }),
    ...(parsed.message && intent === 'unknown' && { message: parsed.message }),
  };
}

/**
 * @param {string} [url]
 * @returns {string|null}
 */
function parseUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  const withScheme = trimmed.startsWith('http://') || trimmed.startsWith('https://')
    ? trimmed
    : `https://${trimmed}`;
  try {
    new URL(withScheme);
    return withScheme;
  } catch {
    return null;
  }
}
