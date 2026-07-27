import { NextRequest, NextResponse } from "next/server";
import { tailorResume } from "@/lib/gemini";
import { parseJdFile } from "@/lib/jdParser";
import { generateDocx } from "@/lib/docxGenerator";
import { generatePdf } from "@/lib/pdfGenerator";

export const runtime = "nodejs"; // needs Buffer, pdfkit, mammoth — not edge-compatible
export const dynamic = "force-dynamic";
export const maxDuration = 60; // the Gemini call + both document builds can take a bit

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const resumeFile = form.get("resume");
    const jdFile = form.get("jd");

    if (!(resumeFile instanceof File)) {
      return NextResponse.json({ error: "Missing reference resume file." }, { status: 400 });
    }
    if (!(jdFile instanceof File)) {
      return NextResponse.json({ error: "Missing job description file." }, { status: 400 });
    }

    const resumeIsPdf = resumeFile.type === "application/pdf" || resumeFile.name.toLowerCase().endsWith(".pdf");
    if (!resumeIsPdf) {
      return NextResponse.json({ error: "Reference resume must be a PDF." }, { status: 400 });
    }

    const resumeBuffer = Buffer.from(await resumeFile.arrayBuffer());
    const jdBuffer = Buffer.from(await jdFile.arrayBuffer());

    const jdInput = await parseJdFile(jdBuffer, jdFile.name, jdFile.type);
    const tailored = await tailorResume(resumeBuffer.toString("base64"), jdInput);

    const [docxBuffer, pdfBuffer] = await Promise.all([generateDocx(tailored), generatePdf(tailored)]);

    // Stateless by design: nothing is written to disk. The tailored resume,
    // change log, and both documents are returned in one response for the
    // client to render/download directly — no history, no accounts, no
    // stored copies of anyone's resume or JD.
    return NextResponse.json({
      resume: tailored,
      docxBase64: docxBuffer.toString("base64"),
      pdfBase64: pdfBuffer.toString("base64"),
    });
  } catch (err: any) {
    console.error("Resume generation failed:", err);
    return NextResponse.json({ error: String(err?.message ?? err) }, { status: 500 });
  }
}
