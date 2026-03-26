import 'dotenv/config';
import { WebScraper } from './src/scraper.js';
import { AIExtractor } from './src/ai-extractor.js';
import { exportToCSV } from './src/csv-export.js';
import { uploadContactsToHubSpot } from './src/hubspot.js';
import { enrollContactsInSequence } from './src/email-automation.js';
import {
  addSchoolsForPage,
  buildNichePageUrl,
  checkpointPagination,
  completeRun,
  createOrResumeNicheRun,
  failRun,
  getRunById,
  isStopRequested,
  listContactsForRun,
  listContactsPendingHubSpot,
  listContactsPendingSequence,
  listSchoolsForPage,
  markContactsCsvExported,
  markHubSpotResult,
  markSchoolCompleted,
  markSchoolFailed,
  markSchoolProcessing,
  markSchoolSkipped,
  markSequenceResult,
  saveContactsForSchool,
  serializeRun,
  stopRun,
  updateRunStage,
} from './src/niche-run-state.js';


function getContactsFilename() {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const year = now.getFullYear();
  return `contacts-${dd}-${mm}-${year}.csv`;
}

export async function runAgent(nicheSearchUrl, options = {}) {
  const {
    maxSchools = null,
    sequenceId = null,
    userId = null,
    senderEmail = null,
    outputFile = getContactsFilename(),
    onProgress = () => {},
    onRunUpdate = () => {},
    pageBatchSize = 1,
  } = options;
  const aiExtractor = new AIExtractor(process.env.OPENAI_API_KEY);
  const scraper = new WebScraper();

  const progress = (id, label, detail, status, parentId = null) => {
    onProgress({ id, label, detail, status, parentId });
  };

  const emitRunUpdate = (run) => {
    onRunUpdate(serializeRun(run));
  };

  const mapStoredContact = (contact) => ({
    email: contact.email,
    firstName: contact.firstName,
    lastName: contact.lastName || '',
    jobTitle: contact.jobTitle || '',
    phone: contact.phone || null,
    schoolName: contact.schoolName || '',
    schoolDomain: contact.schoolDomain || '',
    schoolPhone: contact.schoolPhone || null,
    schoolState: contact.schoolState || null,
  });

  const buildAggregatedResults = (run, currentContacts, csvPath, hubspotResults = null, sequenceResults = null) => ({
    status: run.status,
    run: serializeRun(run),
    contacts: currentContacts.map(mapStoredContact),
    csvPath,
    hubspotResults: {
      success: hubspotResults?.success || [],
      failed: hubspotResults?.failed || [],
      total: run.hubspotSynced + run.hubspotFailed,
      successCount: run.hubspotSynced,
      failedCount: run.hubspotFailed,
      stopped: Boolean(hubspotResults?.stopped),
    },
    sequenceResults: {
      success: sequenceResults?.success || [],
      failed: sequenceResults?.failed || [],
      total: run.sequenceEnrolled + run.sequenceFailed,
      successCount: run.sequenceEnrolled,
      failedCount: run.sequenceFailed,
      stopped: Boolean(sequenceResults?.stopped),
    },
  });

  const mergeSyncResults = (current, incoming) => {
    if (!incoming) return current;

    return {
      success: [...(current?.success || []), ...(incoming.success || [])],
      failed: [...(current?.failed || []), ...(incoming.failed || [])],
      total: (current?.total || 0) + (incoming.total || 0),
      stopped: Boolean(current?.stopped || incoming.stopped),
    };
  };

  const toStepKey = (value, fallback) => {
    const normalized = String(value || fallback || 'item')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return normalized || String(fallback || 'item');
  };

  const stopIfRequested = async (runId, csvPath = null, hubspotResults = null, sequenceResults = null) => {
    if (!(await isStopRequested(runId))) return null;
    progress('stop', 'Stopping Niche run', 'Saving progress for resume', 'running');
    const stoppedRun = await stopRun(runId);
    emitRunUpdate(stoppedRun);
    progress('stop', 'Niche run stopped', 'Resume will continue from the saved checkpoint', 'done');
    const savedContacts = await listContactsForRun(runId);
    return buildAggregatedResults(stoppedRun, savedContacts, csvPath, hubspotResults, sequenceResults);
  };

  let currentRun = null;

  const syncContactsForScope = async ({
    scopeId,
    scopeLabel,
    hubspotStatuses = ['pending'],
    sequenceStatuses = ['pending'],
  }) => {
    let latestHubSpotResults = null;
    let latestSequenceResults = null;

    const pendingHubSpotContacts = await listContactsPendingHubSpot(currentRun.id, {
      statuses: hubspotStatuses,
    });

    if (pendingHubSpotContacts.length > 0) {
      const hubspotStepId = `hubspot-${scopeId}`;
      progress(hubspotStepId, `Uploading to HubSpot (${scopeLabel})`, `${pendingHubSpotContacts.length} contact(s)`, 'running');
      await updateRunStage(currentRun.id, 'syncing_hubspot');

      try {
        latestHubSpotResults = await uploadContactsToHubSpot(
          pendingHubSpotContacts.map(mapStoredContact),
          {
            shouldStop: () => isStopRequested(currentRun.id),
            onResult: async (result) => {
              await markHubSpotResult(currentRun.id, result);
              if (!result.success) {
                const contactStepId = `${hubspotStepId}-${toStepKey(result.email, 'contact')}`;
                progress(
                  contactStepId,
                  `HubSpot failed: ${result.email || 'unknown'}`,
                  result.error || 'Unknown HubSpot error',
                  'skipped',
                  hubspotStepId
                );
              }
              const latestRun = await getRunById(currentRun.id);
              emitRunUpdate(latestRun);
            },
            onProgress: (progressData) => {
              const percentage = ((progressData.processed / progressData.total) * 100).toFixed(1);
              progress(
                hubspotStepId,
                `Uploading to HubSpot (${scopeLabel})`,
                `${progressData.processed}/${progressData.total} (${percentage}%) - Success: ${progressData.success}, Failed: ${progressData.failed}`,
                'running'
              );
            },
          }
        );
        currentRun = await getRunById(currentRun.id);
        emitRunUpdate(currentRun);
        progress(
          hubspotStepId,
          `Uploading to HubSpot (${scopeLabel})`,
          `${latestHubSpotResults.success.length} synced, ${latestHubSpotResults.failed.length} failed`,
          'done'
        );

        if (latestHubSpotResults.stopped) {
          const stoppedDuringHubSpot = await stopIfRequested(currentRun.id, null, latestHubSpotResults, latestSequenceResults);
          if (stoppedDuringHubSpot) {
            return {
              stoppedResult: stoppedDuringHubSpot,
              hubspotResults: latestHubSpotResults,
              sequenceResults: latestSequenceResults,
            };
          }
        }
      } catch (error) {
        console.error('❌ HubSpot upload failed:', error.message);
        latestHubSpotResults = { success: [], failed: [], total: 0 };
        progress(hubspotStepId, `Uploading to HubSpot (${scopeLabel})`, `Failed: ${error.message}`, 'skipped');
      }
    }

    currentRun = await getRunById(currentRun.id);
    emitRunUpdate(currentRun);

    const pendingSequenceContacts = await listContactsPendingSequence(currentRun.id, {
      statuses: sequenceStatuses,
    });

    if (sequenceId && userId != null && senderEmail && pendingSequenceContacts.length > 0) {
      const sequenceStepId = `sequence-${scopeId}`;
      progress(sequenceStepId, `Enrolling in sequence (${scopeLabel})`, `${pendingSequenceContacts.length} contact(s)`, 'running');
      await updateRunStage(currentRun.id, 'enrolling_sequence');

      try {
        latestSequenceResults = await enrollContactsInSequence(
          pendingSequenceContacts.map(mapStoredContact),
          sequenceId,
          userId,
          senderEmail,
          process.env.HUBSPOT_ACCESS_TOKEN,
          {
            delayBetweenContacts: 200,
            shouldStop: () => isStopRequested(currentRun.id),
            onResult: async (result) => {
              await markSequenceResult(currentRun.id, result);
              if (!result.success) {
                const contactStepId = `${sequenceStepId}-${toStepKey(result.email, 'contact')}`;
                progress(
                  contactStepId,
                  `Sequence failed: ${result.email || 'unknown'}`,
                  result.error || 'Unknown sequence error',
                  'skipped',
                  sequenceStepId
                );
              }
              const latestRun = await getRunById(currentRun.id);
              emitRunUpdate(latestRun);
            },
            onProgress: (progressData) => {
              const percentage = ((progressData.processed / progressData.total) * 100).toFixed(1);
              progress(
                sequenceStepId,
                `Enrolling in sequence (${scopeLabel})`,
                `${progressData.processed}/${progressData.total} (${percentage}%) - Success: ${progressData.success}, Failed: ${progressData.failed}`,
                'running'
              );
            },
          }
        );
        currentRun = await getRunById(currentRun.id);
        emitRunUpdate(currentRun);
        progress(
          sequenceStepId,
          `Enrolling in sequence (${scopeLabel})`,
          `${latestSequenceResults.success.length} enrolled, ${latestSequenceResults.failed.length} failed`,
          'done'
        );

        if (latestSequenceResults.stopped) {
          const stoppedDuringSequence = await stopIfRequested(currentRun.id, null, latestHubSpotResults, latestSequenceResults);
          if (stoppedDuringSequence) {
            return {
              stoppedResult: stoppedDuringSequence,
              hubspotResults: latestHubSpotResults,
              sequenceResults: latestSequenceResults,
            };
          }
        }
      } catch (error) {
        console.error('❌ Sequence enrollment failed:', error.message);
        latestSequenceResults = { success: [], failed: [], total: 0 };
        progress(`sequence-${scopeId}`, `Enrolling in sequence (${scopeLabel})`, `Failed: ${error.message}`, 'skipped');
      }
    }

    currentRun = await getRunById(currentRun.id);
    emitRunUpdate(currentRun);

    return {
      stoppedResult: null,
      hubspotResults: latestHubSpotResults,
      sequenceResults: latestSequenceResults,
    };
  };

  try {
    const run = await createOrResumeNicheRun(nicheSearchUrl, {
      maxSchools,
      sequenceId,
      userId,
      senderEmail,
      outputFile,
      pageBatchSize,
    });
    currentRun = run;
    let csvPath = null;
    let hubspotResults = null;
    let sequenceResults = null;
    emitRunUpdate(currentRun);

    console.log('🚀 Starting AI Contact Agent...\n');
    progress(
      'run',
      currentRun.schoolsProcessed > 0 || currentRun.nextPage > 1 ? 'Resuming Niche run' : 'Starting Niche run',
      `Run ${currentRun.id}`,
      'done'
    );
    progress('init', 'Initializing scraper...', null, 'running');
    await scraper.init();
    progress('init', 'Initializing scraper...', null, 'done');

    console.log('📍 Step 1: Scraping Niche.com pages...');
    progress('step1', 'Discovering Niche pagination', null, 'running');
    await updateRunStage(currentRun.id, 'discovering_pages', { status: 'running' });

    pageLoop:
    while (true) {
      currentRun = await getRunById(currentRun.id);
      emitRunUpdate(currentRun);

      const stopResult = await stopIfRequested(currentRun.id, csvPath, hubspotResults, sequenceResults);
      if (stopResult) return stopResult;

      if (currentRun.totalPages != null && currentRun.nextPage > currentRun.totalPages) {
        break;
      }

      if (maxSchools != null && currentRun.schoolsProcessed >= maxSchools) {
        break;
      }

      const batchStartPage = currentRun.nextPage || 1;

      for (let offset = 0; offset < pageBatchSize; offset++) {
        const pageNumber = batchStartPage + offset;
        if (currentRun.totalPages != null && pageNumber > currentRun.totalPages) {
          break;
        }

        const pageStepId = `page-${pageNumber}`;
        progress(pageStepId, `Scraping Niche page ${pageNumber}`, null, 'running');

        const pageUrl = buildNichePageUrl(currentRun.searchUrl, pageNumber);
        const { schoolLinks, pagination } = await scraper.scrapeNichePage(pageUrl);
        const totalPages = pagination?.totalPages || currentRun.totalPages || pageNumber;

        await addSchoolsForPage(currentRun.id, pageNumber, schoolLinks);
        await checkpointPagination(currentRun.id, {
          currentPage: pageNumber,
          totalPages,
          stage: 'processing_schools',
          status: 'running',
        });

        currentRun = await getRunById(currentRun.id);
        emitRunUpdate(currentRun);
        progress(
          pageStepId,
          `Scraping Niche page ${pageNumber}`,
          `Discovered ${schoolLinks.length} school link(s) on the Niche page`,
          'done'
        );

        const remaining = maxSchools != null ? Math.max(maxSchools - currentRun.schoolsProcessed, 0) : null;
        if (remaining === 0) {
          break pageLoop;
        }

        const schoolsToProcess = await listSchoolsForPage(currentRun.id, pageNumber, {
          remaining: remaining != null ? remaining : undefined,
        });
        const pageStartMetrics = {
          schoolsProcessed: currentRun.schoolsProcessed || 0,
          contactsExtracted: currentRun.contactsExtracted || 0,
          hubspotSynced: currentRun.hubspotSynced || 0,
          hubspotFailed: currentRun.hubspotFailed || 0,
          sequenceEnrolled: currentRun.sequenceEnrolled || 0,
          sequenceFailed: currentRun.sequenceFailed || 0,
        };

        progress(
          `page-${pageNumber}-schools`,
          `Processing schools on page ${pageNumber}`,
          `${schoolsToProcess.length} to process now out of ${schoolLinks.length} discovered`,
          'running'
        );

        for (const school of schoolsToProcess) {
          const requestedStop = await stopIfRequested(currentRun.id, csvPath, hubspotResults, sequenceResults);
          if (requestedStop) return requestedStop;

          await markSchoolProcessing(school.id);
          const stepId = `school-${school.id}`;
          const stepLabel = `School on page ${pageNumber}`;
          progress(stepId, stepLabel, school.nicheSchoolUrl, 'running');

          try {
            progress(`${stepId}-profile`, 'Fetching school profile', null, 'running', stepId);
            const profileResult = await scraper.scrapeNicheSchoolProfile(school.nicheSchoolUrl);
            const schoolInfo = profileResult?.schoolInfo;

            if (!schoolInfo) {
              throw new Error('Failed to load school profile');
            }

            const officialWebsite = schoolInfo.website;
            const schoolNameShort =
              (schoolInfo.name || '').split(/Claimed|This school/)[0].trim() || 'School';

            if (!officialWebsite) {
              await markSchoolSkipped(school.id, 'No official website found', {
                schoolName: schoolInfo.name,
              });
              progress(`${stepId}-profile`, 'Fetching school profile', 'No official website found', 'skipped', stepId);
              progress(stepId, schoolNameShort, 'Skipped because no official website was found', 'skipped');
              continue;
            }

            const siteHost = new URL(officialWebsite).hostname.replace('www.', '');
            progress(`${stepId}-profile`, 'Fetching school profile', `${schoolNameShort} -> ${siteHost}`, 'done', stepId);

            progress(`${stepId}-scrape`, 'Scraping school website for contacts', null, 'running', stepId);
            const websiteContent = await scraper.scrapeContactPage(officialWebsite);
            progress(`${stepId}-scrape`, 'Scraping school website for contacts', null, 'done', stepId);

            progress(`${stepId}-extract`, 'Extracting contacts with AI', null, 'running', stepId);
            const extracted = await aiExtractor.extractContacts(websiteContent, schoolInfo);
            const schoolDomain = new URL(officialWebsite).hostname.replace('www.', '');
            const enrichedContacts = (extracted.contacts || []).map((contact) => ({
              ...contact,
              schoolName: schoolInfo.name || '',
              schoolDomain,
              schoolPhone: extracted.schoolPhone || null,
              schoolState: extracted.schoolState || null,
            }));

            const contactsSaved = await saveContactsForSchool(currentRun.id, school.id, enrichedContacts);
            await markSchoolCompleted(school.id, {
              schoolName: schoolInfo.name,
              officialWebsite,
              contactsFound: contactsSaved,
            });

            progress(`${stepId}-extract`, 'Extracting contacts with AI', `${contactsSaved} contact(s) found`, 'done', stepId);
            progress(
              stepId,
              schoolNameShort,
              contactsSaved > 0
                ? `${contactsSaved} contact(s) found`
                : 'No contacts found',
              'done'
            );

            if (contactsSaved > 0) {
              const syncOutcome = await syncContactsForScope({
                scopeId: `school-${school.id}`,
                scopeLabel: schoolNameShort,
                hubspotStatuses: ['pending'],
                sequenceStatuses: ['pending'],
              });
              hubspotResults = mergeSyncResults(hubspotResults, syncOutcome.hubspotResults);
              sequenceResults = mergeSyncResults(sequenceResults, syncOutcome.sequenceResults);

              if (syncOutcome.stoppedResult) {
                return syncOutcome.stoppedResult;
              }
            }
          } catch (error) {
            await markSchoolFailed(school.id, error);
            progress(stepId, `School on page ${pageNumber}`, `Error: ${error.message}`, 'skipped');
          }

          currentRun = await getRunById(currentRun.id);
          emitRunUpdate(currentRun);

          if (maxSchools != null && currentRun.schoolsProcessed >= maxSchools) {
            break;
          }
        }

        currentRun = await getRunById(currentRun.id);
        emitRunUpdate(currentRun);

        const pageContacts = await listContactsForRun(currentRun.id);
        csvPath = await exportToCSV(pageContacts.map(mapStoredContact), currentRun.outputFile);
        await markContactsCsvExported(currentRun.id);
        progress(
          `page-${pageNumber}-csv`,
          `CSV updated for page ${pageNumber}`,
          `${pageContacts.length} total contact(s)`,
          'done'
        );

        currentRun = await getRunById(currentRun.id);
        emitRunUpdate(currentRun);
        progress(
          `page-${pageNumber}-report`,
          `Page ${pageNumber} complete`,
          `Discovered ${schoolLinks.length}. Processed ${(currentRun.schoolsProcessed || 0) - pageStartMetrics.schoolsProcessed}. Contacts ${(currentRun.contactsExtracted || 0) - pageStartMetrics.contactsExtracted}. HubSpot ${(currentRun.hubspotSynced || 0) - pageStartMetrics.hubspotSynced} synced, ${(currentRun.hubspotFailed || 0) - pageStartMetrics.hubspotFailed} failed. Sequence ${(currentRun.sequenceEnrolled || 0) - pageStartMetrics.sequenceEnrolled} enrolled, ${(currentRun.sequenceFailed || 0) - pageStartMetrics.sequenceFailed} failed.`,
          'done'
        );
        progress(
          `page-${pageNumber}-schools`,
          `Processing schools on page ${pageNumber}`,
          `Completed ${(currentRun.schoolsProcessed || 0) - pageStartMetrics.schoolsProcessed} school(s) from this page`,
          'done'
        );

        if (maxSchools != null && currentRun.schoolsProcessed >= maxSchools) {
          break pageLoop;
        }

        await checkpointPagination(currentRun.id, {
          currentPage: pageNumber,
          nextPage: pageNumber + 1,
          lastCompletedPage: pageNumber,
          totalPages,
          stage: 'discovering_pages',
        });
        currentRun = await getRunById(currentRun.id);
        emitRunUpdate(currentRun);
      }
    }

    const stoppedBeforeFinalSync = await stopIfRequested(currentRun.id, csvPath, hubspotResults, sequenceResults);
    if (stoppedBeforeFinalSync) return stoppedBeforeFinalSync;

    const finalSyncOutcome = await syncContactsForScope({
      scopeId: 'final',
      scopeLabel: 'final retry',
      hubspotStatuses: ['pending', 'failed'],
      sequenceStatuses: ['pending', 'failed'],
    });
    hubspotResults = mergeSyncResults(hubspotResults, finalSyncOutcome.hubspotResults);
    sequenceResults = mergeSyncResults(sequenceResults, finalSyncOutcome.sequenceResults);
    if (finalSyncOutcome.stoppedResult) {
      return finalSyncOutcome.stoppedResult;
    }

    currentRun = await getRunById(currentRun.id);
    emitRunUpdate(currentRun);

    const stoppedBeforeCsv = await stopIfRequested(currentRun.id, csvPath, hubspotResults, sequenceResults);
    if (stoppedBeforeCsv) return stoppedBeforeCsv;

    console.log('📍 Step 3: Exporting to CSV...');
    progress('csv', 'Exporting final CSV', null, 'running');
    await updateRunStage(currentRun.id, 'exporting_csv');
    const storedContacts = await listContactsForRun(currentRun.id);
    csvPath = await exportToCSV(storedContacts.map(mapStoredContact), currentRun.outputFile);
    await markContactsCsvExported(currentRun.id);
    progress('csv', 'Exporting final CSV', null, 'done');

    currentRun = await completeRun(currentRun.id);
    emitRunUpdate(currentRun);
    const finalContacts = await listContactsForRun(currentRun.id);

    console.log('\n' + '='.repeat(50));
    console.log('🎉 Agent Complete!');
    console.log(`   Total contacts extracted: ${finalContacts.length}`);
    console.log(`   CSV exported to: ${csvPath}`);
    if (currentRun.hubspotSynced || currentRun.hubspotFailed) {
      console.log(`   HubSpot synced: ${currentRun.hubspotSynced} successful, ${currentRun.hubspotFailed} failed`);
    }
    if (currentRun.sequenceEnrolled || currentRun.sequenceFailed) {
      console.log(`   Sequence enrolled: ${currentRun.sequenceEnrolled} successful, ${currentRun.sequenceFailed} failed`);
    }
    console.log('='.repeat(50));

    return buildAggregatedResults(currentRun, finalContacts, csvPath, hubspotResults, sequenceResults);

  } catch (error) {
    if (currentRun?.id) {
      await failRun(currentRun.id, error);
    }
    console.error('❌ Agent failed:', error.message);
    throw error;
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
    schoolBatchSize: Number.parseInt(process.env.NICHE_SCHOOL_BATCH_SIZE || '5', 10),
  });
}