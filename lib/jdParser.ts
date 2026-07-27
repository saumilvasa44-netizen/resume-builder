import mammoth from "mammoth";
import { JdInput } from "./types";

const SUPPORTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);

// Normalizes whatever JD file the user uploaded (screenshot, PDF, or Word
// doc) into the JdInput shape lib/anthropic.ts sends to Claude. Images and
// PDFs are passed through as-is — Claude reads both natively (vision for
// images, native document understanding for PDF), so there's no need for a
// separate OCR step for those. Only .docx needs local text extraction
// first, since Claude has no native Word-document content type.
export async function parseJdFile(buffer: Buffer, filename: string, mimeType: string): Promise<JdInput> {
  const lowerName = filename.toLowerCase();

  const isDocx =
    mimeType.includes("wordprocessingml") ||
    lowerName.endsWith(".docx") ||
    mimeType === "application/msword" ||
    lowerName.endsWith(".doc");

  if (isDocx) {
    if (lowerName.endsWith(".doc") && !lowerName.endsWith(".docx")) {
      throw new Error(
        "Legacy .doc files aren't supported for the JD upload — please save/export it as .docx, .pdf, or a screenshot image instead."
      );
    }
    const { value: text } = await mammoth.extractRawText({ buffer });
    if (!text.trim()) {
      throw new Error("Couldn't extract any text from the JD Word document — it may be empty or image-based.");
    }
    return { kind: "text", text };
  }

  if (mimeType === "application/pdf" || lowerName.endsWith(".pdf")) {
    return { kind: "pdf", base64: buffer.toString("base64") };
  }

  if (SUPPORTED_IMAGE_TYPES.has(mimeType) || /\.(png|jpe?g|webp)$/.test(lowerName)) {
    const mediaType = mimeType === "image/jpg" ? "image/jpeg" : (mimeType as "image/png" | "image/jpeg" | "image/webp");
    return { kind: "image", base64: buffer.toString("base64"), mediaType: SUPPORTED_IMAGE_TYPES.has(mimeType) ? mediaType : inferImageMediaType(lowerName) };
  }

  throw new Error(
    `Unsupported JD file type "${mimeType || "unknown"}" for "${filename}". Upload a screenshot (PNG/JPEG/WebP), a PDF, or a .docx file.`
  );
}

function inferImageMediaType(lowerName: string): "image/png" | "image/jpeg" | "image/webp" {
  if (lowerName.endsWith(".png")) return "image/png";
  if (lowerName.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}
