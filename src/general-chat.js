import OpenAI from 'openai';

/**
 * Generate a normal conversational reply for non-scraping chat messages.
 * @param {string} userQuery
 * @param {string} apiKey
 * @returns {Promise<string>}
 */
export async function generateGeneralChatReply(userQuery, apiKey = process.env.OPENAI_API_KEY) {
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required for general chat.');
  }

  const openai = new OpenAI({ apiKey });
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content:
          'You are the assistant inside an AI contact agent app. Reply naturally and concisely to general questions like greetings, small talk, and simple help requests. If relevant, briefly mention that you can scrape a single school website for contacts or run the Niche schools workflow, but do not force that into every answer.',
      },
      {
        role: 'user',
        content: userQuery.trim() || 'Hello',
      },
    ],
    temperature: 0.4,
  });

  return (
    response.choices[0]?.message?.content?.trim() ||
    'Hello! I can chat normally, scrape a single school website for contacts, or run the Niche schools workflow.'
  );
}
