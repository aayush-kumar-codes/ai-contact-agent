import 'dotenv/config';
import { WebScraper } from './src/scraper.js';
import { AIExtractor } from './src/ai-extractor.js';
import { exportToCSV } from './src/csv-export.js';
import { uploadContactsToHubSpot } from './src/hubspot.js';
import { enrollContactsInWorkflow, sendEmailsToContacts } from './src/email-automation.js';
import fs from 'fs/promises';


async function runAgent(nicheSearchUrl, options = {}) {
  const {
    maxSchools = 10,
    workflowId = null,
    emailTemplateId = null,
    outputFile = `contacts-${Date.now()}.csv`
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

    // Step 5: Enroll in email workflow/funnel (optional)
    let workflowResults = null;
    if (workflowId && hubspotResults && hubspotResults.success.length > 0) {
      console.log('\n📍 Step 5: Enrolling contacts in email funnel...');
      try {
        // Get only successfully uploaded contacts
        const successfulContacts = allContacts.filter(contact => 
          hubspotResults.success.some(result => result.email === contact.email)
        );
        
        workflowResults = await enrollContactsInWorkflow(
          successfulContacts,
          workflowId,
          process.env.HUBSPOT_ACCESS_TOKEN,
          {
            delayBetweenContacts: 200,
            onProgress: (progress) => {
              const percentage = ((progress.processed / progress.total) * 100).toFixed(1);
              console.log(
                `[Workflow] Progress: ${progress.processed}/${progress.total} (${percentage}%) - Success: ${progress.success}, Failed: ${progress.failed}`
              );
            },
          }
        );
      } catch (error) {
        console.error('❌ Workflow enrollment failed:', error.message);
        workflowResults = { success: [], failed: [], total: 0 };
      }
    } else if (workflowId && allContacts.length === 0) {
      console.log('\n📍 Step 5: Skipping workflow enrollment (no contacts to enroll)');
    } else if (!workflowId) {
      console.log('\n📍 Step 5: Skipping workflow enrollment (no workflowId provided)');
    }

    // Step 6: Send initial transactional emails (optional)
    let emailResults = null;
    if (emailTemplateId && hubspotResults && hubspotResults.success.length > 0) {
      console.log('\n📍 Step 6: Sending initial transactional emails...');
      try {
        // Get only successfully uploaded contacts
        const successfulContacts = allContacts.filter(contact => 
          hubspotResults.success.some(result => result.email === contact.email)
        );
        
        emailResults = await sendEmailsToContacts(
          successfulContacts,
          emailTemplateId,
          process.env.HUBSPOT_ACCESS_TOKEN,
          {
            delayBetweenEmails: 200,
            onProgress: (progress) => {
              const percentage = ((progress.processed / progress.total) * 100).toFixed(1);
              console.log(
                `[Email] Progress: ${progress.processed}/${progress.total} (${percentage}%) - Success: ${progress.success}, Failed: ${progress.failed}`
              );
            },
          }
        );
      } catch (error) {
        console.error('❌ Email sending failed:', error.message);
        emailResults = { success: [], failed: [], total: 0 };
      }
    } else if (emailTemplateId && allContacts.length === 0) {
      console.log('\n📍 Step 6: Skipping email sending (no contacts to email)');
    } else if (!emailTemplateId) {
      console.log('\n📍 Step 6: Skipping email sending (no emailTemplateId provided)');
    }

    // Summary
    console.log('\n' + '='.repeat(50));
    console.log('🎉 Agent Complete!');
    console.log(`   Total contacts extracted: ${allContacts.length}`);
    console.log(`   CSV exported to: ${csvPath}`);
    if (hubspotResults) {
      console.log(`   HubSpot synced: ${hubspotResults.success.length} successful, ${hubspotResults.failed.length} failed`);
    }
    if (workflowResults) {
      console.log(`   Workflow enrolled: ${workflowResults.success.length} successful, ${workflowResults.failed.length} failed`);
    }
    if (emailResults) {
      console.log(`   Emails sent: ${emailResults.success.length} successful, ${emailResults.failed.length} failed`);
    }
    console.log('='.repeat(50));

    return { 
      contacts: allContacts, 
      csvPath, 
      hubspotResults, 
      workflowResults, 
      emailResults 
    };

  } finally {
    await scraper.close();
  }
}

// Run the agent
runAgent('https://www.niche.com/k12/search/best-schools/?geoip=true', {
  maxSchools: 25,
  workflowId: process.env.HUBSPOT_WORKFLOW_ID || null, // Optional: Get from .env or pass directly
  emailTemplateId: process.env.HUBSPOT_EMAIL_TEMPLATE_ID || null, // Optional: Get from .env or pass directly
});