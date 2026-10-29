import { Client } from "@elastic/elasticsearch";
import { config } from "../config/index.js";
import { EmailRecord } from "../types/index.js";

const INDEX_NAME = "emails";

export const esClient = new Client({
  node: config.elasticsearchUrl
});

export async function initElasticsearchIndex(): Promise<void> {
  try {
    const exists = await esClient.indices.exists({ index: INDEX_NAME });
    if (!exists) {
      await esClient.indices.create({
        index: INDEX_NAME,
        mappings: {
          properties: {
            id: { type: "keyword" },
            userId: { type: "keyword" },
            senderId: { type: "keyword" },
            senderEmail: { type: "text", fields: { keyword: { type: "keyword" } } },
            recipient: { type: "text", fields: { keyword: { type: "keyword" } } },
            subject: { type: "text" },
            body: { type: "text" },
            status: { type: "keyword" },
            scheduledAt: { type: "date" },
            sentAt: { type: "date" },
            createdAt: { type: "date" }
          }
        }
      });
    }
  } catch (err: any) {
    console.warn("Elasticsearch index initialization notice:", err?.message || err);
  }
}

export async function indexEmailDocument(email: EmailRecord): Promise<void> {
  try {
    await esClient.index({
      index: INDEX_NAME,
      id: email.id,
      document: {
        id: email.id,
        userId: email.user_id,
        senderId: email.sender_id,
        senderEmail: email.sender_email,
        recipient: email.recipient,
        subject: email.subject,
        body: email.body,
        status: email.status,
        scheduledAt: email.scheduled_at,
        sentAt: email.sent_at,
        createdAt: email.created_at
      }
    });
  } catch (err: any) {
    console.warn("Elasticsearch indexing fallback notice for email:", email.id, err?.message || err);
  }
}

export async function updateEmailDocumentStatus(
  emailId: string,
  status: string,
  sentAt?: Date | null
): Promise<void> {
  try {
    await esClient.update({
      index: INDEX_NAME,
      id: emailId,
      doc: {
        status,
        sentAt: sentAt || null
      }
    });
  } catch (err: any) {
    console.warn("Elasticsearch status update notice for email:", emailId, err?.message || err);
  }
}

export async function searchEmailsInEs(
  userId: string,
  searchTerm?: string,
  status?: string,
  from: number = 0,
  size: number = 50
): Promise<{ total: number; hits: any[] }> {
  try {
    const mustQueries: any[] = [{ term: { userId } }];

    if (status) {
      mustQueries.push({ term: { status } });
    }

    if (searchTerm && searchTerm.trim() !== "") {
      mustQueries.push({
        multi_match: {
          query: searchTerm,
          fields: ["recipient^3", "subject^2", "body", "senderEmail"]
        }
      });
    }

    const response = await esClient.search({
      index: INDEX_NAME,
      from,
      size,
      query: {
        bool: {
          must: mustQueries
        }
      },
      sort: [{ createdAt: { order: "desc" } }]
    });

    const total =
      typeof response.hits.total === "number"
        ? response.hits.total
        : response.hits.total?.value || 0;

    const hits = response.hits.hits.map((h) => h._source);

    return { total, hits };
  } catch (err: any) {
    console.warn("Elasticsearch search notice, falling back to database:", err?.message || err);
    return { total: 0, hits: [] };
  }
}

export async function checkElasticsearchConnection(): Promise<boolean> {
  try {
    return await esClient.ping();
  } catch {
    return false;
  }
}
