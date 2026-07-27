# Personal Agentic AI Agent

A generic chat agent — attach files with the 📎 button next to Send and say
what you want done with them. Its first capability is resume tailoring: give
it your existing resume (PDF) and a job description (screenshot, PDF, or
.docx), then say something like "take this resume and JD and give me an
updated resume in the same format," or refine afterward with "make the
summary shorter," "remove the certifications section," etc. It reorders,
rephrases, and re-emphasizes your **real** experience to align with the JD —
it does not invent employers, titles, dates, skills, or metrics that aren't
already in your resume.

The UI itself doesn't commit to being resume-specific (no dedicated
"reference resume" / "job description" panels) — it's a single chat surface
on purpose, so more tools can be added to this same agent later without a UI
rewrite. See `lib/agent/tools.ts` for the current tool registry.

## It's an agent, not a one-shot form

Earlier versions of this app were a fixed pipeline: upload both files,
click Generate, get one result. It's now a small tool-calling agent — you
chat with it, and it decides which action to take:

- **`tailor_resume`** (`lib/agent/tools.ts`) — generates a fresh tailored
  resume from the uploaded reference resume + JD.
- **`refine_resume`** — applies one specific follow-up change to the
  existing draft ("make it shorter," "lead with the Python experience"),
  re-grounded against the original resume each time rather than editing the
  draft blindly.
- **`prepare_downloads`** — generates the `.docx`/`.pdf` files from the
  current draft; the agent calls this on its own right after tailoring or
  refining, so files are usually ready without you having to ask.

