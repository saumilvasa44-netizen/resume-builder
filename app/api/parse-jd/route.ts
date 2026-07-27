import { NextRequest, NextResponse } from "next/server";
import { parseJdFile } from "@/lib/jdParser";

export const runtime = "nodejs"; // needs Buffer, mammoth — not edge-compatible
export const dynamic = "force-dynamic";

// Small dedicated endpoint so the chat UI can normalize a JD file upload
// (screenshot/PDF/.docx) into a JdInput client-side, WITHOUT going through
// the full agent turn — the resume PDF is base64-encoded directly in the
// browser (no server round trip needed for that), but .docx text
// extraction needs `mammoth`, which is Node-only, hence this route.
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const jdFile = form.get("jd");
    if (!(jdFile instanceof File)) {
      return NextResponse.json({ error: "Missing job description file." }, { status: 400 });
    }
    const buffer = Buffer.from(await jdFile.arrayBuffer());
    const jd = await parseJdFile(buffer, jdFile.name, jdFile.type);
    return NextResponse.json({ jd });
  } catch (err: any) {
    return NextResponse.json({ error: String(err?.message ?? err) }, { status: 500 });
  }
}
