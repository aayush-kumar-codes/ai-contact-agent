import OpenAI from "openai"
import { APPROVED_JOB_TITLES, getStandardizedTitle } from "./job-titles.js"

export class AIExtractor {
  constructor(apiKey) {
    this.openai = new OpenAI({ apiKey })
  }

  async extractContacts(htmlContent, schoolInfo) {
    // Clean HTML to reduce tokens
    const cleanedContent = this.cleanHtml(htmlContent)

    const jobTitlesList = APPROVED_JOB_TITLES.join("\n- ")

    const response = await this.openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are a data extraction specialist. Extract faculty/staff contact information from school websites.

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
        },
        {
          role: "user",
          content: `Extract faculty contacts from ${schoolInfo.name} website content:\n\n${cleanedContent.substring(0, 25000)}`,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
    })

    try {
      const result = JSON.parse(response.choices[0].message.content)

      // Filter and validate contacts - ensure job titles match approved list
      const validContacts = (result.contacts || []).filter((contact) => {
        if (!contact.email || !contact.firstName) return false

        const standardizedTitle = getStandardizedTitle(contact.jobTitle)
        if (!standardizedTitle) {
          console.log(`[AI] Rejected contact - title not approved: ${contact.jobTitle}`)
          return false
        }

        // Update to standardized title
        contact.jobTitle = standardizedTitle
        return true
      })

      console.log(
        `[AI] Extracted ${validContacts.length} valid contacts (filtered from ${result.contacts?.length || 0})`,
      )

      return {
        contacts: validContacts,
        schoolPhone: result.schoolPhone || null,
        schoolState: result.schoolState || null,
      }
    } catch (e) {
      console.error("[AI] Failed to parse response:", e.message)
      return { contacts: [], schoolPhone: null, schoolState: null }
    }
  }

  cleanHtml(html) {
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  }
}
