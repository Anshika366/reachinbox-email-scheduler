import { indexEmailDocument, searchEmailsInEs, initElasticsearchIndex } from "../apps/backend/src/services/elasticsearchService.js";
import { EmailRecord } from "../apps/backend/src/types/index.js";
import crypto from "crypto";

async function verifyElasticsearchIndexingAndSearch() {
  console.log("=== VERIFYING REAL ELASTICSEARCH INTEGRATION ===");

  await initElasticsearchIndex();

  const testEmailId = crypto.randomUUID();
  const testUserId = `usr-es-${Date.now()}`;
  const testRecord: EmailRecord = {
    id: testEmailId,
    user_id: testUserId,
    sender_id: "snd-1",
    sender_email: "oliver.brown@domain.io",
    recipient: "alex.marketing@partner.com",
    subject: "Q4 Marketing Expansion Strategy",
    body: "Here is the comprehensive proposal for Q4 regional campaigns.",
    scheduled_at: new Date(),
    status: "scheduled",
    bullmq_job_id: `email-${testEmailId}`,
    idempotency_key: null,
    min_delay_ms: 2000,
    hourly_limit: 100,
    sent_at: null,
    retry_count: 0,
    error_details: null,
    smtp_message_id: null,
    preview_url: null,
    created_at: new Date(),
    updated_at: new Date()
  };

  await indexEmailDocument(testRecord);
  console.log("Indexed email record into Elasticsearch:", testEmailId);

  const searchResult = await searchEmailsInEs(testUserId, "Expansion Strategy");
  console.log("Elasticsearch Search Result Total Hits:", searchResult.total);

  if (searchResult.total >= 1 && searchResult.hits[0].id === testEmailId) {
    console.log("PASS: Document successfully retrieved from Elasticsearch cluster:");
    console.log("Match Subject:", searchResult.hits[0].subject);
    console.log("Match Recipient:", searchResult.hits[0].recipient);
  } else {
    throw new Error("FAIL: Elasticsearch document retrieval failed");
  }
}



verifyElasticsearchIndexingAndSearch().catch((err) => {
  console.error("ELASTICSEARCH VERIFICATION ERROR:", err);
  process.exit(1);
});
