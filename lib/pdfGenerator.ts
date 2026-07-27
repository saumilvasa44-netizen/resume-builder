import PDFDocument from "pdfkit";
import { TailoredResume } from "./types";

// Uses pdfkit's 14 built-in standard PDF fonts only (Helvetica/Times
// families) — no custom font embedding. This is a deliberate safety choice:
// embedding an arbitrary TTF to more closely match the reference resume's
// exact typeface would need bundling font files and couldn't be verified
// end-to-end without being able to run the app in this session. Standard
// fonts render identically and reliably everywhere, which matters more for
// an ATS-facing document than an exact typeface match.
function fontFor(fontFamily: "serif" | "sans-serif", weight: "regular" | "bold" | "italic"): string {
  if (fontFamily === "serif") {
    return weight === "bold" ? "Times-Bold" : weight === "italic" ? "Times-Italic" : "Times-Roman";
  }
  return weight === "bold" ? "Helvetica-Bold" : weight === "italic" ? "Helvetica-Oblique" : "Helvetica";
}

export async function generatePdf(resume: TailoredResume): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50, size: "LETTER" });
      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const font = resume.style.fontFamily;
      const accent = resume.style.accentColorHex || "#000000";
      const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const bodySize = resume.style.bodyFontSizePt;
      const bulletIndent = doc.page.margins.left + 14;
      const bulletWidth = pageWidth - 14;

      // Name + contact line
      doc
        .font(fontFor(font, "bold"))
        .fontSize(resume.style.nameFontSizePt)
        .fillColor(accent)
        .text(resume.contactHeader.name, { align: "center" });
      doc
        .font(fontFor(font, "regular"))
        .fontSize(bodySize)
        .fillColor("black")
        .text(resume.contactHeader.contactLine, { align: "center" });
      doc.moveDown(resume.style.sectionSpacingPt / 10);

      for (const section of resume.sections) {
        renderHeading(doc, section.heading, resume, font, accent);

        for (const entry of section.entries) {
          const titleLine = [entry.title, entry.organization].filter(Boolean).join(" — ");
          const metaLine = [entry.location, entry.dateRange].filter(Boolean).join(" | ");

          if (titleLine) {
            doc.font(fontFor(font, "bold")).fontSize(bodySize).fillColor("black").text(titleLine, { continued: Boolean(metaLine) });
          }
          if (metaLine) {
            doc
              .font(fontFor(font, "italic"))
              .fontSize(Math.max(bodySize - 1, 7))
              .fillColor("#444444")
              .text(titleLine ? `    ${metaLine}` : metaLine);
          }

          for (const bullet of entry.bullets) {
            doc
              .font(fontFor(font, "regular"))
              .fontSize(bodySize)
              .fillColor("black")
              .text(`${resume.style.bulletChar}  ${bullet}`, bulletIndent, undefined, { width: bulletWidth });
          }
          doc.moveDown(0.3);
        }
        doc.moveDown(resume.style.sectionSpacingPt / 12);
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

function renderHeading(
  doc: PDFKit.PDFDocument,
  text: string,
  resume: TailoredResume,
  font: "serif" | "sans-serif",
  accent: string
): void {
  const displayText = resume.style.headingStyle === "uppercase-bold" || resume.style.headingStyle === "small-caps-bold"
    ? text.toUpperCase()
    : text;
  const size = resume.style.headingStyle === "small-caps-bold" ? resume.style.headingFontSizePt - 1 : resume.style.headingFontSizePt;

  doc.moveDown(0.4);
  doc
    .font(fontFor(font, "bold"))
    .fontSize(size)
    .fillColor(accent)
    .text(displayText, {
      underline: resume.style.headingStyle === "bold-underline",
    });
  doc.fillColor("black");
}
