// The structured shape the tailoring pipeline produces (via Gemini's
// JSON-schema-constrained output, see lib/gemini.ts) and both document generators (lib/
// docxGenerator.ts, lib/pdfGenerator.ts) render from. Keeping one shared
// schema means the docx and pdf outputs are guaranteed to represent the
// same content and style, not two independently-drifting renderings.

export type ResumeStyle = {
  // Best-effort visual read of the reference resume, not literal extracted
  // font metadata (PDFs don't reliably expose that to a text/vision model
  // the way a design tool would) — a reasoned approximation used to make
  // the output *look* like the reference, per the user's explicit
  // preference for style fidelity over stricter ATS-safe simplification.
  fontFamily: "serif" | "sans-serif";
  nameFontSizePt: number;
  headingFontSizePt: number;
  bodyFontSizePt: number;
  headingStyle: "uppercase-bold" | "bold" | "bold-underline" | "small-caps-bold";
  // Hex color for the name/heading accents if the reference resume used
  // one; null means the reference was plain black/greyscale.
  accentColorHex: string | null;
  columns: 1 | 2;
  bulletChar: "•" | "-" | "▪";
  sectionSpacingPt: number;
};

export type ResumeEntry = {
  title?: string; // job title / degree name / project name
  organization?: string; // company / school
  location?: string;
  dateRange?: string;
  bullets: string[];
};

export type ResumeSection = {
  heading: string; // taken from/matching the reference resume's own section names
  type: "summary" | "experience" | "education" | "skills" | "projects" | "certifications" | "other";
  entries: ResumeEntry[];
};

export type ChangeLogEntry = {
  section: string;
  // Human-readable description of what changed and why, referencing the JD.
  change: string;
  // The specific original resume content this change is grounded in —
  // required so a change with no real basis is structurally hard to slip
  // in unnoticed. Rendered in the UI so the user can audit every change.
  basis: string;
};

export type TailoredResume = {
  contactHeader: { name: string; contactLine: string };
  style: ResumeStyle;
  sections: ResumeSection[];
  changeLog: ChangeLogEntry[];
  // Honest summary of the tailoring strategy, INCLUDING any JD requirements
  // that could not be supported by the reference resume at all and were
  // deliberately left alone rather than forced in.
  jdAlignmentNotes: string;
};

// The normalized shape lib/jdParser.ts converts an uploaded JD file into,
// and lib/anthropic.ts sends to Claude. Lives here (not in lib/anthropic.ts)
// so lib/jdParser.ts doesn't need to import from the LLM-provider file
// itself — keeps the provider swappable without touching the parser.
export type JdInput =
  | { kind: "text"; text: string }
  | { kind: "image"; base64: string; mediaType: "image/png" | "image/jpeg" | "image/webp" }
  | { kind: "pdf"; base64: string };
