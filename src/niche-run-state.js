import { prisma } from '../prisma.js';

const RESUMABLE_STATUSES = ['pending', 'running', 'stopping', 'stopped', 'failed'];

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeNicheSearchUrl(searchUrl) {
  const url = new URL(searchUrl);
  url.searchParams.delete('page');
  return url.toString();
}

export function getPageNumberFromUrl(searchUrl) {
  try {
    const url = new URL(searchUrl);
    const page = Number.parseInt(url.searchParams.get('page') || '1', 10);
    return Number.isFinite(page) && page > 0 ? page : 1;
  } catch {
    return 1;
  }
}

export function buildNichePageUrl(searchUrl, pageNumber) {
  const url = new URL(searchUrl);
  url.searchParams.set('page', String(pageNumber));
  return url.toString();
}

function toNullableString(value) {
  const trimmed = cleanText(value);
  return trimmed || null;
}

async function refreshRunCounts(runId) {
  const [schoolCounts, contactsExtracted, hubspotSynced, hubspotFailed, sequenceEnrolled, sequenceFailed] = await Promise.all([
    prisma.nicheSchool.groupBy({
      by: ['status'],
      where: { runId },
      _count: { _all: true },
    }),
    prisma.nicheContact.count({ where: { runId } }),
    prisma.nicheContact.count({ where: { runId, hubspotStatus: 'completed' } }),
    prisma.nicheContact.count({ where: { runId, hubspotStatus: 'failed' } }),
    prisma.nicheContact.count({ where: { runId, sequenceStatus: 'completed' } }),
    prisma.nicheContact.count({ where: { runId, sequenceStatus: 'failed' } }),
  ]);

  const countsByStatus = schoolCounts.reduce((acc, item) => {
    acc[item.status] = item._count._all;
    return acc;
  }, {});

  return prisma.nicheRun.update({
    where: { id: runId },
    data: {
      schoolsDiscovered: Object.values(countsByStatus).reduce((sum, value) => sum + value, 0),
      schoolsProcessed:
        (countsByStatus.completed || 0) +
        (countsByStatus.skipped || 0) +
        (countsByStatus.failed || 0),
      schoolsCompleted: countsByStatus.completed || 0,
      schoolsSkipped: countsByStatus.skipped || 0,
      contactsExtracted,
      hubspotSynced,
      hubspotFailed,
      sequenceEnrolled,
      sequenceFailed,
    },
  });
}

export async function getResumableNicheRun(searchUrl) {
  const normalizedSearchUrl = normalizeNicheSearchUrl(searchUrl);
  return prisma.nicheRun.findFirst({
    where: {
      normalizedSearchUrl,
      status: { in: RESUMABLE_STATUSES },
    },
    orderBy: { updatedAt: 'desc' },
  });
}

export async function getRunById(runId) {
  if (!runId) return null;
  return prisma.nicheRun.findUnique({ where: { id: runId } });
}

export async function getLatestActiveNicheRun() {
  return prisma.nicheRun.findFirst({
    where: { status: { in: RESUMABLE_STATUSES } },
    orderBy: { updatedAt: 'desc' },
  });
}

export async function createOrResumeNicheRun(searchUrl, options = {}) {
  const normalizedSearchUrl = normalizeNicheSearchUrl(searchUrl);
  const startPage = getPageNumberFromUrl(searchUrl);
  const existingRun = await getResumableNicheRun(searchUrl);
  // USER_ID in this app is the HubSpot sequence owner id, not a local Prisma User id.
  // Keep it out of the NicheRun foreign-key column so runs can start without a matching User row.

  if (existingRun) {
    return prisma.nicheRun.update({
      where: { id: existingRun.id },
      data: {
        searchUrl,
        normalizedSearchUrl,
        outputFile: options.outputFile || existingRun.outputFile,
        maxSchools: options.maxSchools ?? existingRun.maxSchools,
        pageBatchSize: options.pageBatchSize ?? existingRun.pageBatchSize,
        sequenceId: options.sequenceId ?? existingRun.sequenceId,
        senderEmail: options.senderEmail ?? existingRun.senderEmail,
        stopRequested: false,
        stopRequestedAt: null,
        status: 'running',
        stage:
          existingRun.stage === 'completed'
            ? 'discovering_pages'
            : existingRun.stage,
        nextPage: existingRun.nextPage || startPage,
        currentPage: existingRun.currentPage || startPage,
        startedAt: existingRun.startedAt || new Date(),
        completedAt: null,
        lastError: null,
      },
    });
  }

  return prisma.nicheRun.create({
    data: {
      searchUrl,
      normalizedSearchUrl,
      outputFile: options.outputFile,
      maxSchools: options.maxSchools ?? null,
      pageBatchSize: options.pageBatchSize ?? 1,
      sequenceId: options.sequenceId ?? null,
      senderEmail: options.senderEmail ?? null,
      status: 'running',
      stage: 'discovering_pages',
      currentPage: startPage,
      nextPage: startPage,
      startedAt: new Date(),
    },
  });
}

