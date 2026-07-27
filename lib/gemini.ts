import { ApiError, GoogleGenAI } from "@google/genai";
import { JdInput, TailoredResume } from "./types";

// Model on Gemini's free tier. Originally pinned to "gemini-2.5-flash", but
// Google restricted that model from new API keys/projects sometime before
// July 2026 (a live call returned "This model models/gemini-2.5-flash is no
// longer available to new users" — 404 NOT_FOUND — despite gemini-2.5-flash
// still being listed as a "stable" model on Google's own docs page; the
// restriction is specifically about which models a *new* project can start
// using, not a blanket shutdown). Updated to Gemini 3.5 Flash, which is
// current-generation stable and free-tier eligible as of July 2026 (roughly
// 1,500 requests/day on the free tier per Google's published limits at the
// time). Google's free-tier model lineup shifts over time — if this 404s
// again later, check https://ai.google.dev/gemini-api/docs/models for the
// current stable + free-tier-eligible model and swap the string here;
// nothing else in this file needs to change.
export const MODEL = "gemini-3.5-flash";

// gemini-3.5-flash's free tier has a confirmed, semi-chronic capacity problem
// (not a one-off) — Google's own developer forum and GitHub issues describe
// recurring/sustained 503 "high demand" errors on this model's free-tier
// pool specifically, since the shared free pool is first to saturate at peak
// load (paid tiers get priority and see 429s instead, not 503s). A short
// retry-with-backoff on the SAME model (see withGeminiRetry below) isn't
// enough on its own when the model is down for an extended stretch, so these
// two are tried next, in order, if gemini-3.5-flash's own retries are
// exhausted — both current-generation, free-tier-eligible per
// https://ai.google.dev/gemini-api/docs/models as of July 2026. Falling back
// to a *different* model's capacity pool, rather than just retrying the same
// overloaded one, is what actually resolves a sustained outage instead of
// just spacing out the same failure.
const FALLBACK_MODELS = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"];
const ALL_MODELS = [MODEL, ...FALLBACK_MODELS];

// Exported (not just used internally) so lib/agent/loop.ts can share the
// exact same client/model setup for the agentic chat loop, rather than
// duplicating the API-key check and GoogleGenAI construction in two places.
export function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not set. Copy .env.example to .env.local and add a free key from https://aistudio.google.com/apikey."
    );
  }
  return new GoogleGenAI({ apiKey });
}

// Gemini's free tier regularly returns 503 UNAVAILABLE ("This model is
// currently experiencing high demand ... temporary") and occasionally 429
// RESOURCE_EXHAUSTED under load — both are genuinely transient, not a bug
// on this app's end, and both go away on their own within seconds most of
// the time. Rather than surface that straight to the user as an error every
// time (which was happening often enough in practice to be the actual
// friction point, not any code issue), every generateContent call in this
// file — and lib/agent/loop.ts's own call, which imports this — goes
// through this retry wrapper first: a short exponential backoff, only for
// these two specific retryable status codes, capped at a few attempts so a
// genuinely broken key/request still fails promptly instead of hanging.
const RETRYABLE_STATUS_CODES = new Set([503, 429]);
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withGeminiRetry<T>(call: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await call();
    } catch (err) {
      lastErr = err;
      const retryable = err instanceof ApiError && RETRYABLE_STATUS_CODES.has(err.status);
      if (!retryable || attempt === MAX_RETRIES) throw err;
      await sleep(BASE_DELAY_MS * 2 ** attempt); // 1s, 2s, 4s
    }
  }
  throw lastErr; // unreachable, but keeps TypeScript happy about the return type
}

// Wraps withGeminiRetry with model fallback: retries the primary model
// (MODEL) with backoff first, and only moves on to the next candidate in
// ALL_MODELS once that model's own retries are exhausted with a retryable
// (503/429) error — i.e. this model's capacity pool, specifically, looks
// down right now, not just one unlucky request. `buildCall` takes the model
// name being attempted so callers can plug it into their generateContent
// request. Every tailor/refine/agent-loop call site should go through this
// instead of calling withGeminiRetry directly against a hardcoded MODEL, so
// a sustained outage on one model doesn't surface as a hard failure to the
// user when a different free-tier model is available and working.
export async function generateWithFallback<T>(buildCall: (model: string) => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < ALL_MODELS.length; i++) {
    const model = ALL_MODELS[i];
    try {
      return await withGeminiRetry(() => buildCall(model));
    } catch (err) {
      lastErr = err;
      const retryable = err instanceof ApiError && RETRYABLE_STATUS_CODES.has(err.status);
      if (!retryable || i === ALL_MODELS.length - 1) throw err;
      // else: this model's retries are exhausted but it's a 503/429 —
      // fall through to the next candidate model.
    }
  }
  throw lastErr; // unreachable, but keeps TypeScript happy about the return type
}

