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
    outputFile = getContactsFilename()
  } = options;
  const aiExtractor = new AIExtractor(process.env.OPENAI_API_KEY);
  const scraper = new WebScraper();
  const allContacts = [];

  try {
    console.log('🚀 Starting AI Contact Agent...\n');
    await scraper.init();

    // Step 1: Scrape Niche for school links
    console.log('📍 Step 1: Scraping Niche.com for schools...');
    const { schoolLinks } = await scraper.scrapeNichePage(nicheSearchUrl);
    console.log(`   Found ${schoolLinks.length} school links\n`);

    // Step 2: Process each school
    const schoolsToProcess = schoolLinks.slice(0, maxSchools);
    
    for (let i = 0; i < schoolsToProcess.length; i++) {
      const schoolLink = schoolsToProcess[i];
      console.log(`📍 Step 2.${i + 1}: Processing school ${i + 1}/${schoolsToProcess.length}`);
      
      try {
        // Get school page and find official website
        const { schoolInfo } = await scraper.scrapeNicheSchoolProfile(schoolLink);
        const officialWebsite = schoolInfo.website;
        if (!officialWebsite) {
          console.log('   ⚠️ No official website found, skipping...\n');
          continue;
        }
        console.log("schoolInfo", schoolInfo);
        
        console.log(`   Found website: ${officialWebsite}`);
        
        // Scrape school's official website for contacts
        console.log(`[Step 3] Scraping school website for contacts...`, officialWebsite,schoolInfo);
        const websiteContent = await scraper.scrapeContactPage(officialWebsite);
        
        // Use AI to extract contacts
        console.log(`[Step 4] Extracting contacts with AI...`)
        const extracted = await aiExtractor.extractContacts(websiteContent, schoolInfo)
        console.log("extracted", extracted);
        
        // Add extracted contacts to allContacts array with school info
        if (extracted.contacts && extracted.contacts.length > 0) {
          const enrichedContacts = extracted.contacts.map(contact => ({
            ...contact,
            schoolName: schoolInfo.name || '',
            schoolDomain: officialWebsite ? new URL(officialWebsite).hostname.replace('www.', '') : '',
            schoolPhone: extracted.schoolPhone || null,
            schoolState: extracted.schoolState || null,
          }))
          allContacts.push(...enrichedContacts)
          console.log(`   ✅ Added ${enrichedContacts.length} contacts (total: ${allContacts.length})\n`)
        } else {
          console.log(`   ⚠️ No contacts found for this school\n`)
        }
      } catch (error) {
        console.log(`   ❌ Error: ${error.message}\n`);
      }
    }

    // Step 3: Export to CSV
    console.log('📍 Step 3: Exporting to CSV...');
    await fs.mkdir('output', { recursive: true });
    const csvPath = await exportToCSV(allContacts, outputFile);

    // Step 4: Upload to HubSpot
    let hubspotResults = null;
    if (allContacts.length > 0) {
      console.log('\n📍 Step 4: Uploading to HubSpot...');
      try {
        hubspotResults = await uploadContactsToHubSpot(allContacts);
      } catch (error) {
        console.error('❌ HubSpot upload failed:', error.message);
        console.error('   Make sure HUBSPOT_ACCESS_TOKEN is set in your .env file');
        hubspotResults = { success: [], failed: [], total: 0 };
      }
    } else {
      console.log('\n📍 Step 4: Skipping HubSpot upload (no contacts to sync)');
    }

    // Step 5: Enroll in Sales Sequence (optional)
    let sequenceResults = null;
    if (sequenceId && userId != null && senderEmail && hubspotResults && hubspotResults.success.length > 0) {
      console.log('\n📍 Step 5: Enrolling contacts in Sales Sequence...');
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
            onProgress: (progress) => {
              const percentage = ((progress.processed / progress.total) * 100).toFixed(1);
              console.log(
                `[Sequence] Progress: ${progress.processed}/${progress.total} (${percentage}%) - Success: ${progress.success}, Failed: ${progress.failed}`
              );
            },
          }
        );
      } catch (error) {
        console.error('❌ Sequence enrollment failed:', error.message);
        sequenceResults = { success: [], failed: [], total: 0 };
      }
    } else if (sequenceId && userId != null && senderEmail && allContacts.length === 0) {
      console.log('\n📍 Step 5: Skipping sequence enrollment (no contacts to enroll)');
    } else if (!sequenceId) {
      console.log('\n📍 Step 5: Skipping sequence enrollment (no sequenceId provided)');
    } else if (userId == null) {
      console.log('\n📍 Step 5: Skipping sequence enrollment (no userId provided)');
    } else if (!senderEmail) {
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
    sequenceId: process.env.SEQUENCE_ID || null,
    userId: process.env.USER_ID ? parseInt(process.env.USER_ID, 10) : null,
    senderEmail: process.env.SENDER_EMAIL || null,
  });
}