export async function updateRunStage(runId, stage, data = {}) {
  return prisma.nicheRun.update({
    where: { id: runId },
    data: {
      stage,
      ...data,
    },
  });
}

export async function requestRunStop(runId) {
  return prisma.nicheRun.update({
    where: { id: runId },
    data: {
      stopRequested: true,
      stopRequestedAt: new Date(),
      status: 'stopping',
    },
  });
}

export async function isStopRequested(runId) {
  const run = await prisma.nicheRun.findUnique({
    where: { id: runId },
    select: { stopRequested: true },
  });
  return Boolean(run?.stopRequested);
}

export async function checkpointPagination(runId, pagination = {}) {
  const data = {};
  if (pagination.currentPage != null) data.currentPage = pagination.currentPage;
  if (pagination.nextPage != null) data.nextPage = pagination.nextPage;
  if (pagination.totalPages != null) data.totalPages = pagination.totalPages;
  if (pagination.lastCompletedPage != null) data.lastCompletedPage = pagination.lastCompletedPage;
  if (pagination.stage) data.stage = pagination.stage;
  if (pagination.status) data.status = pagination.status;

  if (Object.keys(data).length === 0) {
    return getRunById(runId);
  }

  return prisma.nicheRun.update({
    where: { id: runId },
    data,
  });
}

export async function addSchoolsForPage(runId, pageNumber, schoolUrls) {
  const uniqueUrls = [...new Set((schoolUrls || []).map(cleanText).filter(Boolean))];
  if (!uniqueUrls.length) {
    return refreshRunCounts(runId);
  }

  await prisma.nicheSchool.createMany({
    data: uniqueUrls.map((nicheSchoolUrl) => ({
      runId,
      pageNumber,
      nicheSchoolUrl,
    })),
    skipDuplicates: true,
  });

  return refreshRunCounts(runId);
}

export async function listSchoolsForPage(runId, pageNumber, options = {}) {
  const statuses = options.statuses || ['pending', 'failed'];
  const remaining = options.remaining;
  return prisma.nicheSchool.findMany({
    where: {
      runId,
      pageNumber,
      status: { in: statuses },
    },
    orderBy: [
      { pageNumber: 'asc' },
      { createdAt: 'asc' },
    ],
    ...(remaining != null ? { take: remaining } : {}),
  });
}

export async function markSchoolProcessing(schoolId) {
  return prisma.nicheSchool.update({
    where: { id: schoolId },
    data: {
      status: 'processing',
      startedAt: new Date(),
      errorMessage: null,
    },
  });
}

export async function markSchoolCompleted(schoolId, data = {}) {
  const updated = await prisma.nicheSchool.update({
    where: { id: schoolId },
    data: {
      status: 'completed',
      schoolName: toNullableString(data.schoolName),
      officialWebsite: toNullableString(data.officialWebsite),
      contactsFound: data.contactsFound ?? 0,
      skipReason: null,
      errorMessage: null,
      completedAt: new Date(),
    },
    select: { runId: true },
  });

  await refreshRunCounts(updated.runId);
}

export async function markSchoolSkipped(schoolId, reason, data = {}) {
  const updated = await prisma.nicheSchool.update({
    where: { id: schoolId },
    data: {
      status: 'skipped',
      schoolName: toNullableString(data.schoolName),
      officialWebsite: toNullableString(data.officialWebsite),
      skipReason: toNullableString(reason),
      errorMessage: null,
      contactsFound: 0,
      completedAt: new Date(),
    },
    select: { runId: true },
  });

  await refreshRunCounts(updated.runId);
}

export async function markSchoolFailed(schoolId, error, data = {}) {
  const updated = await prisma.nicheSchool.update({
    where: { id: schoolId },
    data: {
      status: 'failed',
      schoolName: toNullableString(data.schoolName),
      officialWebsite: toNullableString(data.officialWebsite),
      errorMessage: toNullableString(error?.message || error),
      completedAt: new Date(),
    },
    select: { runId: true },
  });

  await refreshRunCounts(updated.runId);
}

