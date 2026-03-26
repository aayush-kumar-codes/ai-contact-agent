import 'dotenv/config';
import path from 'path';
import fs from 'fs/promises';
import { detectIntent } from './intent-detector.js';
import { runAgent } from '../agent.js';
import { runSingleWebsite } from './single-website-agent.js';
import { Router } from 'express';
import { getLatestActiveNicheRun, requestRunStop, serializeRun } from './niche-run-state.js';

const router = Router();
const OUTPUT_DIR = path.join(process.cwd(), 'output');

function parseEnvInt(value) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

function getOptionsFromEnv() {
  return {
    maxSchools: parseEnvInt(process.env.MAX_SCHOOLS) ?? undefined,
    sequenceId: parseEnvInt(process.env.SEQUENCE_ID),
    userId: parseEnvInt(process.env.USER_ID),
    senderEmail: (process.env.SENDER_EMAIL || '').trim() || null,
    pageBatchSize: parseEnvInt(process.env.NICHE_PAGE_BATCH_SIZE) ?? 1,
    schoolBatchSize: parseEnvInt(process.env.NICHE_SCHOOL_BATCH_SIZE) ?? 5,
  };
}


const DEFAULT_NICHE_URL = 'https://www.niche.com/k12/search/best-schools/?geoip=true';
const DEFAULT_CLARIFY_MESSAGE =
  'Send a **single website URL** to scrape for contacts, or say "niche" / "run niche" to use the Niche schools agent (no URL needed).';

/**
 * Detect intent from user query, then run the appropriate agent (niche or single-website).
 * @param {string} userQuery - Raw user message
 * @param {object} options - Passed to runAgent / runSingleWebsite (maxSchools, sequenceId, userId, senderEmail, outputFile, pageBatchSize, schoolBatchSize)
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
  const result = await routeAndRun(message, getOptionsFromEnv());
  res.json(result);
});

router.get('/runs/niche/active', async (_req, res) => {
  try {
    const activeRun = await getLatestActiveNicheRun();
    res.json({ ok: true, run: serializeRun(activeRun) });
  } catch (error) {
    console.error('[Router] Failed to load active Niche run:', error.message);
    res.status(500).json({ ok: false, message: error.message || 'Failed to load active Niche run.' });
  }
});

router.post('/runs/niche/stop', async (req, res) => {
  try {
    const runId = typeof req.body?.runId === 'string' ? req.body.runId : null;
    const targetRun = runId ? { id: runId } : await getLatestActiveNicheRun();

    if (!targetRun?.id) {
      res.status(404).json({ ok: false, message: 'No active Niche run found.' });
      return;
    }

    const updatedRun = await requestRunStop(targetRun.id);
    res.json({ ok: true, run: serializeRun(updatedRun) });
  } catch (error) {
    console.error('[Router] Failed to stop Niche run:', error.message);
    res.status(500).json({ ok: false, message: error.message || 'Failed to stop Niche run.' });
  }
});

/**
 * Send an SSE event. Use in /chat/stream only.
 */
function sendSSE(res, event) {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
  if (typeof res.flush === 'function') res.flush();
}

router.post('/chat/stream', async (req, res) => {
  const { message } = req.body;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders && res.flushHeaders();

  const trimmed = (message || '').trim();
  if (!trimmed) {
    sendSSE(res, { type: 'error', message: DEFAULT_CLARIFY_MESSAGE });
    res.end();
    return;
  }

  let resolved;
  try {
    resolved = await detectIntent(trimmed);
  } catch (error) {
    console.error('[Router] Intent detection failed:', error.message);
    sendSSE(res, { type: 'error', message: 'Intent detection failed. Please try again or provide a Niche or website URL.' });
    res.end();
    return;
  }

  const { intent, nicheSearchUrl, websiteUrl, message: intentMessage } = resolved;

  if (intent === 'unknown') {
    sendSSE(res, { type: 'error', message: intentMessage || DEFAULT_CLARIFY_MESSAGE });
    res.end();
    return;
  }

  if (intent === 'single-website' && !websiteUrl) {
    sendSSE(res, { type: 'error', message: intentMessage || 'Please provide a valid website URL.' });
    res.end();
    return;
  }

  sendSSE(res, { type: 'intent', intent });

  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const onProgress = (payload) => {
    sendSSE(res, { type: 'step', id: payload.id, label: payload.label, detail: payload.detail ?? undefined, status: payload.status, parentId: payload.parentId ?? undefined });
  };
  const onRunUpdate = (run) => {
    sendSSE(res, { type: 'run', run });
  };

  try {
    let result;
    const envOptions = getOptionsFromEnv();
    if (intent === 'niche') {
      const url = nicheSearchUrl || DEFAULT_NICHE_URL;
      result = await runAgent(url, { ...envOptions, onProgress, onRunUpdate });
    } else {
      result = await runSingleWebsite(websiteUrl, { ...envOptions, onProgress });
    }

    const csvPath = result.csvPath;
    const csvFilename = csvPath ? path.basename(csvPath) : null;
    const csvDownloadUrl = csvFilename ? `${baseUrl}/agent/download/csv?filename=${encodeURIComponent(csvFilename)}` : null;

    sendSSE(res, {
      type: 'done',
      result: {
        status: result.status ?? 'completed',
        run: result.run ?? null,
        contactsCount: result.contacts?.length ?? 0,
        csvPath: result.csvPath ?? null,
        csvDownloadUrl,
        hubspotResults: result.hubspotResults ?? null,
        sequenceResults: result.sequenceResults ?? null,
      },
    });
  } catch (error) {
    console.error('[Router] Stream agent error:', error.message);
    sendSSE(res, { type: 'error', message: error.message || 'Agent run failed.' });
  } finally {
    res.end();
  }
});

router.get('/download/csv', async (req, res) => {
  const filename = req.query.filename;
  if (!filename || typeof filename !== 'string') {
    res.status(400).json({ error: 'Missing or invalid filename' });
    return;
  }
  // Prevent path traversal: only allow basename (no slashes, no ..)
  const safe = path.normalize(filename).replace(/^(\.\.(\/|\\|$))+/, '');
  if (safe !== filename || filename.includes('..') || path.isAbsolute(filename)) {
    res.status(400).json({ error: 'Invalid filename' });
    return;
  }
  const filePath = path.join(OUTPUT_DIR, filename);
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(OUTPUT_DIR))) {
    res.status(400).json({ error: 'Invalid filename' });
    return;
  }
  try {
    await fs.access(resolved);
  } catch {
    res.status(404).json({ error: 'File not found' });
    return;
  }
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'text/csv');
  res.sendFile(resolved);
});

export default router;