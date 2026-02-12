import { detectIntent } from './intent-detector.js';
import { runAgent } from '../agent.js';
import { runSingleWebsite } from './single-website-agent.js';
import { Router } from 'express';

const router = Router();


const DEFAULT_NICHE_URL = 'https://www.niche.com/k12/search/best-schools/?geoip=true';
const DEFAULT_CLARIFY_MESSAGE =
  'Send a **single website URL** to scrape for contacts, or say "niche" / "run niche" to use the Niche schools agent (no URL needed).';

/**
 * Detect intent from user query, then run the appropriate agent (niche or single-website).
 * @param {string} userQuery - Raw user message
 * @param {object} options - Passed to runAgent / runSingleWebsite (maxSchools, sequenceId, userId, senderEmail, outputFile)
 * @returns {Promise<{ ok: boolean, intent?: string, result?: object, message?: string }>}
 */
export async function routeAndRun(userQuery, options = {}) {
  const trimmed = (userQuery || '').trim();
  if (!trimmed) {
    return {
      ok: false,
      message: DEFAULT_CLARIFY_MESSAGE,
    };
  }

  let resolved;
  try {
    resolved = await detectIntent(trimmed);
  } catch (error) {
    console.error('[Router] Intent detection failed:', error.message);
    return {
      ok: false,
      message: 'Intent detection failed. Please try again or provide a Niche or website URL.',
    };
  }

  const { intent, nicheSearchUrl, websiteUrl, message } = resolved;

  if (intent === 'unknown') {
    return {
      ok: false,
      intent: 'unknown',
      message: message || DEFAULT_CLARIFY_MESSAGE,
    };
  }

  if (intent === 'niche') {
    const url = nicheSearchUrl || DEFAULT_NICHE_URL;
    const result = await runAgent(url, options);
    return { ok: true, intent: 'niche', result };
  }

  if (intent === 'single-website') {
    if (!websiteUrl) {
      return {
        ok: false,
        intent: 'single-website',
        message: message || 'Please provide a valid website URL.',
      };
    }
    const result = await runSingleWebsite(websiteUrl, options);
    return { ok: true, intent: 'single-website', result };
  }

  return {
    ok: false,
    message: message || DEFAULT_CLARIFY_MESSAGE,
  };
}


router.post('/chat', async (req, res) => {
  const { message } = req.body;
  const result = await routeAndRun(message);
  res.json(result);
});

export default router;