import type { Content, Part } from "@google/genai";
import { generateWithFallback, getClient } from "../gemini";
import { JdInput, TailoredResume } from "../types";
import { AGENT_TOOLS, ToolContext } from "./tools";

// Kept short and focused on ORCHESTRATION, not the tailoring rules
// themselves — the no-fabrication rules live once, in lib/gemini.ts's
// NO_FABRICATION_RULES, shared by the tools this agent calls. This prompt's
// job is just to make the model reach for the right tool and never claim to
// have done work it didn't actually do.
const AGENT_SYSTEM_INSTRUCTION = `You are a general-purpose personal AI assistant. Answer ordinary questions and have normal conversation exactly as any capable assistant would — small talk, factual questions, math, advice, whatever the person asks. You are NOT required to relate every reply back to resumes, job descriptions, or file uploads, and you should not volunteer or pivot to that topic unless the person actually brings it up.

You also have specific tools for tasks around a resume and a job description (JD), for when the person actually asks for one of these (e.g. "tailor my resume to this JD," "take this resume and JD and give me an updated resume," "write a message to the recruiter for this role"):
- tailor_resume: produces a brand-new tailored resume from an attached reference resume + job description.
- refine_resume: applies one specific follow-up change to the existing tailored draft (including a preview shown to the person — see rule 7).
- prepare_downloads: generates .docx/.pdf files from the current draft.
- draft_recruiter_message: writes a short outreach message/note to a recruiter or hiring manager about the JD's role, personalized from the resume. This is independent of the tailored-resume draft — it doesn't touch it or need one to exist.

Rules for these tools specifically (irrelevant to any other kind of message):
1. Only reach for these tools, and only mention resumes/job descriptions/attachments, when the person is actually asking for one of these tasks — never tack a resume-related suggestion onto the end of an unrelated reply.
2. You must call a tool to actually perform tailoring, refining, drafting a message, or file generation — you never claim to have done one of these in your reply text unless you actually called the corresponding tool THIS turn and it succeeded.
3. If the person asks for one of these but hasn't attached both a reference resume and a job description yet, tell them so plainly and ask them to attach what's missing — do not call a tool that needs them without both being available (each tool will also refuse and say what's missing, but check first to avoid a wasted call).
4. After a successful tailor_resume or refine_resume call, call prepare_downloads in the same turn so the files are ready immediately, unless the person's message makes clear they don't want the files yet (e.g. they're still previewing and plan to ask for more changes).
5. If a tool call returns an error, explain the actual problem to the person in plain language (e.g. "you haven't attached a job description yet") rather than a generic failure message.
6. When you do work on a resume, keep replies conversational and concise, and briefly summarize what changed and mention anything from the job description the original resume doesn't support (the tool's response includes this) — you don't need to re-paste the whole resume in the chat, since the person can already see the current draft in the results panel below the chat.
7. The person can keep asking for more changes after seeing a draft ("make it shorter," "align it more directly with the JD," "add X, I've actually done that — put it under Skills") — treat each of these as a refine_resume call against the SAME draft, not a new tailor_resume from scratch, unless they clearly want to start over. When they indicate they're done and want the file ("now download it," "give me the file," "that's good, export it"), call prepare_downloads so the download buttons reflect the latest edits.
8. draft_recruiter_message returns the message as plain text in the tool's response — put that FULL text directly in your reply to the person (don't summarize or paraphrase it, that defeats the point), then briefly ask if they'd like it adjusted (tone, length, a different channel like email vs. LinkedIn).`;

const TOOL_DECLARATIONS = AGENT_TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  parametersJsonSchema: t.parametersJsonSchema,
}));

// Hard cap on how many tool-call rounds a single chat turn can take before
// forcing a stop — protects against a pathological loop where the model
// keeps calling tools without ever producing a final text reply. Three
// rounds comfortably covers the real pattern (e.g. tailor_resume then
// prepare_downloads is two calls in one round already, since Gemini can
// return multiple function calls in a single response).
const MAX_TOOL_ROUNDS = 4;

export type AgentTurnResult = {
  reply: string;
  history: Content[];
  currentResume: TailoredResume | null;
  files: { docxBase64: string; pdfBase64: string } | null;
  toolCalls: string[];
};

export async function runAgentTurn(params: {
  userMessage: string;
  history: Content[];
  resumeBase64: string | null;
  jd: JdInput | null;
  currentResume: TailoredResume | null;
}): Promise<AgentTurnResult> {
  const client = getClient();
  const contents: Content[] = [...params.history, { role: "user", parts: [{ text: params.userMessage }] }];

  let currentResume = params.currentResume;
  let files: { docxBase64: string; pdfBase64: string } | null = null;
  const toolCalls: string[] = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await generateWithFallback((model) =>
      client.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction: AGENT_SYSTEM_INSTRUCTION,
          tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
        },
      })
    );

    // Gemini 3's function-call parts each carry a `thoughtSignature` field
    // (a sibling of `functionCall` on the Part, not a field on FunctionCall
    // itself) that MUST be echoed back verbatim on the next request, or the
    // API rejects it with a 400 "Function call is missing a
    // thought_signature" error. response.functionCalls only exposes bare
    // FunctionCall objects (name/args/id) with no thoughtSignature, so
    // reconstructing parts as `{ functionCall: c }` silently drops it —
    // reuse the real parts straight from the candidate instead, for both
    // the function-call branch and the final-text branch below.
    const candidateContent = response.candidates?.[0]?.content;
    const calls = response.functionCalls;
    if (!calls || calls.length === 0) {
      const text = response.text ?? "";
      contents.push(candidateContent ?? { role: "model", parts: [{ text }] });
      return { reply: text, history: contents, currentResume, files, toolCalls };
    }

    // Echo the model's function-call turn back into history — required by
    // the API so the subsequent functionResponse turn has something to
    // respond to.
    contents.push(candidateContent ?? { role: "model", parts: calls.map((c): Part => ({ functionCall: c })) });

    const responseParts: Part[] = [];
    const ctx: ToolContext = { resumeBase64: params.resumeBase64, jd: params.jd, currentResume };
    for (const call of calls) {
      const name = call.name ?? "";
      toolCalls.push(name);
      const tool = AGENT_TOOLS.find((t) => t.name === name);
      if (!tool) {
        responseParts.push({ functionResponse: { name, response: { error: `Unknown tool "${name}".` } } });
        continue;
      }
      try {
        const result = await tool.execute(call.args ?? {}, ctx);
        if (result.updatedResume) {
          currentResume = result.updatedResume;
          ctx.currentResume = result.updatedResume; // so a later call in the same round sees the fresh draft
        }
        if (result.files) files = result.files;
        responseParts.push({ functionResponse: { name, response: result.responseForModel } });
      } catch (err: any) {
        responseParts.push({
          functionResponse: { name, response: { error: String(err?.message ?? err) } },
        });
      }
    }

    // Gemini's Content.role only accepts "user" or "model" (no separate
    // "tool"/"function" role) — function responses are sent back as a
    // "user"-role turn, per the API's own convention.
    contents.push({ role: "user", parts: responseParts });
  }

  // Hit MAX_TOOL_ROUNDS without a final text reply — surface something
  // honest rather than silently returning nothing.
  const fallback =
    "I made some tool calls but didn't manage to wrap up with a clear reply — try asking again, maybe more specifically.";
  contents.push({ role: "model", parts: [{ text: fallback }] });
  return { reply: fallback, history: contents, currentResume, files, toolCalls };
}
