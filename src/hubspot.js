import { Client } from '@hubspot/api-client';

/**
 * HubSpot Integration Module
 * Handles creating and updating contacts in HubSpot CRM
 */
export class HubSpotClient {
  constructor(accessToken) {
    if (!accessToken) {
      throw new Error('HUBSPOT_ACCESS_TOKEN is required');
    }
    this.client = new Client({ accessToken });
  }

  /**
   * Transform contact data to HubSpot format
   * Maps our contact structure to HubSpot contact properties
   * Only includes properties that have values to avoid errors
   */
  transformContactToHubSpot(contact) {
    const properties = {
      email: contact.email,
    };

    // Only add properties that have values
    if (contact.firstName) properties.firstname = contact.firstName;
    if (contact.lastName) properties.lastname = contact.lastName;
    if (contact.jobTitle) properties.jobtitle = contact.jobTitle;
    if (contact.phone) properties.phone = contact.phone;

    // Custom properties for school information (only if they exist)
    // Note: These custom properties need to be created in HubSpot first
    if (contact.schoolName) properties.school_name = contact.schoolName;
    if (contact.schoolDomain) properties.school_domain = contact.schoolDomain;
    if (contact.schoolPhone) properties.school_phone = contact.schoolPhone;
    if (contact.schoolState) properties.school_state = contact.schoolState;

    return { properties };
  }

  /**
   * Find contact by email
   * Returns contact ID if found, null otherwise
   * @deprecated Use searchContactByEmail instead
   */
  async findContactByEmail(email) {
    return await this.searchContactByEmail(email);
  }

