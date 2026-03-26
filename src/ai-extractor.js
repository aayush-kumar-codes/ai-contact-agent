import { Agent, run, setDefaultOpenAIKey } from '@openai/agents';
import { z } from 'zod';
import { APPROVED_JOB_TITLES, getStandardizedTitle } from './job-titles.js';

const ContactSchema = z.object({
  firstName: z.string().trim().default(''),
  lastName: z.string().trim().nullable().optional(),
  jobTitle: z.string().trim().nullable().optional(),
  email: z.string().trim().default(''),
  phone: z.string().trim().nullable().optional(),
});

const ExtractionSchema = z.object({
  contacts: z.array(ContactSchema).default([]),
  schoolPhone: z.string().trim().nullable().optional(),
  schoolState: z.string().trim().nullable().optional(),
});

export class AIExtractor {
  constructor(apiKey) {
    if (apiKey) {
      setDefaultOpenAIKey(apiKey);
    }
    this.model = process.env.OPENAI_EXTRACTION_MODEL || 'gpt-4.1-mini';
  }

  async extractContacts(htmlContent, schoolInfo) {
    const cleanedContent = this.cleanHtml(htmlContent);
    const jobTitlesList = APPROVED_JOB_TITLES.join('\n- ');
    const extractorAgent = new Agent({
      name: 'School Contact Extractor',
      model: this.model,
      instructions: `You are a data extraction specialist. Extract faculty and staff contact information from school websites.

IMPORTANT: Only extract contacts whose job title matches or is similar to one of these approved titles:
- ${jobTitlesList}

If a person's job title does not match any of these, DO NOT include them.

Return a JSON object with this structure:
{
  "contacts": [
    {
      "firstName": "First Name",
      "lastName": "Last Name", 
      "jobTitle": "Their exact job title from the website",
      "email": "email@school.edu",
      "phone": "phone number or null if not available"
    }
  ],
  "schoolPhone": "main school phone if found",
  "schoolState": "two-letter state code if found"
}

Rules:
- Only include contacts with at least a name AND email
- Job title MUST match or be very similar to one of the approved titles above
- Extract the EXACT job title as shown on the website
- If no matching contacts found, return empty contacts array`,
      outputType: ExtractionSchema,
    });

    try {
      const result = await run(
        extractorAgent,
        `Extract faculty contacts from ${schoolInfo.name} website content:\n\n${cleanedContent.substring(0, 25000)}`
      );
      const finalOutput = result.finalOutput || { contacts: [], schoolPhone: null, schoolState: null };

      // Filter and validate contacts - ensure job titles match approved list
      const validContacts = (finalOutput.contacts || []).filter((contact) => {
        if (!contact.email || !contact.firstName) return false;

        const standardizedTitle = getStandardizedTitle(contact.jobTitle);
        if (!standardizedTitle) {
          console.log(`[AI] Rejected contact - title not approved: ${contact.jobTitle}`);
          return false;
        }

        // Update to standardized title
        contact.jobTitle = standardizedTitle;
        return true;
      });

      console.log(
        `[AI] Extracted ${validContacts.length} valid contacts (filtered from ${finalOutput.contacts?.length || 0})`,
      );

      return {
        contacts: validContacts,
        schoolPhone: finalOutput.schoolPhone || null,
        schoolState: finalOutput.schoolState || null,
      };
    } catch (e) {
      console.error('[AI] Failed to extract contacts:', e.message);
      return { contacts: [], schoolPhone: null, schoolState: null };
    }
  }

  cleanHtml(html) {
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
