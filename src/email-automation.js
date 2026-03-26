import { Client } from "@hubspot/api-client";
import 'dotenv/config';
/**
 * Get contact ID from email
 */
async function getContactIdByEmail(email, accessToken) {
  const client = new Client({ accessToken });

  try {
    const searchRequest = {
      filterGroups: [
        {
          filters: [
            {
              propertyName: "email",
              operator: "EQ",
              value: email,
            },
          ],
        },
      ],
      properties: ["email"],
      limit: 1,
    };

    const response = await client.crm.contacts.searchApi.doSearch(searchRequest);

    if (response.results?.length > 0) {
      return response.results[0].id;
    }

    return null;
  } catch (error) {
    console.error(`Failed to find contact ${email}:`, error.message);
    return null;
  }
}

/**
 * Enroll contact in Sales Sequence
 */
export async function enrollInSequence(
  contactId,
  sequenceId,
  userId ,
  senderEmail,
  accessToken
) {
  try {
    const response = await fetch(
      `https://api.hubapi.com/automation/v4/sequences/enrollments?userId=${userId}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contactId,
          sequenceId,
          senderEmail,
        }),
      }
    );

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.message || `HTTP ${response.status}`);
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Batch enroll contacts into a Sales Sequence
 */
export async function enrollContactsInSequence(
  contacts,
  sequenceId,
  userId,
  senderEmail,
  accessToken,
  options = {}
) {
  const {
    delayBetweenContacts = 300,
    onProgress = null,
    onResult = null,
    shouldStop = null,
  } = options;

  if (!contacts?.length) {
    return { success: [], failed: [], total: 0 };
  }

  const results = {
    success: [],
    failed: [],
    total: contacts.length,
  };

  console.log(
    `Starting enrollment of ${contacts.length} contacts into sequence ${sequenceId}`
  );

  for (let i = 0; i < contacts.length; i++) {
    if (shouldStop && await shouldStop()) {
      return { ...results, stopped: true };
    }

    const contact = contacts[i];
    const progress = i + 1;

    try {
      if (!contact.email) {
        const missingEmailResult = {
          email: "unknown",
          error: "Missing email",
        };
        results.failed.push(missingEmailResult);
        if (onProgress) {
          onProgress({
            processed: progress,
            total: contacts.length,
            success: results.success.length,
            failed: results.failed.length,
            email: "unknown",
            enrolled: false,
            error: "Missing email",
          });
        }
        if (onResult) {
          await onResult({ ...missingEmailResult, success: false });
        }
        continue;
      }

      // 1️⃣ Find Contact ID
      const contactId = await getContactIdByEmail(
        contact.email,
        accessToken
      );

      if (!contactId) {
        const missingContactResult = {
          email: contact.email,
          error: "Contact not found",
        };
        results.failed.push(missingContactResult);
        if (onProgress) {
          onProgress({
            processed: progress,
            total: contacts.length,
            success: results.success.length,
            failed: results.failed.length,
            email: contact.email,
            enrolled: false,
            error: "Contact not found",
          });
        }
        if (onResult) {
          await onResult({ ...missingContactResult, success: false });
        }
        continue;
      }

      // 2️⃣ Enroll in Sequence
      const enrollResult = await enrollInSequence(
        contactId,
        sequenceId,
        userId,
        senderEmail,
        accessToken
      );

      if (enrollResult.success) {
        const successResult = {
          email: contact.email,
          contactId,
        };
        results.success.push(successResult);

        console.log(
          `✅ [${progress}/${contacts.length}] Enrolled: ${contact.email}`
        );
        if (onResult) {
          await onResult({ ...successResult, success: true });
        }
      } else {
        const failedResult = {
          email: contact.email,
          contactId,
          error: enrollResult.error,
        };
        results.failed.push(failedResult);

        console.log(
          `❌ [${progress}/${contacts.length}] Failed: ${contact.email} - ${enrollResult.error}`
        );
        if (onResult) {
          await onResult({ ...failedResult, success: false });
        }
      }

      if (onProgress) {
        onProgress({
          processed: progress,
          total: contacts.length,
          success: results.success.length,
          failed: results.failed.length,
          email: contact.email,
          enrolled: enrollResult.success,
          error: enrollResult.success ? undefined : enrollResult.error,
        });
      }

      if (i < contacts.length - 1) {
        await new Promise((resolve) =>
          setTimeout(resolve, delayBetweenContacts)
        );
      }
    } catch (error) {
      const errorResult = {
        email: contact.email || "unknown",
        error: error.message,
      };
      results.failed.push(errorResult);
      if (onResult) {
        await onResult({ ...errorResult, success: false });
      }
    }
  }

  console.log("Enrollment complete.");
  console.log("Success:", results.success.length);
  console.log("Failed:", results.failed.length);

  return results;
}
