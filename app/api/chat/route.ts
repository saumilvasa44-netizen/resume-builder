import { NextRequest, NextResponse } from "next/server";
import type { Content } from "@google/genai";
import { runAgentTurn } from "@/lib/agent/loop";
import { JdInput, TailoredResume } from "@/lib/types";

export const runtime = "nodejs"; // the tools this route drives need Buffer/pdfkit/mammoth — not edge-compatible
export const dynamic = "force-dynamic";
export const maxDuration = 60; // a turn can involve multiple Gemini calls (tool-calling round + tailor/refine + downloads)

type ChatRequestBody = {
  message: string;
  history: Content[];
  resumeBase64: string | null;
  jd: JdInput | null;
  currentResume: TailoredResume | null;
};

// Stateless by design, same as the rest of this app: nothing is persisted
// server-side between requests. The client is responsible for sending back
// `history`/`resumeBase64`/`jd`/`currentResume` on every turn — this route
// (and lib/agent/loop.ts) just replays that context through Gemini and
// returns whatever changed.
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<ChatRequestBody>;

    if (!body.message || typeof body.message !== "string") {
      return NextResponse.json({ error: "Missing chat message." }, { status: 400 });
    }

    const result = await runAgentTurn({
      userMessage: body.message,
      history: Array.isArray(body.history) ? body.history : [],
      resumeBase64: body.resumeBase64 ?? null,
      jd: body.jd ?? null,
      currentResume: body.currentResume ?? null,
    });

    return NextResponse.json(result);
  } catch (err: any) {
    console.error("Agent chat turn failed:", err);
    return NextResponse.json({ error: String(err?.message ?? err) }, { status: 500 });
  }
}