// Gemini's structured-output schema is an OpenAPI-3.0 subset, not raw JSON
// Schema — notably, a nullable field is expressed as `{type: "string",
// nullable: true}` rather than JSON Schema's `type: ["string", "null"]`.
// Mirrors lib/types.ts's TailoredResume exactly; if you change one, change
// the other.
const TAILORED_RESUME_SCHEMA = {
  type: "object",
  properties: {
    contactHeader: {
      type: "object",
      properties: {
        name: { type: "string" },
        contactLine: {
          type: "string",
          description:
            "e.g. 'email | phone | city | linkedin.com/in/...' — copy verbatim from the reference resume, never invent contact details",
        },
      },
      required: ["name", "contactLine"],
    },
    style: {
      type: "object",
      properties: {
        fontFamily: { type: "string", enum: ["serif", "sans-serif"] },
        nameFontSizePt: { type: "number" },
        headingFontSizePt: { type: "number" },
        bodyFontSizePt: { type: "number" },
        headingStyle: { type: "string", enum: ["uppercase-bold", "bold", "bold-underline", "small-caps-bold"] },
        accentColorHex: {
          type: "string",
          nullable: true,
          description: "e.g. '#1F4E79', or null if the reference is plain black/greyscale",
        },
        // Gemini's structured-output API only supports `enum` on
        // `type: "string"` schema fields — a `type: "number", enum: [1, 2]`
        // field (this app's original form) is rejected outright with a
        // confusing "Invalid value ... (TYPE_STRING)" 400 error, since
        // Gemini validates enum entries as strings regardless of the
        // declared type. Declared as a string enum here and parsed back to
        // a number in parseTailoredResumeJson below, to satisfy the API
        // while keeping TailoredResume.style.columns as the numeric `1 | 2`
        // type the rest of the app (docxGenerator.ts, pdfGenerator.ts)
        // expects.
        columns: { type: "string", enum: ["1", "2"] },
        bulletChar: { type: "string", enum: ["•", "-", "▪"] },
        sectionSpacingPt: { type: "number" },
      },
      required: [
        "fontFamily",
        "nameFontSizePt",
        "headingFontSizePt",
        "bodyFontSizePt",
        "headingStyle",
        "accentColorHex",
        "columns",
        "bulletChar",
        "sectionSpacingPt",
      ],
    },
    sections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          heading: { type: "string" },
          type: {
            type: "string",
            enum: ["summary", "experience", "education", "skills", "projects", "certifications", "other"],
          },
          entries: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                organization: { type: "string" },
                location: { type: "string" },
                dateRange: { type: "string" },
                bullets: { type: "array", items: { type: "string" } },
              },
              required: ["bullets"],
            },
          },
        },
        required: ["heading", "type", "entries"],
      },
    },
    changeLog: {
      type: "array",
      items: {
        type: "object",
        properties: {
          section: { type: "string" },
          change: { type: "string" },
          basis: {
            type: "string",
            description:
              "Quote or closely paraphrase the specific original resume content that justifies this change. If you cannot point to one, do not make the change.",
          },
        },
        required: ["section", "change", "basis"],
      },
    },
    jdAlignmentNotes: {
      type: "string",
      description:
        "Honest summary of the tailoring strategy, including any JD requirements that the reference resume simply doesn't support and were deliberately left out rather than fabricated.",
    },
  },
  required: ["contactHeader", "style", "sections", "changeLog", "jdAlignmentNotes"],
};

