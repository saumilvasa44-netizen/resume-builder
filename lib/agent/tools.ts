// The agent's tool registry. Each tool is a self-contained unit: a name/
// description/parameter schema Gemini uses to decide when and how to call
// it, plus an `execute` function that actually does the work. Adding a new
// task to this agent later means appending a new AgentTool to AGENT_TOOLS —
// nothing else in lib/agent/loop.ts needs to change to support it.
//
// Tools don't mutate shared state — each execute() call receives a
// read-only ToolContext and returns whatever changed (updatedResume, files)
// as part of its result. This keeps the whole agent stateless server-side,
// consistent with the rest of this app: the caller (app/api/chat/route.ts)
// is responsible for round-tripping context with the client on every
// request, not this file.
import { draftRecruiterMessage, refineResume, tailorResume } from "../gemini";
import { generateDocx } from "../docxGenerator";
import { generatePdf } from "../pdfGenerator";
import { JdInput, TailoredResume } from "../types";

export type ToolContext = {
  resumeBase64: string | null;
  jd: JdInput | null;
  currentResume: TailoredResume | null;
};

export type ToolResult = {
  // Sent back to Gemini as the FunctionResponse.response — deliberately a
  // compact summary rather than the full TailoredResume JSON (which can be
  // several KB), so a multi-turn conversation's history doesn't balloon in
  // size every time a tool runs.
  responseForModel: Record<string, unknown>;
  updatedResume?: TailoredResume;
  files?: { docxBase64: string; pdfBase64: string };
};

export type AgentTool = {
  name: string;
  description: string;
  parametersJsonSchema: Record<string, unknown>;
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
};

function summarizeResume(resume: TailoredResume): Record<string, unknown> {
  return {
    success: true,
    contactName: resume.contactHeader.name,
    sections: resume.sections.map((s) => s.heading),
    changeCount: resume.changeLog.length,
    jdAlignmentNotes: resume.jdAlignmentNotes,
  };
}

function stringArg(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  return typeof v === "string" ? v : "";
}

export const AGENT_TOOLS: AgentTool[] = [
  {
    name: "tailor_resume",
    description:
      "Generate a brand-new tailored resume from the uploaded reference resume and job description. Call this the first time the user asks to tailor/generate their resume, or if they explicitly want to start over from scratch. Requires both a resume and a job description to already be uploaded.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        focusInstructions: {
          type: "string",
          description:
            "Any specific emphasis the user asked for (e.g. 'emphasize my leadership experience', 'keep it to one page'). Pass through what the user actually said, in their own words — empty string if they gave no specific instructions beyond a general request to tailor the resume.",
        },
      },
      required: [],
    },
    execute: async (args, ctx) => {
      if (!ctx.resumeBase64 || !ctx.jd) {
        return {
          responseForModel: {
            error:
              "No reference resume and/or job description has been uploaded yet. Tell the user which of the two is still missing and ask them to upload it before you can tailor anything.",
          },
        };
      }
      const resume = await tailorResume(ctx.resumeBase64, ctx.jd, stringArg(args, "focusInstructions"));
      return { responseForModel: summarizeResume(resume), updatedResume: resume };
    },
  },
  {
    name: "refine_resume",
    description:
      "Apply one specific follow-up change to the CURRENT tailored resume draft (e.g. 'make the summary shorter', 'remove the certifications section', 'lead with the Python experience'). Requires a tailored resume to already exist — if none exists yet, call tailor_resume first instead of this.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        instructions: {
          type: "string",
          description: "The specific change to make, restated clearly from what the user asked for.",
        },
      },
      required: ["instructions"],
    },
    execute: async (args, ctx) => {
      if (!ctx.currentResume) {
        return {
          responseForModel: {
            error: "No tailored resume exists yet in this conversation — call tailor_resume first, not refine_resume.",
          },
        };
      }
      if (!ctx.resumeBase64 || !ctx.jd) {
        return {
          responseForModel: {
            error:
              "The original reference resume/job description are no longer available in this session, so a refinement can't be safely grounded. Ask the user to re-upload both.",
          },
        };
      }
      const instructions = stringArg(args, "instructions");
      if (!instructions) {
        return { responseForModel: { error: "No refinement instructions were provided." } };
      }
      const resume = await refineResume(ctx.resumeBase64, ctx.jd, ctx.currentResume, instructions);
      return { responseForModel: summarizeResume(resume), updatedResume: resume };
    },
  },
  {
    name: "prepare_downloads",
    description:
      "Generate downloadable .docx and .pdf files from the current tailored resume draft. Call this whenever the user asks to download or export the resume, and also proactively right after tailor_resume or refine_resume produces a new draft, so the files are ready without the user having to ask separately.",
    parametersJsonSchema: { type: "object", properties: {}, required: [] },
    execute: async (_args, ctx) => {
      if (!ctx.currentResume) {
        return {
          responseForModel: {
            error: "No tailored resume exists yet — call tailor_resume (and/or refine_resume) before preparing downloads.",
          },
        };
      }
      const [docxBuffer, pdfBuffer] = await Promise.all([
        generateDocx(ctx.currentResume),
        generatePdf(ctx.currentResume),
      ]);
      return {
        responseForModel: { success: true, docxReady: true, pdfReady: true },
        files: { docxBase64: docxBuffer.toString("base64"), pdfBase64: pdfBuffer.toString("base64") },
      };
    },
  },
  {
    name: "draft_recruiter_message",
    description:
      "Draft a short outreach message/note to a recruiter or hiring manager about the role in the attached job description, personalized using the person's real resume (e.g. 'write a message to the recruiter for this role', 'draft an email about this JD'). Returns message text only — this doesn't touch the tailored resume draft or generate any files. Requires both a resume and a job description to already be attached.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        focusInstructions: {
          type: "string",
          description:
            "Any specific guidance the person gave (tone, length, channel — e.g. 'as a LinkedIn message', 'keep it under 80 words', 'mention I'm open to relocating'). Empty string if they gave no specific guidance beyond the general request.",
        },
      },
      required: [],
    },
    execute: async (args, ctx) => {
      if (!ctx.resumeBase64 || !ctx.jd) {
        return {
          responseForModel: {
            error:
              "No reference resume and/or job description has been attached yet. Tell the user which of the two is still missing and ask them to attach it before you can draft a recruiter message.",
          },
        };
      }
      const message = await draftRecruiterMessage(ctx.resumeBase64, ctx.jd, stringArg(args, "focusInstructions"));
      return { responseForModel: { success: true, message } };
    },
  },
];
