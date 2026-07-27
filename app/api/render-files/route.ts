import { NextRequest, NextResponse } from "next/server";
import { generateDocx } from "@/lib/docxGenerator";
import { generatePdf } from "@/lib/pdfGenerator";
import { TailoredResume } from "@/lib/types";

export const runtime = "nodejs"; // needs Buffer/pdfkit — not edge-compatible
export const dynamic = "force-dynamic";

// A plain, non-agentic endpoint: regenerates .docx/.pdf directly from
// whatever TailoredResume JSON the client currently has, with no Gemini call
// involved. This is what the preview panel's manual editor calls after the
// person directly edits text in the preview (name, bullets, etc.) — those
// edits don't need any AI reasoning, just re-running the same deterministic
// generateDocx/generatePdf functions the agent's own prepare_downloads tool
// uses (lib/agent/tools.ts), so a hand-edit and an AI-driven edit produce
// files the same way.
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { resume?: TailoredResume };
    if (!body.resume) {
      return NextResponse.json({ error: "Missing resume." }, { status: 400 });
    }
    const [docxBuffer, pdfBuffer] = await Promise.all([
      generateDocx(body.resume),
      generatePdf(body.resume),
    ]);
    return NextResponse.json({
      docxBase64: docxBuffer.toString("base64"),
      pdfBase64: pdfBuffer.toString("base64"),
    });
  } catch (err: any) {
    return NextResponse.json({ error: String(err?.message ?? err) }, { status: 500 });
  }
}
