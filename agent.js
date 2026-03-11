import 'dotenv/config';
import { WebScraper } from './src/scraper.js';
import { AIExtractor } from './src/ai-extractor.js';
import { exportToCSV } from './src/csv-export.js';
import { uploadContactsToHubSpot } from './src/hubspot.js';
import { enrollContactsInSequence } from './src/email-automation.js';
import fs from 'fs/promises';


function getContactsFilename() {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const year = now.getFullYear();
  return `contacts-${dd}-${mm}-${year}.csv`;
}

export async function runAgent(nicheSearchUrl, options = {}) {
  const {
    maxSchools = 10,
    sequenceId = null,
    userId = null,
    senderEmail = null,
    outputFile = getContactsFilename(),
    onProgress = () => {},
  } = options;
  const aiExtractor = new AIExtractor(process.env.OPENAI_API_KEY);
  const scraper = new WebScraper();
  const allContacts = [];

  const progress = (id, label, detail, status, parentId = null) => {
    onProgress({ id, label, detail, status, parentId });
  };

  try {
    console.log('🚀 Starting AI Contact Agent...\n');
    progress('init', 'Initializing scraper...', null, 'running');
    await scraper.init();
    progress('init', 'Initializing scraper...', null, 'done');

    // Step 1: Scrape Niche for school links
    console.log('📍 Step 1: Scraping Niche.com for schools...');
    progress('step1', 'Scraping Niche.com for schools', null, 'running');
    const { schoolLinks } = await scraper.scrapeNichePage(nicheSearchUrl);
    progress('step1', 'Scraping Niche.com for schools', `Found ${schoolLinks.length} school links`, 'done');
    console.log(`   Found ${schoolLinks.length} school links\n`);

    // Step 2: Process each school
    const schoolsToProcess = schoolLinks.slice(0, maxSchools);

    for (let i = 0; i < schoolsToProcess.length; i++) {
      const schoolLink = schoolsToProcess[i];
      const stepId = `school-${i + 1}`;
      const stepLabel = `School ${i + 1} of ${schoolsToProcess.length}`;
      console.log(`📍 Step 2.${i + 1}: ${stepLabel}`);
      progress(stepId, stepLabel, null, 'running');

      try {
        // Sub-step: Fetch school profile
        progress(`${stepId}-profile`, 'Fetching school profile', null, 'running', stepId);
        const { schoolInfo } = await scraper.scrapeNicheSchoolProfile(schoolLink);
        const officialWebsite = schoolInfo.website;
        const schoolNameShort = (schoolInfo.name || '').split(/Claimed|This school/)[0].trim() || 'School';
        if (!officialWebsite) {
          progress(`${stepId}-profile`, 'Fetching school profile', 'No official website found', 'skipped', stepId);
          progress(stepId, stepLabel, 'Skipped — no website', 'skipped');
          console.log('   ⚠️ No official website found, skipping...\n');
          continue;
        }
        const siteHost = officialWebsite ? new URL(officialWebsite).hostname.replace('www.', '') : '';
        progress(`${stepId}-profile`, 'Fetching school profile', `${schoolNameShort} → ${siteHost}`, 'done', stepId);
        console.log("schoolInfo", schoolInfo);
        console.log(`   Found website: ${officialWebsite}`);

        // Sub-step: Scrape school website
        progress(`${stepId}-scrape`, 'Scraping school website for contacts', null, 'running', stepId);
        console.log(`[Step 3] Scraping school website for contacts...`, officialWebsite, schoolInfo);
        const websiteContent = await scraper.scrapeContactPage(officialWebsite);
        progress(`${stepId}-scrape`, 'Scraping school website for contacts', null, 'done', stepId);

        // Sub-step: AI extract
        progress(`${stepId}-extract`, 'Extracting contacts with AI', null, 'running', stepId);
        console.log(`[Step 4] Extracting contacts with AI...`);
        const extracted = await aiExtractor.extractContacts(websiteContent, schoolInfo);
        console.log("extracted", extracted);

        // Add extracted contacts to allContacts array with school info
        if (extracted.contacts && extracted.contacts.length > 0) {
          const enrichedContacts = extracted.contacts.map(contact => ({
            ...contact,
            schoolName: schoolInfo.name || '',
            schoolDomain: officialWebsite ? new URL(officialWebsite).hostname.replace('www.', '') : '',
            schoolPhone: extracted.schoolPhone || null,
            schoolState: extracted.schoolState || null,
          }));
          allContacts.push(...enrichedContacts);
          progress(`${stepId}-extract`, 'Extracting contacts with AI', `${enrichedContacts.length} contact(s) found`, 'done', stepId);
          progress(stepId, stepLabel, `${enrichedContacts.length} contact(s) — total: ${allContacts.length}`, 'done');
          console.log(`   ✅ Added ${enrichedContacts.length} contacts (total: ${allContacts.length})\n`);
        } else {
          progress(`${stepId}-extract`, 'Extracting contacts with AI', 'No contacts found', 'done', stepId);
          progress(stepId, stepLabel, 'No contacts found', 'done');
          console.log(`   ⚠️ No contacts found for this school\n`);
        }
      } catch (error) {
        progress(stepId, stepLabel, `Error: ${error.message}`, 'skipped');
        console.log(`   ❌ Error: ${error.message}\n`);
      }
    }

    // Step 3: Export to CSV
    console.log('📍 Step 3: Exporting to CSV...');
    progress('csv', 'Exporting to CSV', null, 'running');
    await fs.mkdir('output', { recursive: true });
    const csvPath = await exportToCSV(allContacts, outputFile);
    progress('csv', 'Exporting to CSV', null, 'done');

    // Step 4: Upload to HubSpot
    let hubspotResults = null;
    if (allContacts.length > 0) {
      console.log('\n📍 Step 4: Uploading to HubSpot...');
      progress('hubspot', 'Uploading to HubSpot', null, 'running');
      try {
        hubspotResults = await uploadContactsToHubSpot(allContacts);
        progress('hubspot', 'Uploading to HubSpot', `${hubspotResults.success.length} synced, ${hubspotResults.failed.length} failed`, 'done');
      } catch (error) {
        console.error('❌ HubSpot upload failed:', error.message);
        console.error('   Make sure HUBSPOT_ACCESS_TOKEN is set in your .env file');
        hubspotResults = { success: [], failed: [], total: 0 };
        progress('hubspot', 'Uploading to HubSpot', `Failed: ${error.message}`, 'skipped');
      }
    } else {
      progress('hubspot', 'Uploading to HubSpot', 'No contacts to sync', 'skipped');
      console.log('\n📍 Step 4: Skipping HubSpot upload (no contacts to sync)');
    }

    // Step 5: Enroll in Sales Sequence (optional)
    let sequenceResults = null;
    if (sequenceId && userId != null && senderEmail && hubspotResults && hubspotResults.success.length > 0) {
      console.log('\n📍 Step 5: Enrolling contacts in Sales Sequence...');
      progress('sequence', 'Enrolling contacts in Sales Sequence', null, 'running');
      try {
        // Get only successfully uploaded contacts
        const successfulContacts = allContacts.filter(contact =>
          hubspotResults.success.some(result => result.email === contact.email)
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
              const percentage = ((progressData.processed / progressData.total) * 100).toFixed(1);
              console.log(
                `[Sequence] Progress: ${progressData.processed}/${progressData.total} (${percentage}%) - Success: ${progressData.success}, Failed: ${progressData.failed}`
              );
              progress('sequence', 'Enrolling contacts in Sales Sequence', `${progressData.processed}/${progressData.total} (${percentage}%) - Success: ${progressData.success}, Failed: ${progressData.failed}`, 'running');
              const subLabel = progressData.enrolled ? `Enrolled: ${progressData.email}` : `Failed: ${progressData.email}`;
              progress(`sequence-${progressData.processed}`, subLabel, progressData.error, progressData.enrolled ? 'done' : 'skipped', 'sequence');
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

    // Summary
    console.log('\n' + '='.repeat(50));
    console.log('🎉 Agent Complete!');
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

// Run the agent only when this file is executed directly (e.g. node agent.js), not when imported
const isRunDirectly = process.argv[1] && process.argv[1].endsWith('agent.js');
if (isRunDirectly) {
  runAgent('https://www.niche.com/k12/search/best-schools/?geoip=true', {
    maxSchools: 5,
    sequenceId: process.env.SEQUENCE_ID || 271391533,
    userId: process.env.USER_ID || 67233230,
    senderEmail: process.env.SENDER_EMAIL || 'fernandezjamiep@gmail.com',
  });
}