// Shared between the initial tailoring pass and every later refinement —
// factored out so the two system instructions below (TAILOR_SYSTEM_INSTRUCTION,
// REFINE_SYSTEM_INSTRUCTION) can't drift apart on the one rule that actually
// matters: never fabricate.
const NO_FABRICATION_RULES = `You must NEVER invent experience. This is the most important rule and overrides every other consideration, including how well the resume matches the JD.

STRICT RULES:
1. Every employer name, job title, date range, degree, certification, and quantified metric (numbers, percentages, dollar amounts, team sizes, etc.) in your output MUST come directly from the reference resume. Do not add, change, or infer any of these values.
2. You may rephrase bullet points to use terminology from the JD ONLY when the underlying fact is already true in the reference resume (e.g. if the resume says "used Python for automation" and the JD wants "Python scripting", rephrasing to match the JD's phrasing is fine, since the fact is unchanged). You may NOT add a skill, tool, methodology, or responsibility that does not appear anywhere in the reference resume, even if the JD explicitly asks for it.
3. You may reorder bullet points, entries, and sections, and choose which existing bullets to lead with, based on relevance to the JD.
4. You may tighten, shorten, or clarify wording, but must not change the substance of any claim.
5. If the JD requires something the reference resume genuinely does not support, do NOT force it in. Leave it out, and say so plainly in jdAlignmentNotes — an honest gap is far better than a fabricated match.
6. For every meaningful change you make versus the original resume (reordering a bullet to the top, rephrasing to match JD terminology, cutting something less relevant), log it in changeLog with a "basis" that quotes or closely paraphrases the specific original content that justifies it. If you can't point to a real basis, don't make the change.
7. Read the reference resume's actual section names and order (e.g. "Professional Experience" vs "Work History", "Skills" vs "Technical Skills") and preserve them rather than substituting generic labels, unless a section is genuinely absent from the reference.
8. EXCEPTION to rule 1/2: if the person explicitly tells you, in their own words in this conversation, that a specific skill, tool, or fact about their background is true and asks you to add it (e.g. "I've used Kubernetes in production, add it under Skills" or a plain "add it" in direct response to you naming what would be added), you may add it — their own explicit statement about their own background is a valid basis, since the reference resume isn't necessarily a complete record of everything they've done. You must NOT add it on your own initiative just because the JD wants it — only when the person actually states it. Log it in changeLog with a basis like "Added per the person's explicit statement in this conversation, not present in the original resume" (paraphrase what they said) so it stays clearly distinguishable from resume-backed content and fully auditable — never blend it in as if the reference resume already supported it.`;

const TAILOR_SYSTEM_INSTRUCTION = `You are an expert resume writer and ATS (Applicant Tracking System) specialist. You will be given a person's REFERENCE RESUME (their real, existing resume, as a PDF) and a JOB DESCRIPTION (JD) for a role they want to apply to. Your job is to produce a tailored version of their resume that emphasizes, reorders, and rephrases their REAL, EXISTING experience to align with the JD.

${NO_FABRICATION_RULES}

You will also visually examine the reference resume PDF and infer its style — font style (serif/sans-serif), relative heading/body sizes, whether headings are bold/uppercase/underlined, any accent color used for the name or headings, single vs two column layout, and bullet character — so the tailored output can match that same visual style as closely as possible.

Respond ONLY with a JSON object matching the required schema. Do not include any commentary outside the JSON.`;

const REFINE_SYSTEM_INSTRUCTION = `You are an expert resume writer refining a resume you previously tailored, based on specific follow-up feedback. You will be given the person's REFERENCE RESUME (PDF), the JOB DESCRIPTION, the CURRENT TAILORED DRAFT (JSON), and a REFINEMENT INSTRUCTION describing what to change.

${NO_FABRICATION_RULES}

Apply the requested refinement faithfully, but don't otherwise rewrite unrelated parts of the draft the instruction didn't ask about — this is a targeted edit, not a full regeneration. Keep grounding every fact in the original reference resume, UNLESS the refinement instruction itself is the person explicitly telling you a new fact about their own background (see rule 8 above) — that's the one case where the refinement instruction is allowed to introduce something not already in the reference resume, precisely because the person just vouched for it themselves.

Respond ONLY with a JSON object matching the required schema — the FULL resume, including your requested change applied. Do not include any commentary outside the JSON.`;

function buildJdParts(jd: JdInput) {
  return jd.kind === "text"
    ? [{ text: `JOB DESCRIPTION (extracted from a Word document):\n\n${jd.text}` }]
    : jd.kind === "image"
    ? [
        { text: "JOB DESCRIPTION (screenshot/image, read the text from it):" },
        { inlineData: { mimeType: jd.mediaType, data: jd.base64 } },
      ]
    : [
        { text: "JOB DESCRIPTION (PDF):" },
        { inlineData: { mimeType: "application/pdf", data: jd.base64 } },
      ];
}

function parseTailoredResumeJson(text: string, sourceLabel: string): TailoredResume {
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `${sourceLabel}'s response wasn't valid JSON despite responseSchema being set (${String(err)}). Raw response started with: ${text.slice(0, 200)}`
    );
  }

  // columns comes back as the string "1" or "2" (see TAILORED_RESUME_SCHEMA's
  // comment on why it's declared as a string enum) — convert it back to the
  // numeric 1 | 2 the rest of the app expects.
  if (parsed?.style && typeof parsed.style.columns === "string") {
    parsed.style.columns = parseInt(parsed.style.columns, 10);
  }

  return parsed as TailoredResume;
}