  /**
   * Search for contact by email using search API
   * More reliable method for finding contacts
   */
  async searchContactByEmail(email) {
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

      const response = await this.client.crm.contacts.searchApi.doSearch(
        searchRequest
      );
      
      if (response.results && response.results.length > 0) {
        return response.results[0].id;
      }
      return null;
    } catch (error) {
      // If search fails, assume contact doesn't exist (will try to create)
      // Log the error but don't throw - we'll try to create the contact instead
      const errorCode = error.code || error.statusCode || error.status;
      if (errorCode === 404 || error.status === 'error') {
        return null;
      }
      // For other errors (like rate limits, auth issues), log but return null
      // This allows the create operation to proceed and show the real error
      console.warn(`[HubSpot] Search failed for ${email}: ${error.message} - will attempt to create`);
      return null;
    }
  }

  /**
   * Create a new contact in HubSpot
   */
  async createContact(contact, retryWithoutCustomProps = false) {
    try {
      let contactObj;
      
      if (retryWithoutCustomProps) {
        // Create with only standard properties (no custom properties)
        contactObj = {
          properties: {
            email: contact.email,
            firstname: contact.firstName || '',
            lastname: contact.lastName || '',
            jobtitle: contact.jobTitle || '',
            phone: contact.phone || '',
          },
        };
      } else {
        // Try with all properties including custom ones
        contactObj = this.transformContactToHubSpot(contact);
      }
      
      const response = await this.client.crm.contacts.basicApi.create(contactObj);
      return {
        success: true,
        contactId: response.id,
        email: contact.email,
        action: 'created',
        warning: retryWithoutCustomProps ? 'Custom properties skipped (do not exist in HubSpot)' : undefined,
      };
    } catch (error) {
      // Handle duplicate email error (409)
      if (error.code === 409 || error.statusCode === 409) {
        // Try to update instead
        return await this.updateContactByEmail(contact);
      }
      
      // Handle invalid property errors (400) - might be missing custom properties
      if ((error.code === 400 || error.statusCode === 400) && !retryWithoutCustomProps) {
        const errorBody = error.body || error.response?.body || {};
        const errors = errorBody.errors || [];
        
        // Check if error is due to missing custom properties
        const hasPropertyError = errors.some(e => 
          e.code === 'PROPERTY_DOESNT_EXIST' || 
          e.message?.includes('does not exist') ||
          errorBody.message?.includes('does not exist')
        );
        
        if (hasPropertyError) {
          // Retry without custom properties
          console.log(`[HubSpot] Custom properties don't exist, retrying without them for ${contact.email}`);
          return await this.createContact(contact, true);
        }
      }
      
      throw error;
    }
  }

  /**
   * Update an existing contact by email
   */
  async updateContactByEmail(contact) {
    try {
      // First, find the contact ID by email
      const contactId = await this.searchContactByEmail(contact.email);
      
      if (!contactId) {
        // If not found, try to create it
        return await this.createContact(contact);
      }

      // Update the contact
      const contactObj = this.transformContactToHubSpot(contact);
      await this.client.crm.contacts.basicApi.update(contactId, contactObj);
      
      return {
        success: true,
        contactId: contactId,
        email: contact.email,
        action: 'updated',
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Create or update a contact (upsert operation)
   * This is the main method to use for syncing contacts
   */
  async upsertContact(contact) {
    if (!contact.email) {
      return {
        success: false,
        email: contact.email || 'unknown',
        error: 'Email is required',
      };
    }

    try {
      // Try to find existing contact (this may return null if not found or on error)
      const existingContactId = await this.searchContactByEmail(contact.email);
      
      if (existingContactId) {
        // Update existing contact
        try {
          // Try updating with all properties first
          const contactObj = this.transformContactToHubSpot(contact);
          await this.client.crm.contacts.basicApi.update(existingContactId, contactObj);
          return {
            success: true,
            contactId: existingContactId,
            email: contact.email,
            action: 'updated',
          };
        } catch (updateError) {
          // If update fails due to missing properties, try with only standard properties
          const errorBody = updateError.body || updateError.response?.body || {};
          const hasPropertyError = errorBody.errors?.some(e => 
            e.code === 'PROPERTY_DOESNT_EXIST' || 
            e.message?.includes('does not exist')
          ) || errorBody.message?.includes('does not exist');
          
          if (hasPropertyError && (updateError.code === 400 || updateError.statusCode === 400)) {
            // Update with only standard properties
            const contactObjBasic = {
              properties: {
                email: contact.email,
                firstname: contact.firstName || '',
                lastname: contact.lastName || '',
                jobtitle: contact.jobTitle || '',
                phone: contact.phone || '',
              },
            };
            await this.client.crm.contacts.basicApi.update(existingContactId, contactObjBasic);
            return {
              success: true,
              contactId: existingContactId,
              email: contact.email,
              action: 'updated',
              warning: 'Custom properties skipped (do not exist in HubSpot)',
            };
          }
          // If update fails for other reasons, try to create instead
          console.warn(`[HubSpot] Update failed for ${contact.email}, trying create instead`);
          return await this.createContact(contact);
        }
      } else {
        // Create new contact
        return await this.createContact(contact);
      }
    } catch (error) {
      // Extract detailed error information
      const errorMessage = error.message || 'Unknown error';
      const errorCode = error.code || error.statusCode || error.status;
      const errorBody = error.body || error.response?.body || {};
      
      // Format error message with details
      let detailedError = errorMessage;
      if (errorBody.message) {
        detailedError = `${errorMessage}: ${errorBody.message}`;
      }
      if (errorBody.errors && Array.isArray(errorBody.errors)) {
        const errorDetails = errorBody.errors.map(e => e.message || e).join('; ');
        detailedError = `${detailedError} (${errorDetails})`;
      }

      return {
        success: false,
        email: contact.email,
        error: detailedError,
        code: errorCode,
        rawError: errorBody,
      };
    }
  }

  /**
   * Batch upload contacts to HubSpot
   * Handles rate limiting and provides progress updates
   */
  async uploadContacts(contacts, options = {}) {
    const {
      batchSize = 10,
      delayBetweenBatches = 1000, // 1 second delay between batches
      onProgress = null,
      onResult = null,
      shouldStop = null,
    } = options;

    const results = {
      success: [],
      failed: [],
      total: contacts.length,
    };

    // Process contacts in batches to avoid rate limits
    for (let i = 0; i < contacts.length; i += batchSize) {
      if (shouldStop && await shouldStop()) {
        return { ...results, stopped: true };
      }

      const batch = contacts.slice(i, i + batchSize);
      const batchNumber = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(contacts.length / batchSize);

      console.log(
        `[HubSpot] Processing batch ${batchNumber}/${totalBatches} (${batch.length} contacts)...`
      );

      // Process each contact in the batch
      for (const contact of batch) {
        if (shouldStop && await shouldStop()) {
          return { ...results, stopped: true };
        }

        try {
          const result = await this.upsertContact(contact);
          
          if (result.success) {
            results.success.push(result);
            console.log(
              `  ✅ ${result.action}: ${contact.email} (ID: ${result.contactId})`
            );
          } else {
            results.failed.push(result);
            const errorCode = result.code ? ` [Code: ${result.code}]` : '';
            console.log(`  ❌ Failed: ${contact.email} - ${result.error}${errorCode}`);
            // Log additional error details if available
            if (result.rawError && Object.keys(result.rawError).length > 0) {
              console.log(`     Details:`, JSON.stringify(result.rawError, null, 2));
            }
          }

          if (onResult) {
            await onResult(result);
          }

          // Small delay between individual contacts to respect rate limits
          await new Promise((resolve) => setTimeout(resolve, 100));
        } catch (error) {
          const errorCode = error.code || error.statusCode || error.status;
          const errorMessage = error.message || 'Unknown error';
          const errorBody = error.body || error.response?.body || {};
          
          let detailedError = errorMessage;
          if (errorBody.message) {
            detailedError = `${errorMessage}: ${errorBody.message}`;
          }
          
          const errorResult = {
            success: false,
            email: contact.email,
            error: detailedError,
            code: errorCode,
            rawError: errorBody,
          };
          results.failed.push(errorResult);
          console.log(`  ❌ Error: ${contact.email} - ${detailedError} [Code: ${errorCode}]`);
          // Log full error for debugging
          if (errorBody && Object.keys(errorBody).length > 0) {
            console.log(`     Full error:`, JSON.stringify(errorBody, null, 2));
          }
          if (onResult) {
            await onResult(errorResult);
          }
        }
      }

      // Progress callback
      if (onProgress) {
        onProgress({
          processed: Math.min(i + batchSize, contacts.length),
          total: contacts.length,
          success: results.success.length,
          failed: results.failed.length,
        });
      }

      // Delay between batches (except for the last batch)
      if (i + batchSize < contacts.length) {
        await new Promise((resolve) => setTimeout(resolve, delayBetweenBatches));
      }
    }

    return results;
  }
}

/**
 * Convenience function to upload contacts to HubSpot
 * This is the main export function used by the agent
 */
export async function uploadContactsToHubSpot(contacts, options = {}) {
  const accessToken = process.env.HUBSPOT_ACCESS_TOKEN;
  
  if (!accessToken) {
    throw new Error(
      'HUBSPOT_ACCESS_TOKEN environment variable is not set. Please add it to your .env file.'
    );
  }

  if (!contacts || contacts.length === 0) {
    console.log('[HubSpot] No contacts to upload');
    return { success: [], failed: [], total: 0 };
  }

  // Validate access token format (HubSpot tokens are typically long strings)
  if (accessToken.length < 20) {
    console.warn('[HubSpot] Warning: Access token seems too short. Please verify it\'s correct.');
  }

  const hubspotClient = new HubSpotClient(accessToken);
  
  console.log(`[HubSpot] Starting upload of ${contacts.length} contacts...`);
  console.log(`[HubSpot] Access token: ${accessToken.substring(0, 10)}...${accessToken.substring(accessToken.length - 4)}`);
  
  try {
    const results = await hubspotClient.uploadContacts(contacts, {
      batchSize: 10,
      delayBetweenBatches: 1000,
      onResult: options.onResult || null,
      shouldStop: options.shouldStop || null,
      onProgress: (progress) => {
        const percentage = ((progress.processed / progress.total) * 100).toFixed(1);
        console.log(
          `[HubSpot] Progress: ${progress.processed}/${progress.total} (${percentage}%) - Success: ${progress.success}, Failed: ${progress.failed}`
        );
        if (options.onProgress) {
          options.onProgress(progress);
        }
      },
    });

    console.log('\n[HubSpot] Upload complete!');
    console.log(`  ✅ Successfully synced: ${results.success.length}`);
    console.log(`  ❌ Failed: ${results.failed.length}`);
    
    if (results.failed.length > 0) {
      console.log('\n[HubSpot] Failed contacts:');
      results.failed.forEach((failure) => {
        const codeInfo = failure.code ? ` [Code: ${failure.code}]` : '';
        console.log(`  - ${failure.email}: ${failure.error}${codeInfo}`);
      });
      
      // Check for common error patterns
      const authErrors = results.failed.filter(f => 
        f.error?.toLowerCase().includes('unauthorized') || 
        f.error?.toLowerCase().includes('authentication') ||
        f.code === 401 ||
        f.code === 403
      );
      
      if (authErrors.length > 0) {
        console.log('\n⚠️  [HubSpot] Authentication errors detected!');
        console.log('   Please check your HUBSPOT_ACCESS_TOKEN in .env file');
        console.log('   Make sure the token is valid and has proper permissions.');
      }
      
      const propertyErrors = results.failed.filter(f => 
        f.error?.toLowerCase().includes('property') ||
        f.error?.toLowerCase().includes('invalid property') ||
        f.code === 400
      );
      
      if (propertyErrors.length > 0) {
        console.log('\n⚠️  [HubSpot] Property errors detected!');
        console.log('   Some custom properties may not exist in HubSpot.');
        console.log('   The system will try to create contacts without custom properties.');
        console.log('   To use custom properties, create them in HubSpot:');
        console.log('   - Settings → Properties → Contact properties');
        console.log('   - Create: school_name, school_domain, school_phone, school_state');
      }
    }

    return results;
  } catch (error) {
    console.error('\n❌ [HubSpot] Fatal error during upload:', error.message);
    if (error.code === 401 || error.statusCode === 401) {
      console.error('   Authentication failed. Please check your HUBSPOT_ACCESS_TOKEN.');
    } else if (error.code === 403 || error.statusCode === 403) {
      console.error('   Access forbidden. Please check your token permissions.');
    }
    throw error;
  }
}
