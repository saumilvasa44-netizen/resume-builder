// Offline sanity tests for the document-generation half of the pipeline —
// no network, no Gemini API key needed. Exercises lib/docxGenerator.ts
// and lib/pdfGenerator.ts against a synthetic TailoredResume fixture (the
// shape Gemini's JSON-schema-constrained response would normally produce)
// to catch obvious breakage (wrong library API usage, crashes, malformed
// output) without needing a live API call. Run via: npm run test:pipeline
import { generateDocx } from "../lib/docxGenerator";
import { generatePdf } from "../lib/pdfGenerator";
import { TailoredResume } from "../lib/types";
import { AGENT_TOOLS } from "../lib/agent/tools";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`ok:   ${msg}`);
  }
}

const sample: TailoredResume = {
  contactHeader: {
    name: "Jordan Rivera",
    contactLine: "jordan.rivera@email.com | +1 555 010 2020 | San Francisco, CA | linkedin.com/in/jordanrivera",
  },
  style: {
    fontFamily: "sans-serif",
    nameFontSizePt: 20,
    headingFontSizePt: 12,
    bodyFontSizePt: 10,
    headingStyle: "uppercase-bold",
    accentColorHex: "#1F4E79",
    columns: 1,
    bulletChar: "•",
    sectionSpacingPt: 8,
  },
  sections: [
    {
      heading: "Summary",
      type: "summary",
      entries: [{ bullets: ["Backend engineer with 6 years building high-throughput payment systems."] }],
    },
    {
      heading: "Professional Experience",
      type: "experience",
      entries: [
        {
          title: "Senior Software Engineer",
          organization: "Acme Corp",
          location: "Remote",
          dateRange: "2021 - Present",
          bullets: [
            "Led migration of the payments service from a monolith to 6 microservices, cutting p99 latency by 40%.",
            "Mentored 3 junior engineers through their first on-call rotations.",
          ],
        },
      ],
    },
    {
      heading: "Skills",
      type: "skills",
      entries: [{ bullets: ["Python, Go, PostgreSQL, Kafka, AWS, Docker, Kubernetes"] }],
    },
  ],
  changeLog: [
    {
      section: "Professional Experience",
      change: "Reworded 'split the monolith into services' to 'migration...to 6 microservices' to mirror the JD's emphasis on microservices architecture.",
      basis: "Original resume: 'Helped split the monolith into 6 separate services.'",
    },
  ],
  jdAlignmentNotes:
    "The JD asks for Kubernetes production experience; the reference resume only lists Kubernetes as a skill with no production-scale bullet to back it up, so no such claim was added — left as a skill listing only.",
};

async function main() {
  const docxBuffer = await generateDocx(sample);
  assert(docxBuffer.length > 0, "generateDocx produces a non-empty buffer");
  assert(
    docxBuffer.subarray(0, 2).toString("hex") === "504b",
    "generateDocx output starts with the ZIP signature 'PK' (a .docx is a zip archive)"
  );

  const pdfBuffer = await generatePdf(sample);
  assert(pdfBuffer.length > 0, "generatePdf produces a non-empty buffer");
  assert(pdfBuffer.subarray(0, 5).toString("ascii") === "%PDF-", "generatePdf output starts with the '%PDF-' signature");

  // Agent tool registry sanity — no network, just checks the shape every
  // tool needs to be usable by lib/agent/loop.ts (a typo'd/missing field
  // here would silently break Gemini's function-calling, or make a tool
  // uncallable, without a live agent conversation to notice it).
  assert(AGENT_TOOLS.length >= 3, `at least 3 agent tools are registered (found ${AGENT_TOOLS.length})`);
  const names = new Set<string>();
  for (const tool of AGENT_TOOLS) {
    assert(Boolean(tool.name), `tool has a non-empty name (${tool.name || "<empty>"})`);
    assert(!names.has(tool.name), `tool name "${tool.name}" is unique among registered tools`);
    names.add(tool.name);
    assert(Boolean(tool.description), `tool "${tool.name}" has a non-empty description`);
    assert(
      typeof tool.parametersJsonSchema === "object" && tool.parametersJsonSchema !== null,
      `tool "${tool.name}" has a parametersJsonSchema object`
    );
    assert(typeof tool.execute === "function", `tool "${tool.name}" has an execute function`);
  }
  assert(names.has("tailor_resume"), "tailor_resume is registered");
  assert(names.has("refine_resume"), "refine_resume is registered");
  assert(names.has("prepare_downloads"), "prepare_downloads is registered");
  assert(names.has("draft_recruiter_message"), "draft_recruiter_message is registered");

  // Tools should fail gracefully (an error response for the model to relay,
  // not a thrown exception) when required context is missing — this is what
  // lets the agent explain "you haven't uploaded X yet" instead of the whole
  // turn crashing. Checked here without a live Gemini call since these
  // early-return branches don't need one.
  const tailorTool = AGENT_TOOLS.find((t) => t.name === "tailor_resume")!;
  const missingContextResult = await tailorTool.execute({}, { resumeBase64: null, jd: null, currentResume: null });
  assert(
    typeof missingContextResult.responseForModel.error === "string",
    "tailor_resume returns an error response (not a thrown exception) when resume/JD are missing"
  );

  const refineTool = AGENT_TOOLS.find((t) => t.name === "refine_resume")!;
  const refineNoResumeResult = await refineTool.execute(
    { instructions: "shorten it" },
    { resumeBase64: null, jd: null, currentResume: null }
  );
  assert(
    typeof refineNoResumeResult.responseForModel.error === "string",
    "refine_resume returns an error response when no current draft exists yet"
  );

  const downloadsTool = AGENT_TOOLS.find((t) => t.name === "prepare_downloads")!;
  const downloadsNoResumeResult = await downloadsTool.execute({}, { resumeBase64: null, jd: null, currentResume: null });
  assert(
    typeof downloadsNoResumeResult.responseForModel.error === "string",
    "prepare_downloads returns an error response when no current draft exists yet"
  );

  // prepare_downloads with a real draft present should actually produce
  // files, exercising the same generateDocx/generatePdf path tested above
  // but through the tool interface the agent actually calls.
  const downloadsWithResumeResult = await downloadsTool.execute({}, { resumeBase64: null, jd: null, currentResume: sample });
  assert(Boolean(downloadsWithResumeResult.files?.docxBase64), "prepare_downloads produces a docx file when a draft exists");
  assert(Boolean(downloadsWithResumeResult.files?.pdfBase64), "prepare_downloads produces a pdf file when a draft exists");

  const recruiterMessageTool = AGENT_TOOLS.find((t) => t.name === "draft_recruiter_message")!;
  const recruiterMessageNoContextResult = await recruiterMessageTool.execute(
    {},
    { resumeBase64: null, jd: null, currentResume: null }
  );
  assert(
    typeof recruiterMessageNoContextResult.responseForModel.error === "string",
    "draft_recruiter_message returns an error response when resume/JD are missing"
  );

  console.log(`\n${failures === 0 ? "All tests passed." : `${failures} test(s) failed.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Pipeline test crashed:", err);
  process.exit(1);
});
