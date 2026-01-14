import { Client } from '@hubspot/api-client';

/**
 * Email Automation Module
 * Handles enrolling contacts in HubSpot workflows and sending transactional emails
 */

/**
 * Enroll a contact in a HubSpot workflow
 * @param {string} contactId - HubSpot contact ID
 * @param {string} workflowId - HubSpot workflow ID
 * @param {string} accessToken - HubSpot access token
 * @returns {Promise<Object>} Result object with success status
 */
export async function enrollInWorkflow(contactId, workflowId, accessToken) {
  if (!contactId || !workflowId || !accessToken) {
    return {
      success: false,
      contactId,
      workflowId,
      error: 'Missing required parameters (contactId, workflowId, or accessToken)',
    };
  }

  try {
    // Use direct API call for workflow enrollment
    // The HubSpot SDK may not have this endpoint, so we use fetch
    const url = `https://api.hubapi.com/automation/v3/workflows/${workflowId}/enrollments/contacts/${contactId}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (response.ok || response.status === 204) {
      return {
        success: true,
        contactId,
        workflowId,
      };
    } else {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `HTTP ${response.status}: ${response.statusText}`);
    }
  } catch (error) {
    const errorMessage = error.message || 'Unknown error';
    const errorCode = error.code || error.statusCode || error.status;
    const errorBody = error.body || error.response?.body || {};

    console.error(
      `[Workflow] Failed to enroll contact ${contactId} in workflow ${workflowId}:`,
      errorMessage
    );

    return {
      success: false,
      contactId,
      workflowId,
      error: errorMessage,
      code: errorCode,
      details: errorBody,
    };
  }
}

/**
 * Send transactional email to a contact using HubSpot's Single-Send API
 * @param {string} contactEmail - Contact email address
 * @param {string} emailTemplateId - HubSpot email template ID
 * @param {string} accessToken - HubSpot access token
 * @returns {Promise<Object>} Result object with success status
 */
export async function sendTransactionalEmail(
  contactEmail,
  emailTemplateId,
  accessToken
) {
  if (!contactEmail || !emailTemplateId || !accessToken) {
    return {
      success: false,
      email: contactEmail,
      error: 'Missing required parameters (contactEmail, emailTemplateId, or accessToken)',
    };
  }

  try {
    // Use direct API call for transactional email
    // The HubSpot SDK may not have this endpoint, so we use fetch
    const url = 'https://api.hubapi.com/marketing/v3/transactional/single-email/send';
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        emailId: emailTemplateId,
        message: {
          to: contactEmail,
        },
      }),
    });

    if (response.ok) {
      const responseData = await response.json().catch(() => ({}));
      return {
        success: true,
        email: contactEmail,
        data: responseData,
      };
    } else {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `HTTP ${response.status}: ${response.statusText}`);
    }
  } catch (error) {
    const errorMessage = error.message || 'Unknown error';
    const errorCode = error.code || error.statusCode || error.status;
    const errorBody = error.body || error.response?.body || {};

    console.error(
      `[Email] Failed to send email to ${contactEmail}:`,
      errorMessage
    );

    return {
      success: false,
      email: contactEmail,
      error: errorMessage,
      code: errorCode,
      details: errorBody,
    };
  }
}

/**
 * Get contact ID from email address
 * @param {string} email - Contact email address
 * @param {string} accessToken - HubSpot access token
 * @returns {Promise<string|null>} Contact ID or null if not found
 */
async function getContactIdByEmail(email, accessToken) {
  const client = new Client({ accessToken });

  try {
    const searchRequest = {
      filterGroups: [
        {
          filters: [
            {
              propertyName: 'email',
              operator: 'EQ',
              value: email,
            },
          ],
        },
      ],
      properties: ['email', 'firstname', 'lastname'],
      limit: 1,
    };

    const response = await client.crm.contacts.searchApi.doSearch(searchRequest);

    if (response.results && response.results.length > 0) {
      return response.results[0].id;
    }

    return null;
  } catch (error) {
    console.error(`[Workflow] Failed to find contact by email ${email}:`, error.message);
    return null;
  }
}

/**
 * Batch enroll contacts in a HubSpot workflow
 * Finds contact IDs from emails and enrolls them in the specified workflow
 * @param {Array<Object>} contacts - Array of contact objects with email property
 * @param {string} workflowId - HubSpot workflow ID
 * @param {string} accessToken - HubSpot access token
 * @param {Object} options - Options for batch processing
 * @returns {Promise<Object>} Results object with success and failed arrays
 */
export async function enrollContactsInWorkflow(
  contacts,
  workflowId,
  accessToken,
  options = {}
) {
  const {
    delayBetweenContacts = 200, // 200ms delay between contacts
    onProgress = null, // Progress callback
  } = options;

  if (!contacts || contacts.length === 0) {
    console.log('[Workflow] No contacts to enroll');
    return { success: [], failed: [], total: 0 };
  }

  if (!workflowId || !accessToken) {
    console.error('[Workflow] Missing workflowId or accessToken');
    return {
      success: [],
      failed: contacts.map((c) => ({
        email: c.email,
        error: 'Missing workflowId or accessToken',
      })),
      total: contacts.length,
    };
  }

  const results = {
    success: [],
    failed: [],
    total: contacts.length,
  };

  console.log(
    `[Workflow] Starting enrollment of ${contacts.length} contacts in workflow ${workflowId}...`
  );

  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i];
    const progress = i + 1;

    try {
      if (!contact.email) {
        results.failed.push({
          email: contact.email || 'unknown',
          error: 'Contact missing email address',
        });
        continue;
      }

      // Get contact ID from email
      const contactId = await getContactIdByEmail(contact.email, accessToken);

      if (!contactId) {
        results.failed.push({
          email: contact.email,
          error: 'Contact not found in HubSpot',
        });
        console.log(`  ⚠️  Contact not found: ${contact.email}`);
        continue;
      }

      // Enroll in workflow
      const enrollResult = await enrollInWorkflow(
        contactId,
        workflowId,
        accessToken
      );

      if (enrollResult.success) {
        results.success.push({
          email: contact.email,
          contactId: contactId,
          workflowId: workflowId,
        });
        console.log(
          `  ✅ [${progress}/${contacts.length}] Enrolled: ${contact.email}`
        );
      } else {
        results.failed.push({
          email: contact.email,
          contactId: contactId,
          error: enrollResult.error || 'Unknown error',
          code: enrollResult.code,
        });
        console.log(
          `  ❌ [${progress}/${contacts.length}] Failed: ${contact.email} - ${enrollResult.error}`
        );
      }

      // Progress callback
      if (onProgress) {
        onProgress({
          processed: progress,
          total: contacts.length,
          success: results.success.length,
          failed: results.failed.length,
        });
      }

      // Rate limiting - delay between contacts
      if (i < contacts.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayBetweenContacts));
      }
    } catch (error) {
      const errorMessage = error.message || 'Unknown error';
      results.failed.push({
        email: contact.email || 'unknown',
        error: errorMessage,
      });
      console.log(`  ❌ [${progress}/${contacts.length}] Error: ${contact.email} - ${errorMessage}`);
    }
  }

  console.log('\n[Workflow] Enrollment complete!');
  console.log(`  ✅ Successfully enrolled: ${results.success.length}`);
  console.log(`  ❌ Failed: ${results.failed.length}`);

  if (results.failed.length > 0) {
    console.log('\n[Workflow] Failed enrollments:');
    results.failed.forEach((failure) => {
      const codeInfo = failure.code ? ` [Code: ${failure.code}]` : '';
      console.log(`  - ${failure.email}: ${failure.error}${codeInfo}`);
    });
  }

  return results;
}

/**
 * Batch send transactional emails to contacts
 * @param {Array<Object>} contacts - Array of contact objects with email property
 * @param {string} emailTemplateId - HubSpot email template ID
 * @param {string} accessToken - HubSpot access token
 * @param {Object} options - Options for batch processing
 * @returns {Promise<Object>} Results object with success and failed arrays
 */
export async function sendEmailsToContacts(
  contacts,
  emailTemplateId,
  accessToken,
  options = {}
) {
  const {
    delayBetweenEmails = 200, // 200ms delay between emails
    onProgress = null, // Progress callback
  } = options;

  if (!contacts || contacts.length === 0) {
    console.log('[Email] No contacts to send emails to');
    return { success: [], failed: [], total: 0 };
  }

  if (!emailTemplateId || !accessToken) {
    console.error('[Email] Missing emailTemplateId or accessToken');
    return {
      success: [],
      failed: contacts.map((c) => ({
        email: c.email,
        error: 'Missing emailTemplateId or accessToken',
      })),
      total: contacts.length,
    };
  }

  const results = {
    success: [],
    failed: [],
    total: contacts.length,
  };

  console.log(
    `[Email] Starting to send ${contacts.length} emails using template ${emailTemplateId}...`
  );

  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i];
    const progress = i + 1;

    try {
      if (!contact.email) {
        results.failed.push({
          email: contact.email || 'unknown',
          error: 'Contact missing email address',
        });
        continue;
      }

      const emailResult = await sendTransactionalEmail(
        contact.email,
        emailTemplateId,
        accessToken
      );

      if (emailResult.success) {
        results.success.push({
          email: contact.email,
        });
        console.log(`  ✅ [${progress}/${contacts.length}] Sent: ${contact.email}`);
      } else {
        results.failed.push({
          email: contact.email,
          error: emailResult.error || 'Unknown error',
          code: emailResult.code,
        });
        console.log(
          `  ❌ [${progress}/${contacts.length}] Failed: ${contact.email} - ${emailResult.error}`
        );
      }

      // Progress callback
      if (onProgress) {
        onProgress({
          processed: progress,
          total: contacts.length,
          success: results.success.length,
          failed: results.failed.length,
        });
      }

      // Rate limiting - delay between emails
      if (i < contacts.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayBetweenEmails));
      }
    } catch (error) {
      const errorMessage = error.message || 'Unknown error';
      results.failed.push({
        email: contact.email || 'unknown',
        error: errorMessage,
      });
      console.log(`  ❌ [${progress}/${contacts.length}] Error: ${contact.email} - ${errorMessage}`);
    }
  }

  console.log('\n[Email] Sending complete!');
  console.log(`  ✅ Successfully sent: ${results.success.length}`);
  console.log(`  ❌ Failed: ${results.failed.length}`);

  if (results.failed.length > 0) {
    console.log('\n[Email] Failed sends:');
    results.failed.forEach((failure) => {
      const codeInfo = failure.code ? ` [Code: ${failure.code}]` : '';
      console.log(`  - ${failure.email}: ${failure.error}${codeInfo}`);
    });
  }

  return results;
}
