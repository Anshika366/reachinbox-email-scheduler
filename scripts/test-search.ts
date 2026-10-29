import { query } from "../apps/backend/src/db/index.js";

async function testSearch() {
  const searchTerm = "Quarterly Strategy";
  const sql = `SELECT * FROM emails WHERE subject ILIKE $1 OR body ILIKE $1`;
  const res = await query(sql, [`%${searchTerm}%`]);

  if (res.rows.length > 0) {
    console.log("PASS: Email search query matched actual records:", res.rows[0].subject);
  } else {
    throw new Error("FAIL: Email search test failed");
  }
  process.exit(0);
}

testSearch().catch((err) => {
  console.error(err);
  process.exit(1);
});