export async function saveContactsForSchool(runId, schoolId, contacts) {
  const uniqueContacts = [];
  const seenEmails = new Set();

  for (const contact of contacts || []) {
    const email = cleanText(contact.email).toLowerCase();
    if (!email || seenEmails.has(email)) continue;
    seenEmails.add(email);
    uniqueContacts.push({
      email,
      firstName: cleanText(contact.firstName),
      lastName: toNullableString(contact.lastName),
      jobTitle: toNullableString(contact.jobTitle),
      phone: toNullableString(contact.phone),
      schoolName: toNullableString(contact.schoolName),
      schoolDomain: toNullableString(contact.schoolDomain),
      schoolPhone: toNullableString(contact.schoolPhone),
      schoolState: toNullableString(contact.schoolState),
    });
  }

  for (const contact of uniqueContacts) {
    await prisma.nicheContact.upsert({
      where: {
        runId_email: {
          runId,
          email: contact.email,
        },
      },
      update: {
        schoolId,
        firstName: contact.firstName,
        lastName: contact.lastName,
        jobTitle: contact.jobTitle,
        phone: contact.phone,
        schoolName: contact.schoolName,
        schoolDomain: contact.schoolDomain,
        schoolPhone: contact.schoolPhone,
        schoolState: contact.schoolState,
      },
      create: {
        runId,
        schoolId,
        ...contact,
      },
    });
  }

  await refreshRunCounts(runId);
  return uniqueContacts.length;
}

export async function listContactsForRun(runId) {
  return prisma.nicheContact.findMany({
    where: { runId },
    orderBy: [
      { schoolName: 'asc' },
      { createdAt: 'asc' },
    ],
  });
}

export async function markContactsCsvExported(runId) {
  await prisma.nicheContact.updateMany({
    where: { runId },
    data: { csvExportedAt: new Date() },
  });
}

export async function listContactsPendingHubSpot(runId, options = {}) {
  const statuses = options.statuses || ['pending', 'failed'];
  return prisma.nicheContact.findMany({
    where: {
      runId,
      hubspotStatus: { in: statuses },
    },
    orderBy: { createdAt: 'asc' },
  });
}

export async function markHubSpotResult(runId, result) {
  if (!result?.email) return;
  await prisma.nicheContact.updateMany({
    where: { runId, email: cleanText(result.email).toLowerCase() },
    data: {
      hubspotStatus: result.success ? 'completed' : 'failed',
      hubspotContactId: result.contactId ? String(result.contactId) : null,
      hubspotAction: result.action ? String(result.action) : null,
      hubspotError: result.success ? null : toNullableString(result.error),
      hubspotProcessedAt: new Date(),
    },
  });
  await refreshRunCounts(runId);
}

export async function listContactsPendingSequence(runId, options = {}) {
  const statuses = options.statuses || ['pending', 'failed'];
  return prisma.nicheContact.findMany({
    where: {
      runId,
      hubspotStatus: 'completed',
      sequenceStatus: { in: statuses },
    },
    orderBy: { createdAt: 'asc' },
  });
}

export async function markSequenceResult(runId, result) {
  if (!result?.email) return;
  await prisma.nicheContact.updateMany({
    where: { runId, email: cleanText(result.email).toLowerCase() },
    data: {
      sequenceStatus: result.success ? 'completed' : 'failed',
      sequenceError: result.success ? null : toNullableString(result.error),
      sequenceProcessedAt: new Date(),
    },
  });
  await refreshRunCounts(runId);
}

export async function stopRun(runId) {
  return prisma.nicheRun.update({
    where: { id: runId },
    data: {
      status: 'stopped',
      stage: 'stopped',
      stopRequested: false,
    },
  });
}

export async function completeRun(runId) {
  await refreshRunCounts(runId);
  return prisma.nicheRun.update({
    where: { id: runId },
    data: {
      status: 'completed',
      stage: 'completed',
      stopRequested: false,
      completedAt: new Date(),
      lastError: null,
    },
  });
}

export async function failRun(runId, error, stage = 'failed') {
  await refreshRunCounts(runId);
  return prisma.nicheRun.update({
    where: { id: runId },
    data: {
      status: 'failed',
      stage,
      lastError: toNullableString(error?.message || error),
    },
  });
}

export function serializeRun(run) {
  if (!run) return null;
  return {
    id: run.id,
    searchUrl: run.searchUrl,
    normalizedSearchUrl: run.normalizedSearchUrl,
    outputFile: run.outputFile,
    pageBatchSize: run.pageBatchSize,
    maxSchools: run.maxSchools,
    status: run.status,
    stage: run.stage,
    stopRequested: run.stopRequested,
    currentPage: run.currentPage,
    nextPage: run.nextPage,
    totalPages: run.totalPages,
    lastCompletedPage: run.lastCompletedPage,
    schoolsDiscovered: run.schoolsDiscovered,
    schoolsProcessed: run.schoolsProcessed,
    schoolsCompleted: run.schoolsCompleted,
    schoolsSkipped: run.schoolsSkipped,
    contactsExtracted: run.contactsExtracted,
    hubspotSynced: run.hubspotSynced,
    hubspotFailed: run.hubspotFailed,
    sequenceEnrolled: run.sequenceEnrolled,
    sequenceFailed: run.sequenceFailed,
    lastError: run.lastError,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}
