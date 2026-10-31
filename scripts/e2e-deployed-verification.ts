import axios from "axios";

const BASE_URL = "https://reachinbox-email-scheduler-csri.onrender.com/api";

async function verifyDeployedFlow() {
  console.log("==================================================================");
  console.log("   LIVE DEPLOYED ENVIRONMENT ETHEREAL PREVIEW VERIFICATION TEST   ");
  console.log("==================================================================");

  // 1. Authenticate with live deployed backend
  console.log("\n1. Authenticating as user on live deployed backend...");
  const testEmail = `preview.verifier.${Date.now()}@domain.org`;
  const testPassword = "VerifierSecure2026!";

  const client = axios.create({
    baseURL: BASE_URL,
    withCredentials: true,
    headers: { "Content-Type": "application/json" }
  });

  const loginRes = await client.post("/auth/login", {
    email: testEmail,
    password: testPassword
  });

  console.log("Auth Status:", loginRes.status, loginRes.data);
  const cookie = loginRes.headers["set-cookie"] || [];
  const sessionCookie = cookie.map((c: string) => c.split(";")[0]).join("; ");
  console.log("Obtained Session Cookie:", sessionCookie ? "YES" : "NO");

  // 2. Fetch authenticated user profile and sender identity
  console.log("\n2. Fetching current user identity & senders...");
  const meRes = await client.get("/auth/me", {
    headers: { Cookie: sessionCookie }
  });
  console.log("User:", meRes.data.user.email, "| Sender ID:", meRes.data.senders[0]?.id);
  const sender = meRes.data.senders[0];
  if (!sender) {
    throw new Error("FAIL: No sender found for user");
  }

  // 3. Schedule a new email scheduled for immediate delivery (within 2 seconds)
  console.log("\n3. Scheduling an email via live API...");
  const emailSubject = `LIVE PREVIEW TEST ${new Date().toISOString()}`;
  const emailBody = `<p>This is a live end-to-end verification email scheduled at ${new Date().toISOString()}.</p><p>Verifying exact message-specific Ethereal preview link.</p>`;

  const scheduleRes = await client.post(
    "/emails/schedule",
    {
      senderId: sender.id,
      recipients: ["client.partner@company.com"],
      subject: emailSubject,
      body: emailBody,
      scheduledAt: new Date(Date.now() + 2000).toISOString(),
      minDelayMs: 2000,
      hourlyLimit: 100
    },
    {
      headers: { Cookie: sessionCookie }
    }
  );

  console.log("Schedule Response:", scheduleRes.data);
  const emailId = scheduleRes.data.emailIds?.[0];
  if (!emailId) {
    throw new Error("FAIL: Email scheduling did not return email record");
  }
  console.log("Created Email ID:", emailId);

  // 4. Wait for background dispatcher to deliver the email (poll /api/emails/sent)
  console.log("\n4. Waiting for live dispatcher to deliver email and capture preview URL...");
  let sentRecord: any = null;

  for (let attempt = 1; attempt <= 20; attempt++) {
    await new Promise((r) => setTimeout(r, 4000));
    const sentRes = await client.get("/emails/sent", {
      headers: { Cookie: sessionCookie }
    });

    const found = sentRes.data.emails?.find((e: any) => e.id === emailId);
    if (found && found.status === "sent") {
      sentRecord = found;
      console.log(`Delivered on attempt ${attempt}! Status: ${found.status}`);
      break;
    } else {
      console.log(`Attempt ${attempt}: Email status is ${found ? found.status : "pending/scheduled"}...`);
    }
  }

  if (!sentRecord) {
    throw new Error("FAIL: Scheduled email was not delivered within expected time");
  }

  // 5. Inspect the preview_url saved in the database and returned to the frontend
  console.log("\n5. Inspecting preview URL returned by API:");
  console.log("   - Status:", sentRecord.status);
  console.log("   - SMTP Message ID:", sentRecord.smtp_message_id);
  console.log("   - Saved Preview URL:", sentRecord.preview_url);

  if (!sentRecord.preview_url) {
    throw new Error("FAIL: preview_url is missing or false");
  }

  if (sentRecord.preview_url === "https://ethereal.email/messages" || sentRecord.preview_url === "https://ethereal.email/login") {
    throw new Error("FAIL: preview_url was replaced by generic Ethereal URL!");
  }

  if (!sentRecord.preview_url.includes("https://ethereal.email/message/")) {
    throw new Error("FAIL: preview_url does not match exact message pattern (https://ethereal.email/message/...)");
  }

  // 6. Test opening the message-specific preview URL without any login
  console.log("\n6. Verifying that the Ethereal preview URL renders without login...");
  const previewPageRes = await axios.get(sentRecord.preview_url);
  const previewHtml = previewPageRes.data;

  console.log("   - HTTP Status:", previewPageRes.status);
  console.log("   - Response Length:", previewHtml.length, "bytes");

  const isLoginPage = previewHtml.includes("<title>Log in | Ethereal Email</title>") || previewHtml.includes('action="/login"');
  if (isLoginPage) {
    throw new Error("FAIL: Ethereal preview URL redirected to Login page!");
  }

  const containsSubject = previewHtml.includes(emailSubject) || previewHtml.includes("LIVE PREVIEW TEST");
  console.log("   - Requires Login?:", isLoginPage ? "YES (FAIL)" : "NO (PASS)");
  console.log("   - Contains Email Subject?:", containsSubject ? "YES (PASS)" : "NO");

  console.log("\n==================================================================");
  console.log("   COMPLETE FLOW VERIFIED IN DEPLOYED ENVIRONMENT SUCCESSFULLY!   ");
  console.log("==================================================================");
}

verifyDeployedFlow().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
