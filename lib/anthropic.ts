// NO LONGER USED. The app now calls Gemini instead of Claude (see
// lib/gemini.ts) — nothing in the app imports from this file anymore.
//
// This file previously held a working Claude implementation (same
// no-fabrication system prompt, structured output via forced tool use
// instead of Gemini's responseSchema, ANTHROPIC_API_KEY env var). Switched
// back to Gemini on request, specifically to get back to a free tier — the
// tradeoff being Google's free tier terms generally allow inputs to be used
// to improve their products, which Anthropic's paid API does not do by
// default. If that tradeoff changes, this file is where a real Claude
// implementation would go again (git history has the exact working version
// if you want to restore it rather than rebuild from scratch).
export {};
