import 'dotenv/config';
import { WebScraper } from './scraper.js';
import { AIExtractor } from './ai-extractor.js';
import { exportToCSV } from './csv-export.js';
import { uploadContactsToHubSpot } from './hubspot.js';
import { enrollContactsInSequence } from './email-automation.js';
import fs from 'fs/promises';

function getContactsFilename() {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const year = now.getFullYear();
  return `contacts-${dd}-${mm}-${year}.csv`;
}

/**
 * Build minimal schoolInfo from a single website URL for AI extractor and CSV.
 * @param {string} websiteUrl
 * @returns {{ name: string, website: string, address: string, state: string, phone: string }}
 */
function schoolInfoFromUrl(websiteUrl) {
  let name = '';
  let website = websiteUrl;
  try {
    const url = new URL(websiteUrl);
    name = url.hostname.replace(/^www\./, '');
    website = url.href;
  } catch (_) {
    name = websiteUrl;
  }
  return {
    name: name || '',
    website: website || '',
    address: '',
    state: '',
    phone: '',
  };
}

/**
 * Run the single-website pipeline: scrape one URL, extract contacts with AI, export CSV, optional HubSpot + sequence.
 * @param {string} websiteUrl - The single website URL to scrape
 * @param {object} options - Same shape as runAgent where relevant
 * @param {number} [options.sequenceId]
 * @param {number|null} [options.userId]
 * @param {string|null} [options.senderEmail]
 * @param {string} [options.outputFile]
 * @returns {Promise<{ contacts: object[], csvPath: string, hubspotResults: object|null, sequenceResults: object|null }>}
 */
