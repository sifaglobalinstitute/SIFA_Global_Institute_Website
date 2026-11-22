// SIFA public application intake — deploy as a Supabase Edge Function.
// Required server-side secrets/config: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// SIFA_APPLICATIONS_OPEN (must be "true" to accept submissions),
// SIFA_ALLOWED_ORIGINS (comma-separated exact origins).
// Never expose SUPABASE_SERVICE_ROLE_KEY in browser files or GitHub.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const allowedOrigins = (Deno.env.get("SIFA_ALLOWED_ORIGINS") ?? "")
  .split(",").map((v) => v.trim()).filter(Boolean);
const headersBase = { "Vary": "Origin", "Content-Type": "application/json", "Cache-Control": "no-store" };

function json(status: number, body: Record<string, unknown>, origin: string | null) {
  const originAllowed = !!origin && allowedOrigins.includes(origin);
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...headersBase,
      ...(originAllowed ? { "Access-Control-Allow-Origin": origin!, "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" } : {}),
    },
  });
}

function cleanText(value: unknown, max = 500): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";
}
function validEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") {
    if (!origin || !allowedOrigins.includes(origin)) return new Response(null, { status: 403, headers: headersBase });
    return new Response(null, { status: 204, headers: {
      ...headersBase, "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    }});
  }
  if (req.method !== "POST") return json(405, { error: "Method not allowed." }, origin);
  if (!origin || !allowedOrigins.includes(origin)) return json(403, { error: "Origin not allowed." }, origin);
  if (!url || !serviceKey) return json(503, { error: "Application service is not configured." }, origin);
  if (Deno.env.get("SIFA_APPLICATIONS_OPEN") !== "true") {
    return json(403, { error: "Applications are currently closed." }, origin);
  }
  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (contentLength > 12_000_000) return json(413, { error: "Submission is too large. Please reduce the size of your attachments." }, origin);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(400, { error: "Please submit a valid form." }, origin); }
  if (JSON.stringify(body).length > 12_000_000) return json(413, { error: "Submission is too large. Please reduce the size of your attachments." }, origin);
  // Honeypot field; silently reject likely bots without exposing detection logic.
  if (cleanText(body.website, 200)) return json(200, { ok: true, message: "Submission received." }, origin);

  const fullName = cleanText(body.full_name, 160);
  const email = cleanText(body.email, 254).toLowerCase();
  const phone = cleanText(body.phone, 50);
  const country = cleanText(body.country, 100);
  const program = cleanText(body.program, 120);
  const consent = body.contact_consent === true;
  const accuracy = body.accuracy_confirmed === true;
  const allowedPrograms = (Deno.env.get("SIFA_OPEN_PROGRAMS") ?? "")
    .split(",").map((v) => v.trim()).filter(Boolean);

  if (fullName.length < 2 || !validEmail(email) || phone.length < 5 || country.length < 2 || !program) {
    return json(400, { error: "Please check your name, email, phone, country, and selected program." }, origin);
  }
  if (!consent || !accuracy) return json(400, { error: "Please confirm the accuracy of your information and consent to application-related contact." }, origin);
  if (!allowedPrograms.includes(program)) return json(400, { error: "This program is not currently accepting applications." }, origin);

  const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || (req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  const { data: rateAllowed, error: rateError } = await createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
    .rpc("sifa_allow_public_application", { p_email_hash: await sha256(email), p_ip_hash: ip ? await sha256(ip) : null });
  if (rateError) { console.error("Application rate limit check failed", { code: rateError.code }); return json(503, { error: "The application service is not ready. Please try again later." }, origin); }
  if (rateAllowed !== true) return json(429, { error: "Too many application attempts. Please wait before trying again." }, origin);

  // Keep only explicitly supported application fields. Ignore client-provided
  // IDs, status, decision fields, linked user IDs, document paths, and prices.
  const allowedPayloadKeys = [
    "mode", "cohort", "schedule", "background", "softwareExperience", "goals", "financialSupport",
    "scholarshipReason", "financialCircumstances", "scholarshipValue", "documentStatus",
    "documentIssue", "nationality", "city", "education", "status", "language",
  ];
  const payload: Record<string, string> = {};
  const suppliedPayload = body.payload && typeof body.payload === "object" && !Array.isArray(body.payload)
    ? body.payload as Record<string, unknown> : {};
  for (const key of allowedPayloadKeys) {
    const value = cleanText(suppliedPayload[key], 2000);
    if (value) payload[key] = value;
  }
  payload.name = fullName;
  payload.email = email;
  payload.phone = phone;
  payload.country = country;
  payload.course = program;
  payload.contact_consent = "true";
  payload.accuracy_confirmed = "true";

  try {
    const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const year = new Date().getUTCFullYear();
    const randomPart = crypto.randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase();
    const applicationRef = `SIFA-${year}-${randomPart}`;
    const { data, error } = await supabase.from("sifa_public_applications").insert({
      application_ref: applicationRef, full_name: fullName, email, phone, country, program, payload, status: "Submitted",
    }).select("id, application_ref, submitted_at").single();
    if (error) {
      console.error("Public application insert failed", { code: error.code, message: error.message });
      return json(500, { error: "We could not save your application. Please try again later or contact SIFA support." }, origin);
    }

    
const applicationId = data.id;

const cleanupApplication = async () => {
  const { error } = await supabase
    .from("sifa_public_applications")
    .delete()
    .eq("id", applicationId);

  if (error) {
    console.error(
      "SIFA application cleanup failed:",
      error.message
    );

    throw new Error(
      "Failed to clean up the incomplete application."
    );
  }
};if (cleanText(payload.financialSupport, 100).toLowerCase().includes("scholarship")) {
      const { error: scholarshipError } = await supabase.from("sifa_scholarship_decisions").insert({
        public_application_id: data.id, decision: "pending", monthly_discount_percent: 0,
      });
      if (scholarshipError) {
        await cleanupApplication();
        console.error("Scholarship request record failed", { code: scholarshipError.code, message: scholarshipError.message });
        return json(500, { error: "Your application could not record the financial-support request. Please try again later." }, origin);
      }
    }

    // Documents are optional. If supplied, the server validates each item and stores it in a private bucket.
    const files = Array.isArray(body.files) ? body.files : [];
    if (files.length > 8) {
      await cleanupApplication();
      return json(400, { error: "Please attach no more than eight files per submission." }, origin);
    }
    let totalBytes = 0;
    const uploadedPaths: string[] = [];
    
const cleanupUploaded = async () => {
  if (uploadedPaths.length === 0) return;

  const { error } = await supabase.storage
    .from("sifa-private-documents")
    .remove(uploadedPaths);

  if (error) {
    console.error("SIFA document cleanup failed:", error.message);
    throw new Error("Failed to clean up uploaded documents.");
  }
};

const cleanupFailedSubmission = async () => {
  // First remove uploaded files from private storage.
  try {
    await cleanupUploaded();
  } catch (error) {
    console.error(
      "SIFA document cleanup failed. Application retained for investigation.",
      error
    );

    throw new Error(
      "Could not safely remove uploaded documents."
    );
  }

  // Delete the incomplete application only after storage cleanup.
  await cleanupApplication();
};






    const allowedExt = new Set(["pdf", "jpg", "jpeg", "png", "doc", "docx"]);
    for (const entry of files) {
      if (!entry || typeof entry !== "object") continue;
      const file = entry as Record<string, unknown>;
      const name = cleanText(file.name, 180).replace(/[^a-zA-Z0-9._-]/g, "_");
      const field = cleanText(file.field, 80);
      const mime = cleanText(file.type, 100).toLowerCase();
      const base64 = typeof file.base64 === "string" ? file.base64 : "";
      const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
      if (!name || !base64 || !allowedExt.has(ext)) {
        await cleanupFailedSubmission();
        return json(400, { error: "One of the attachments has an unsupported file name or type." }, origin);
      }
      let bytes: Uint8Array;
      try { bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0)); } catch {
        await cleanupFailedSubmission();
        return json(400, { error: "One of the attachments could not be read." }, origin);
      }
      totalBytes += bytes.byteLength;
      if (bytes.byteLength < 1 || bytes.byteLength > 5 * 1024 * 1024 || totalBytes > 8 * 1024 * 1024) {
        await cleanupFailedSubmission();
        return json(413, { error: "Each attachment must be at most 5 MB and all attachments together must be at most 8 MB." }, origin);
      }
      const signature = Array.from(bytes.slice(0, 8));
      const signatureOk = (ext === "pdf" && signature[0]===37 && signature[1]===80 && signature[2]===68 && signature[3]===70)
        || ((ext === "jpg" || ext === "jpeg") && signature[0]===255 && signature[1]===216 && signature[2]===255)
        || (ext === "png" && signature.slice(0,4).join(",")==="137,80,78,71")
        || (ext === "docx" && signature[0]===80 && signature[1]===75)
        || (ext === "doc" && signature.slice(0,4).join(",")==="208,207,17,224");
      if (!signatureOk) {
        await cleanupFailedSubmission();
        return json(400, { error: `The file ${name} does not appear to match its file extension.` }, origin);
      }
      const path = `public-applications/${data.id}/${crypto.randomUUID()}-${name}`;
      const { error: uploadError } = await supabase.storage.from("sifa-private-documents").upload(path, bytes, { contentType: mime || "application/octet-stream", upsert: false });
      if (uploadError) {
        await cleanupFailedSubmission();
        console.error("Private document upload failed", { code: uploadError.name, message: uploadError.message });
        return json(500, { error: "The application could not safely store an attachment. Please try again or submit without the file." }, origin);
      }
      uploadedPaths.push(path);
      const { error: metadataError } = await supabase.from("sifa_application_documents").insert({ public_application_id: data.id, storage_bucket: "sifa-private-documents", storage_path: path, original_filename: name, content_type: mime || "application/octet-stream", byte_size: bytes.byteLength });
      
if (metadataError) {
  console.error(
    "SIFA document metadata insert failed:",
    metadataError.message
  );

  await cleanupFailedSubmission();

  return json(500, {
    error: "The application could not safely record an attachment. Please try again."
  }, origin);
}

      payload[`uploaded_${field || "document"}`] = "true";
    }
    return json(201, { ok: true, application_ref: data.application_ref, submitted_at: data.submitted_at }, origin);
  } catch (error) {
    console.error("Public application service error", error instanceof Error ? error.message : "unknown");
    return json(500, { error: "The application service is temporarily unavailable." }, origin);
  }
});
