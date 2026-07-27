import { Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle } from "docx";
import { TailoredResume } from "./types";

const ptToTwips = (pt: number) => Math.round(pt * 20);
const ptToHalfPoints = (pt: number) => Math.round(pt * 2);

// Note on the "match reference style" preference: this renders a real,
// single continuous document flow (one column) regardless of the reference
// resume's own column count. A faithful sidebar/two-column reconstruction
// would need a borderless table layout, which was deliberately left out of
// this first version rather than shipping table-layout code that couldn't
// be run/verified before delivery — see the README's "Known limitations"
// section. Font, heading style, accent color, and bullet character are all
// still applied, so single-column resumes (the majority case) match closely.
export async function generateDocx(resume: TailoredResume): Promise<Buffer> {
  const font = resume.style.fontFamily === "serif" ? "Georgia" : "Calibri";
  const accent = resume.style.accentColorHex?.replace("#", "") || undefined;

  const children: Paragraph[] = [];

  // Name + contact header
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: ptToTwips(2) },
      children: [
        new TextRun({
          text: resume.contactHeader.name,
          bold: true,
          size: ptToHalfPoints(resume.style.nameFontSizePt),
          font,
          color: accent,
        }),
      ],
    })
  );
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: ptToTwips(resume.style.sectionSpacingPt) },
      children: [
        new TextRun({
          text: resume.contactHeader.contactLine,
          size: ptToHalfPoints(resume.style.bodyFontSizePt),
          font,
        }),
      ],
    })
  );

  for (const section of resume.sections) {
    children.push(headingParagraph(section.heading, resume, font, accent));

    for (const entry of section.entries) {
      const titleLine = [entry.title, entry.organization].filter(Boolean).join(" — ");
      const metaLine = [entry.location, entry.dateRange].filter(Boolean).join(" | ");

      if (titleLine || metaLine) {
        children.push(
          new Paragraph({
            spacing: { before: ptToTwips(4), after: ptToTwips(1) },
            children: [
              ...(titleLine
                ? [new TextRun({ text: titleLine, bold: true, size: ptToHalfPoints(resume.style.bodyFontSizePt), font })]
                : []),
              ...(metaLine
                ? [
                    new TextRun({
                      text: (titleLine ? "    " : "") + metaLine,
                      italics: true,
                      size: ptToHalfPoints(resume.style.bodyFontSizePt - 0.5),
                      font,
                    }),
                  ]
                : []),
            ],
          })
        );
      }

      for (const bullet of entry.bullets) {
        children.push(
          new Paragraph({
            indent: { left: ptToTwips(18) },
            spacing: { after: ptToTwips(1) },
            children: [
              new TextRun({
                text: `${resume.style.bulletChar} ${bullet}`,
                size: ptToHalfPoints(resume.style.bodyFontSizePt),
                font,
              }),
            ],
          })
        );
      }
    }

    children.push(new Paragraph({ spacing: { after: ptToTwips(resume.style.sectionSpacingPt) }, children: [] }));
  }

  const doc = new Document({
    sections: [{ properties: {}, children }],
  });

  return Packer.toBuffer(doc);
}

function headingParagraph(text: string, resume: TailoredResume, font: string, accent: string | undefined): Paragraph {
  const displayText = resume.style.headingStyle === "uppercase-bold" ? text.toUpperCase() : text;
  return new Paragraph({
    spacing: { before: ptToTwips(4), after: ptToTwips(2) },
    border:
      resume.style.headingStyle === "bold-underline"
        ? { bottom: { style: BorderStyle.SINGLE, size: 6, color: accent || "888888" } }
        : undefined,
    children: [
      new TextRun({
        text: displayText,
        bold: resume.style.headingStyle !== "small-caps-bold" ? true : undefined,
        smallCaps: resume.style.headingStyle === "small-caps-bold" ? true : undefined,
        size: ptToHalfPoints(resume.style.headingFontSizePt),
        font,
        color: accent,
      }),
    ],
  });
}