export async function runSingleWebsite(websiteUrl, options = {}) {
  const {
    sequenceId = null,
    userId = null,
    senderEmail = null,
    outputFile = getContactsFilename(),
    onProgress = () => {},
  } = options;

  const aiExtractor = new AIExtractor(process.env.OPENAI_API_KEY);
  const scraper = new WebScraper();
  const allContacts = [];

  const progress = (id, label, detail, status) => {
    onProgress({ id, label, detail, status });
  };

  try {
    console.log('🚀 Starting single-website contact extraction...\n');
    progress('init', 'Initializing scraper...', null, 'running');
    await scraper.init();
    progress('init', 'Initializing scraper...', null, 'done');

    const schoolInfo = schoolInfoFromUrl(websiteUrl);
    console.log(`📍 Target: ${websiteUrl} (${schoolInfo.name})\n`);

    console.log('📍 Step 1: Scraping website for contacts...');
    progress('step1', 'Scraping website for contacts', null, 'running');
    const websiteContent = await scraper.scrapeContactPage(websiteUrl);
    progress('step1', 'Scraping website for contacts', null, 'done');

    console.log('📍 Step 2: Extracting contacts with AI...');
    progress('step2', 'Extracting contacts with AI', null, 'running');
    const extracted = await aiExtractor.extractContacts(websiteContent, schoolInfo);

    if (extracted.contacts && extracted.contacts.length > 0) {
      const domain = schoolInfo.website ? (() => {
        try {
          return new URL(schoolInfo.website).hostname.replace('www.', '');
        } catch {
          return '';
        }
      })() : '';
      const enrichedContacts = extracted.contacts.map((contact) => ({
        ...contact,
        schoolName: schoolInfo.name || '',
        schoolDomain: domain,
        schoolPhone: extracted.schoolPhone || null,
        schoolState: extracted.schoolState || null,
      }));
      allContacts.push(...enrichedContacts);
      progress('step2', 'Extracting contacts with AI', `Extracted ${enrichedContacts.length} contacts`, 'done');
      console.log(`   ✅ Extracted ${enrichedContacts.length} contacts\n`);
    } else {
      progress('step2', 'Extracting contacts with AI', 'No contacts found', 'done');
      console.log('   ⚠️ No contacts found for this website\n');
    }

    console.log('📍 Step 3: Exporting to CSV...');
    progress('csv', 'Exporting to CSV', null, 'running');
    await fs.mkdir('output', { recursive: true });
    const csvPath = await exportToCSV(allContacts, outputFile);
    progress('csv', 'Exporting to CSV', null, 'done');

    let hubspotResults = null;
    if (allContacts.length > 0) {
      console.log('\n📍 Step 4: Uploading to HubSpot...');
      progress('hubspot', 'Uploading to HubSpot', null, 'running');
      try {
        hubspotResults = await uploadContactsToHubSpot(allContacts);
        progress('hubspot', 'Uploading to HubSpot', `${hubspotResults.success.length} synced, ${hubspotResults.failed.length} failed`, 'done');
      } catch (error) {
        console.error('❌ HubSpot upload failed:', error.message);
        hubspotResults = { success: [], failed: [], total: 0 };
        progress('hubspot', 'Uploading to HubSpot', `Failed: ${error.message}`, 'skipped');
      }
    } else {
      progress('hubspot', 'Uploading to HubSpot', 'No contacts to sync', 'skipped');
      console.log('\n📍 Step 4: Skipping HubSpot upload (no contacts to sync)');
    }

    let sequenceResults = null;
    if (sequenceId && userId != null && senderEmail && hubspotResults && hubspotResults.success.length > 0) {
      console.log('\n📍 Step 5: Enrolling contacts in Sales Sequence...');
      progress('sequence', 'Enrolling contacts in Sales Sequence', null, 'running');
      try {
        const successfulContacts = allContacts.filter((contact) =>
          hubspotResults.success.some((result) => result.email === contact.email)
        );
        sequenceResults = await enrollContactsInSequence(
          successfulContacts,
          sequenceId,
          userId,
          senderEmail,
          process.env.HUBSPOT_ACCESS_TOKEN,
          {
            delayBetweenContacts: 200,
            onProgress: (progressData) => {
              const pct = ((progressData.processed / progressData.total) * 100).toFixed(1);
              console.log(
                `[Sequence] Progress: ${progressData.processed}/${progressData.total} (${pct}%) - Success: ${progressData.success}, Failed: ${progressData.failed}`
              );
            },
          }
        );
        progress('sequence', 'Enrolling contacts in Sales Sequence', `${sequenceResults.success.length} enrolled, ${sequenceResults.failed.length} failed`, 'done');
      } catch (error) {
        console.error('❌ Sequence enrollment failed:', error.message);
        sequenceResults = { success: [], failed: [], total: 0 };
        progress('sequence', 'Enrolling contacts in Sales Sequence', `Failed: ${error.message}`, 'skipped');
      }
    } else if (sequenceId && userId != null && senderEmail && allContacts.length === 0) {
      progress('sequence', 'Enrolling contacts in Sales Sequence', 'No contacts to enroll', 'skipped');
      console.log('\n📍 Step 5: Skipping sequence enrollment (no contacts to enroll)');
    } else if (!sequenceId) {
      progress('sequence', 'Enrolling contacts in Sales Sequence', 'No sequenceId provided', 'skipped');
      console.log('\n📍 Step 5: Skipping sequence enrollment (no sequenceId provided)');
    } else if (userId == null) {
      progress('sequence', 'Enrolling contacts in Sales Sequence', 'No userId provided', 'skipped');
      console.log('\n📍 Step 5: Skipping sequence enrollment (no userId provided)');
    } else if (!senderEmail) {
      progress('sequence', 'Enrolling contacts in Sales Sequence', 'No senderEmail provided', 'skipped');
      console.log('\n📍 Step 5: Skipping sequence enrollment (no senderEmail provided)');
    }

    console.log('\n' + '='.repeat(50));
    console.log('🎉 Single-website extraction complete!');
    console.log(`   Total contacts extracted: ${allContacts.length}`);
    console.log(`   CSV exported to: ${csvPath}`);
    if (hubspotResults) {
      console.log(`   HubSpot synced: ${hubspotResults.success.length} successful, ${hubspotResults.failed.length} failed`);
    }
    if (sequenceResults) {
      console.log(`   Sequence enrolled: ${sequenceResults.success.length} successful, ${sequenceResults.failed.length} failed`);
    }
    console.log('='.repeat(50));

    return {
      contacts: allContacts,
      csvPath,
      hubspotResults,
      sequenceResults,
    };
  } finally {
    await scraper.close();
  }
}
