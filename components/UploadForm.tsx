// NO LONGER USED. Replaced by the generic attach-button-in-chat flow (see
// ChatPanel.tsx's paperclip button and app/page.tsx's handleFilesSelected)
// as part of turning this app from a resume-specific two-panel upload form
// into a generic chat surface ("Personal Agentic AI Agent") — the app no
// longer imports from this file.
//
// This file previously held the two-panel upload UI: a dedicated "Reference
// resume" file picker and a "Job description" upload/paste-text toggle,
// rendered above the chat as fixed sections. That's been deleted from the
// page per request, in favor of attaching files inline next to the chat's
// Send button, so the UI doesn't visually commit to "this app is specifically
// about resumes" — the resume-tailoring capability itself is unchanged and
// still lives in lib/agent/tools.ts, just no longer scaffolded by a
// resume-shaped form.
export {};
