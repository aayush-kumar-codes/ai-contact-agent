import 'dotenv/config';
import { enrollContactsInWorkflow } from './src/email-automation.js';
import { uploadContactsToHubSpot } from './src/hubspot.js';

/**
 * Test script for workflow enrollment
 * This will:
 * 1. Upload test contacts to HubSpot
 * 2. Enroll them in the specified workflow
 */

async function testWorkflowEnrollment() {
  console.log('🧪 Testing Workflow Enrollment\n');
  console.log('='.repeat(50));

  // Check required environment variables
  if (!process.env.HUBSPOT_ACCESS_TOKEN) {
    console.error('❌ Error: HUBSPOT_ACCESS_TOKEN is not set in .env file');
    return;
  }

  if (!process.env.HUBSPOT_WORKFLOW_ID) {
    console.error('❌ Error: HUBSPOT_WORKFLOW_ID is not set in .env file');
    console.log('\nTo set it up:');
    console.log('1. Go to HubSpot → Automation → Workflows');
    console.log('2. Create a new contact-based workflow');
    console.log('3. Add email actions to your workflow');
    console.log('4. Publish the workflow');
    console.log('5. Copy the workflow ID from the URL');
    console.log('6. Add HUBSPOT_WORKFLOW_ID=your_id to your .env file');
    return;
  }

  console.log('✅ Environment variables found');
  console.log(`   Access Token: ${process.env.HUBSPOT_ACCESS_TOKEN.substring(0, 10)}...`);
  console.log(`   Workflow ID: ${process.env.HUBSPOT_WORKFLOW_ID}\n`);

  // Test contacts - REPLACE WITH YOUR TEST EMAIL
  const testContacts = [
    {
      firstName: 'Test',
      lastName: 'Contact',
      email: 'your-test-email@example.com', // CHANGE THIS TO YOUR EMAIL
      jobTitle: 'Director of Student Services',
      phone: '555-0100',
      schoolName: 'Test School',
      schoolDomain: 'testschool.edu',
      schoolPhone: '555-0199',
      schoolState: 'CA',
    },
  ];

  console.log('⚠️  IMPORTANT: Make sure to update the test email in test-workflow.js');
  console.log(`   Current test email: ${testContacts[0].email}\n`);

  try {
    // Step 1: Upload contacts to HubSpot
    console.log('📍 Step 1: Uploading test contacts to HubSpot...\n');
    const uploadResults = await uploadContactsToHubSpot(testContacts);

    if (uploadResults.success.length === 0) {
      console.error('\n❌ Failed to upload contacts to HubSpot');
      console.error('   Cannot proceed with workflow enrollment');
      if (uploadResults.failed.length > 0) {
        console.error('\n   Errors:');
        uploadResults.failed.forEach(f => {
          console.error(`   - ${f.email}: ${f.error}`);
        });
      }
      return;
    }

    console.log('\n✅ Contacts uploaded successfully');

    // Step 2: Enroll in workflow
    console.log('\n📍 Step 2: Enrolling contacts in workflow...\n');
    const workflowResults = await enrollContactsInWorkflow(
      testContacts,
      process.env.HUBSPOT_WORKFLOW_ID,
      process.env.HUBSPOT_ACCESS_TOKEN,
      {
        delayBetweenContacts: 200,
        onProgress: (progress) => {
          const percentage = ((progress.processed / progress.total) * 100).toFixed(1);
          console.log(
            `   Progress: ${progress.processed}/${progress.total} (${percentage}%) - Success: ${progress.success}, Failed: ${progress.failed}`
          );
        },
      }
    );

    // Summary
    console.log('\n' + '='.repeat(50));
    console.log('🎉 Test Complete!\n');
    console.log('Upload Results:');
    console.log(`   ✅ Successful: ${uploadResults.success.length}`);
    console.log(`   ❌ Failed: ${uploadResults.failed.length}`);
    console.log('\nWorkflow Enrollment Results:');
    console.log(`   ✅ Enrolled: ${workflowResults.success.length}`);
    console.log(`   ❌ Failed: ${workflowResults.failed.length}`);

    if (workflowResults.success.length > 0) {
      console.log('\n✅ Success! Check your HubSpot workflow to see the enrolled contacts.');
      console.log('   Go to: Automation → Workflows → Your Workflow → Enrolled tab');
    }

    if (workflowResults.failed.length > 0) {
      console.log('\n❌ Some enrollments failed:');
      workflowResults.failed.forEach(f => {
        console.log(`   - ${f.email}: ${f.error}`);
      });
      console.log('\nCommon issues:');
      console.log('   - Workflow is not published');
      console.log('   - Workflow ID is incorrect');
      console.log('   - Access token missing "automation" scope');
      console.log('   - Contact already enrolled in workflow');
    }

    console.log('='.repeat(50));
  } catch (error) {
    console.error('\n❌ Test failed with error:', error.message);
    if (error.code === 401 || error.statusCode === 401) {
      console.error('\n   → Check your HUBSPOT_ACCESS_TOKEN');
    } else if (error.code === 403 || error.statusCode === 403) {
      console.error('\n   → Token missing required permissions');
      console.error('   → Go to Settings → Private Apps → Edit your app');
      console.error('   → Add "automation" scope and regenerate token');
    }
  }
}

// Run the test
testWorkflowEnrollment();
