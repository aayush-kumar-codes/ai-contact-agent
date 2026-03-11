import 'dotenv/config';
import { routeAndRun } from './src/router.js';

function getOptionsFromEnv() {
  return {
    maxSchools: parseInt(process.env.MAX_SCHOOLS || '10', 10),
    sequenceId: process.env.SEQUENCE_ID || 271391533,
    userId: process.env.USER_ID || 67233230,
    senderEmail: process.env.SENDER_EMAIL || 'fernandezjamiep@gmail.com',
  };
}

const query = process.argv[2];
if (!query) {
  console.log('Usage: node cli.js "your query"');
  console.log('Example: node cli.js "scrape contacts from https://example-school.edu"');
  console.log('Example: node cli.js "run niche" or node cli.js "https://example-school.edu"');
  process.exit(1);
}

routeAndRun(query, getOptionsFromEnv())
  .then((out) => {
    if (!out.ok) {
      console.log('\n[Router]', out.message || 'Say "niche" / "run niche" or provide a single website URL.');
      process.exitCode = 1;
      return;
    }
    if (out.result) {
      console.log('\n[Router] Intent:', out.intent, '– Result: contacts:', out.result.contacts?.length ?? 0, ', CSV:', out.result.csvPath ?? '');
    }
  })
  .catch((err) => {
    console.error('[Router] Error:', err.message);
    process.exit(1);
  });