export async function tailorResume(
  resumePdfBase64: string,
  jd: JdInput,
  focusInstructions?: string
): Promise<TailoredResume> {
  const client = getClient();

  const focusPart = focusInstructions?.trim()
    ? [{ text: `SPECIFIC EMPHASIS REQUESTED BY THE USER: ${focusInstructions.trim()}` }]
    : [];

  const response = await generateWithFallback((model) =>
    client.models.generateContent({
      model,
      contents: [
        {
          role: "user",
          parts: [
            { text: "REFERENCE RESUME (the person's real, existing resume):" },
            { inlineData: { mimeType: "application/pdf", data: resumePdfBase64 } },
            ...buildJdParts(jd),
            ...focusPart,
          ],
        },
      ],
      config: {
        systemInstruction: TAILOR_SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: TAILORED_RESUME_SCHEMA as any,
      },
    })
  );

  const text = response.text;
  if (!text) {
    throw new Error("Gemini returned an empty response — no tailored resume JSON to parse.");
  }
  return parseTailoredResumeJson(text, "Gemini");
}

// Applies a targeted follow-up change to an already-tailored resume, still
// grounded against the original reference resume/JD (not just editing the
// draft blindly) — see lib/agent/tools.ts's refine_resume tool, which is
// what actually calls this from the chat agent.
export async function refineResume(
  resumePdfBase64: string,
  jd: JdInput,
  currentResume: TailoredResume,
  instructions: string
): Promise<TailoredResume> {
  const client = getClient();

  const response = await generateWithFallback((model) =>
    client.models.generateContent({
      model,
      contents: [
        {
          role: "user",
          parts: [
            { text: "REFERENCE RESUME (the person's real, existing resume):" },
            { inlineData: { mimeType: "application/pdf", data: resumePdfBase64 } },
            ...buildJdParts(jd),
            { text: `CURRENT TAILORED DRAFT (JSON):\n${JSON.stringify(currentResume)}` },
            { text: `REFINEMENT INSTRUCTION: ${instructions}` },
          ],
        },
      ],
      config: {
        systemInstruction: REFINE_SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: TAILORED_RESUME_SCHEMA as any,
      },
    })
  );

  const text = response.text;
  if (!text) {
    throw new Error("Gemini returned an empty response — no refined resume JSON to parse.");
  }
  return parseTailoredResumeJson(text, "Gemini");
}

// A second, smaller capability alongside resume tailoring: drafting a short
// outreach message to a recruiter/hiring manager about the role in the
// attached JD, personalized against the person's real background. Unlike
// tailorResume/refineResume this returns plain text, not a structured
// TailoredResume — there's no responseSchema here, just a free-form message
// meant to be read directly in the chat (see lib/agent/tools.ts's
// draft_recruiter_message tool, which is what calls this).
const RECRUITER_MESSAGE_SYSTEM_INSTRUCTION = `You are an expert career coach writing a short outreach message from a job candidate to a recruiter or hiring manager, about a specific role. You will be given the person's REFERENCE RESUME (their real, existing resume, as a PDF) and a JOB DESCRIPTION (JD) for the role they want to reach out about.

${NO_FABRICATION_RULES}

Write a concise, warm, professional message (roughly 100-180 words unless the person asked for a different length) that: briefly introduces the person, names the specific role from the JD, and connects 2-3 of their REAL, EXISTING skills or experiences (from the reference resume) to what the JD is asking for. It should read like a genuine human note, not a form letter — avoid generic filler phrases like "I am excited to apply" repeated without substance.

If the person gave additional instructions (tone, what to emphasize, channel — e.g. "as a LinkedIn message" vs "as an email"), follow those. Respond with ONLY the message text itself — no preamble, no "Here's a message:", no commentary, no markdown formatting, no subject line unless they asked for an email specifically (in which case a "Subject: ..." first line is fine).`;

export async function draftRecruiterMessage(
  resumePdfBase64: string,
  jd: JdInput,
  focusInstructions?: string
): Promise<string> {
  const client = getClient();

  const focusPart = focusInstructions?.trim()
    ? [{ text: `ADDITIONAL INSTRUCTIONS FROM THE PERSON: ${focusInstructions.trim()}` }]
    : [];

  const response = await generateWithFallback((model) =>
    client.models.generateContent({
      model,
      contents: [
        {
          role: "user",
          parts: [
            { text: "REFERENCE RESUME (the person's real, existing resume):" },
            { inlineData: { mimeType: "application/pdf", data: resumePdfBase64 } },
            ...buildJdParts(jd),
            ...focusPart,
          ],
        },
      ],
      config: { systemInstruction: RECRUITER_MESSAGE_SYSTEM_INSTRUCTION },
    })
  );

  const text = response.text;
  if (!text) {
    throw new Error("Gemini returned an empty response — no recruiter message to show.");
  }
  return text.trim();
}
