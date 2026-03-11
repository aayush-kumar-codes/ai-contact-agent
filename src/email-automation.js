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
    const contact = contacts[i];
    const progress = i + 1;

    try {
      if (!contact.email) {
        results.failed.push({
          email: "unknown",
          error: "Missing email",
        });
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
        continue;
      }

      // 1️⃣ Find Contact ID
      const contactId = await getContactIdByEmail(
        contact.email,
        accessToken
      );

      if (!contactId) {
        results.failed.push({
          email: contact.email,
          error: "Contact not found",
        });
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
        results.success.push({
          email: contact.email,
          contactId,
        });

        console.log(
          `✅ [${progress}/${contacts.length}] Enrolled: ${contact.email}`
        );
      } else {
        results.failed.push({
          email: contact.email,
          contactId,
          error: enrollResult.error,
        });

        console.log(
          `❌ [${progress}/${contacts.length}] Failed: ${contact.email} - ${enrollResult.error}`
        );
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
      results.failed.push({
        email: contact.email || "unknown",
        error: error.message,
      });
    }
  }

  console.log("Enrollment complete.");
  console.log("Success:", results.success.length);
  console.log("Failed:", results.failed.length);

  return results;
}