`lib/agent/loop.ts` runs the actual tool-calling loop against Gemini's
function-calling API; `lib/agent/tools.ts` is the registry. Adding a new
capability to this agent later means adding one more entry to that
registry — nothing else in the loop needs to change. (This app is still
scoped to resume tailoring specifically; the registry pattern is just built
so that doesn't require a rewrite if that changes.)

The whole thing stays **stateless server-side**, same as before: nothing is
persisted in a database. The browser holds the conversation state (chat
history, uploaded resume, current draft) and sends it back to `/api/chat`
on every message; the server does the work and hands back whatever changed.
Closing the tab loses the session — that's a deliberate privacy tradeoff,
not a bug.

## How the no-fabrication guarantee actually works

This isn't just a prompt asking the model to "not lie" — it's built into
the pipeline's structure:

- The shared rules both `tailor_resume` and `refine_resume` call into
  (`NO_FABRICATION_RULES` in `lib/gemini.ts`) explicitly forbid adding any
  employer, title, date, degree, certification, or quantified metric not
  already in the reference resume. Rephrasing to match the JD's terminology
  is allowed only when the underlying fact is unchanged.
- Every change the model makes is logged with a `basis` field — the
  specific original resume content that justifies it. If it can't point to
  a real basis, the instruction is to not make the change.
- If the JD asks for something the resume genuinely doesn't support, the
  instruction is to leave it out and say so plainly in `jdAlignmentNotes`,
  rather than force a match.
- The results panel shows the full change log and alignment notes, so you
  can audit every change yourself before using the output — this tool is a
  drafting aid, not a black box you should blindly trust.
- Refinements stay grounded too: `refine_resume` re-sends the original
  reference resume PDF and JD alongside the current draft on every
  follow-up edit, rather than just asking the model to edit JSON in
  isolation — so a chain of "make it punchier" → "add more detail" →
  "shorten again" can't gradually drift into fabricated content with
  nothing left anchoring it to the real resume.

None of this makes fabrication *impossible* (it's still an LLM), but it
makes an ungrounded change structurally visible rather than invisible.
**Always read the change log before you send a resume out.**

## Setup

```bash
npm install
cp .env.example .env.local
# Add a free Gemini API key to .env.local (get one at https://aistudio.google.com/apikey)
npm run dev
```

**Free, on Google's Gemini free tier** — no card required, roughly 1,500
requests/day on Gemini 3.5 Flash (the model this app currently uses; see
the note in `lib/gemini.ts` if it ever gets restricted from new API keys
the way `gemini-2.5-flash` was — check
[Google's models page](https://ai.google.dev/gemini-api/docs/models) for
the current free-tier-eligible model and swap the `MODEL` constant). The
tradeoff for "free": Google's free tier terms generally allow your inputs
to be used to improve their products, and your resume has real personal
details in it (name, contact info, work history). If that matters to you,
read Gemini's API terms, or switch to a paid API (e.g. Anthropic's, which
doesn't train on customer data by default) — this app has run on Claude
before (see the note left in `lib/anthropic.ts`) and can be swapped back;
the agent loop itself (`lib/agent/loop.ts`) is Gemini-function-calling-
specific though, so a provider swap would need that file reworked too, not
just `lib/gemini.ts`.

## What it does

1. Upload your reference resume (PDF only) and a job description (image
   screenshot, PDF, .docx, or pasted text — legacy .doc isn't supported for
   file upload, export/save as .docx instead or paste the text).
2. Chat with the agent. It calls `tailor_resume` the first time you ask for
   a tailored version, and `refine_resume` for any follow-up change to the
   existing draft. It also decides on its own when to call
   `prepare_downloads` so files are ready without extra prompting.
3. The JD is normalized once, on upload: images and PDFs are sent directly
   to Gemini (it reads both natively — no separate OCR step needed), and
   `.docx` is text-extracted locally first via `mammoth` since Gemini has
   no native Word-document input (`/api/parse-jd`).
4. The reference resume PDF is sent to Gemini as inline document data on
   every tailor/refine call — it reads both the text content and the
   visual layout (font style, heading treatment, column count, bullet
   style, accent color) from the same file.
5. Gemini returns a structured, tailored resume via JSON-schema-constrained
   output (not free-form text) — see `lib/types.ts`'s `TailoredResume` for
   the exact shape.
6. Both a `.docx` (editable) and a `.pdf` (fixed layout) are generated from
   that same structured result, so they're guaranteed to match each other.
7. Nothing is persisted server-side — no accounts, no database, no stored
   copies of your resume or the JD. Session state lives in the browser tab
   and is round-tripped with the server on every chat message.

The old single-shot endpoint (`/api/generate`, upload both files → one
result) still exists and works, but the UI no longer calls it — the chat
agent is the primary interface now.

## Known limitations (read before relying on this)

- **Two-column/sidebar resumes render as single-column.** Faithfully
  reconstructing a sidebar-style layout would need a table-based
  implementation that wasn't buildable-and-verifiable in the session this
  was created in (no code-execution sandbox was available to test it end
  to end) — rather than ship untested layout code, the generator falls back
  to a single, continuous column. Font, heading style, accent color, and
  bullet character are still applied. Most professional resumes are
  single-column anyway, but if yours uses a sidebar, expect the layout
  (not the content) to look different from the reference.
- **Fonts are approximated, not extracted exactly.** The output uses
  standard fonts (Calibri/Georgia in the .docx, Helvetica/Times in the PDF)
  chosen by whether the reference looked serif or sans-serif — not the
  literal embedded typeface, which isn't reliably recoverable from a PDF
  this way regardless.
- **The agent loop caps at 4 tool-call rounds per chat turn**
  (`MAX_TOOL_ROUNDS` in `lib/agent/loop.ts`) as a safety limit against a
  runaway tool-calling loop. Normal usage (tailor + prepare downloads, or
  refine + prepare downloads) uses 1-2 rounds, so this shouldn't be
  noticeable — if it ever is, the agent will say so rather than silently
  going quiet.
- **Verified: `npm install`, `tsc --noEmit`, `npm run test:pipeline`, and
  `npm run build` all pass cleanly** (last checked July 2026, including the
  new agent tool registry and its error-path handling — see
  `scripts/test-pipeline.ts`). This confirms the code compiles, the
  document-generation pipeline works, and every registered tool has a
  valid shape and fails gracefully when required context is missing. It
  does **not** confirm the Gemini API call itself produces good tailoring
  output for a real resume/JD pair, or that the full multi-turn
  function-calling loop behaves correctly end to end — that still needs a
  live run with a real API key (see "Verifying it works" below).
  `@google/genai`'s version is pinned as `"latest"` in `package.json`,
  meaning it resolves to whatever's newest at install time rather than a
  fixed version number — worth pinning to an exact version once you're
  happy with how it behaves, so a future `npm install` can't silently
  change behavior.

## Verifying it works

```bash
npm install
npm run test:pipeline   # offline — no API key needed, tests document generation + tool registry shape
npm run dev              # then try a real resume + JD + chat end to end
```

`test:pipeline` exercises the DOCX and PDF generators against a synthetic
example, checks the output files have valid signatures, and checks every
registered agent tool has the shape the loop needs and fails gracefully
(returns an error response, doesn't throw) when required context is
missing. It does **not** call the Gemini API or exercise the actual
multi-turn tool-calling conversation — that part can only really be
checked by trying it with a real API key and a real resume/JD pair.
