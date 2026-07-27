"use client";

import { useState } from "react";
import { TailoredResume } from "@/lib/types";

function downloadBase64(base64: string, filename: string, mimeType: string) {
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  const blob = new Blob([arr], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const inputCls =
  "w-full text-sm rounded-md border border-border px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-accent";

export default function ResultPanel({
  resume,
  docxBase64,
  pdfBase64,
  onReset,
  onResumeChange,
  onFilesReady,
}: {
  resume: TailoredResume;
  docxBase64: string | null;
  pdfBase64: string | null;
  onReset: () => void;
  // Called with a full, updated TailoredResume whenever the person directly
  // edits something in the preview below (not through chat). The parent
  // (app/page.tsx) owns the resume state — this component is a controlled
  // editor over the `resume` prop, so a manual edit and a chat-driven
  // refine_resume both flow through the same single source of truth.
  onResumeChange: (updated: TailoredResume) => void;
  // Called once the person clicks "Update files" after editing and the
  // server (app/api/render-files — a plain non-agentic route, no Gemini
  // call needed to re-render a docx/pdf from JSON that's already fully
  // formed) finishes regenerating the .docx/.pdf from the edited draft.
  onFilesReady: (files: { docxBase64: string; pdfBase64: string }) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);

  const baseName = resume.contactHeader.name.trim().replace(/\s+/g, "_") || "resume";
  const filesReady = Boolean(docxBase64 && pdfBase64);

  // Every edit clones the current resume, applies one small mutation, and
  // hands the whole thing back up — simplest way to keep this a controlled
  // component without a separate local copy that could drift from what the
  // rest of the app (chat, downloads) thinks the current draft is.
  function withDraft(mutate: (draft: TailoredResume) => void) {
    const draft: TailoredResume = JSON.parse(JSON.stringify(resume));
    mutate(draft);
    onResumeChange(draft);
  }

  const regenerateFiles = async () => {
    setRegenerating(true);
    setRegenError(null);
    try {
      const res = await fetch("/api/render-files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resume }),
      });
      const json = await res.json();
      if (!res.ok) {
        setRegenError(json.error ?? "Couldn't regenerate the files.");
        return;
      }
      onFilesReady({ docxBase64: json.docxBase64, pdfBase64: json.pdfBase64 });
    } catch (err: any) {
      setRegenError(String(err?.message ?? err));
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Tailored resume draft</h2>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setEditing((e) => !e)}
            className="px-3 py-2 rounded-lg border border-border text-sm text-muted hover:text-gray-900 transition"
          >
            {editing ? "Done editing" : "Edit"}
          </button>
          <button
            disabled={!filesReady}
            onClick={() =>
              docxBase64 &&
              downloadBase64(
                docxBase64,
                `${baseName}_tailored.docx`,
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              )
            }
            className="px-4 py-2 rounded-lg bg-accent hover:bg-accent2 text-white text-sm font-medium transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Download .docx
          </button>
          <button
            disabled={!filesReady}
            onClick={() => pdfBase64 && downloadBase64(pdfBase64, `${baseName}_tailored.pdf`, "application/pdf")}
            className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-900 text-white text-sm font-medium transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Download .pdf
          </button>
          <button onClick={onReset} className="px-4 py-2 rounded-lg border border-border text-sm text-muted hover:text-gray-900 transition">
            Start over
          </button>
        </div>
      </div>

      {!filesReady && (
        <div className="flex items-center gap-3 -mt-3">
          <p className="text-xs text-muted">
            Files aren't ready yet — ask the chat to "prepare the download," or click below.
          </p>
          <button
            onClick={regenerateFiles}
            disabled={regenerating}
            className="text-xs px-2.5 py-1 rounded-full border border-border text-muted hover:text-gray-900 transition disabled:opacity-50"
          >
            {regenerating ? "Preparing…" : "Update files"}
          </button>
        </div>
      )}
      {regenError && <p className="text-xs text-red-600 -mt-3">{regenError}</p>}

      {editing && (
        <p className="text-xs text-muted bg-gray-50 border border-border rounded-lg px-3 py-2">
          Editing directly. Files above go out of date the moment you change something — click "Update files" (or
          ask the chat) once you're happy with your edits.
        </p>
      )}

      {resume.jdAlignmentNotes && (
        <div className="bg-panel border border-border rounded-xl p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">
            Alignment summary (including honest gaps)
          </div>
          <p className="text-sm whitespace-pre-line">{resume.jdAlignmentNotes}</p>
        </div>
      )}

      <div className="bg-panel border border-border rounded-xl p-6">
        {editing ? (
          <div className="space-y-1 mb-4">
            <input
              value={resume.contactHeader.name}
              onChange={(e) => withDraft((d) => (d.contactHeader.name = e.target.value))}
              className={`${inputCls} text-center text-lg font-bold`}
              placeholder="Name"
            />
            <input
              value={resume.contactHeader.contactLine}
              onChange={(e) => withDraft((d) => (d.contactHeader.contactLine = e.target.value))}
              className={`${inputCls} text-center text-sm`}
              placeholder="email | phone | city | linkedin.com/in/..."
            />
          </div>
        ) : (
          <>
            <h3 className="text-xl font-bold text-center">{resume.contactHeader.name}</h3>
            <p className="text-sm text-muted text-center mb-4">{resume.contactHeader.contactLine}</p>
          </>
        )}

        {resume.sections.map((section, i) => (
          <div key={i} className="mb-4">
            {editing ? (
              <div className="flex items-center gap-2 border-b border-border pb-1 mb-2">
                <input
                  value={section.heading}
                  onChange={(e) => withDraft((d) => (d.sections[i].heading = e.target.value))}
                  className={`${inputCls} font-bold uppercase tracking-wide flex-1`}
                />
                <button
                  onClick={() => withDraft((d) => d.sections.splice(i, 1))}
                  className="text-xs text-red-600 hover:text-red-800 shrink-0"
                >
                  Remove section
                </button>
              </div>
            ) : (
              <div className="text-sm font-bold uppercase tracking-wide border-b border-border pb-1 mb-2">
                {section.heading}
              </div>
            )}

            {section.entries.map((entry, j) => (
              <div key={j} className="mb-2">
                {editing ? (
                  <div className="space-y-1 mb-1 bg-gray-50 rounded-lg p-2">
                    <div className="grid grid-cols-2 gap-1">
                      <input
                        value={entry.title ?? ""}
                        onChange={(e) => withDraft((d) => (d.sections[i].entries[j].title = e.target.value))}
                        className={inputCls}
                        placeholder="Title"
                      />
                      <input
                        value={entry.organization ?? ""}
                        onChange={(e) => withDraft((d) => (d.sections[i].entries[j].organization = e.target.value))}
                        className={inputCls}
                        placeholder="Organization"
                      />
                      <input
                        value={entry.location ?? ""}
                        onChange={(e) => withDraft((d) => (d.sections[i].entries[j].location = e.target.value))}
                        className={inputCls}
                        placeholder="Location"
                      />
                      <input
                        value={entry.dateRange ?? ""}
                        onChange={(e) => withDraft((d) => (d.sections[i].entries[j].dateRange = e.target.value))}
                        className={inputCls}
                        placeholder="Date range"
                      />
                    </div>
                    <div className="space-y-1">
                      {entry.bullets.map((b, k) => (
                        <div key={k} className="flex items-start gap-1">
                          <span className="text-sm mt-1.5">{resume.style.bulletChar}</span>
                          <input
                            value={b}
                            onChange={(e) =>
                              withDraft((d) => (d.sections[i].entries[j].bullets[k] = e.target.value))
                            }
                            className={inputCls}
                          />
                          <button
                            onClick={() => withDraft((d) => d.sections[i].entries[j].bullets.splice(k, 1))}
                            className="text-muted hover:text-red-600 text-xs mt-1.5 shrink-0"
                            aria-label="Remove bullet"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={() => withDraft((d) => d.sections[i].entries[j].bullets.push(""))}
                        className="text-xs text-accent hover:text-accent2"
                      >
                        + Add bullet
                      </button>
                    </div>
                    <button
                      onClick={() => withDraft((d) => d.sections[i].entries.splice(j, 1))}
                      className="text-xs text-red-600 hover:text-red-800"
                    >
                      Remove entry
                    </button>
                  </div>
                ) : (
                  <>
                    {(entry.title || entry.organization) && (
                      <div className="flex justify-between text-sm">
                        <span className="font-semibold">
                          {[entry.title, entry.organization].filter(Boolean).join(" — ")}
                        </span>
                        <span className="text-muted italic">
                          {[entry.location, entry.dateRange].filter(Boolean).join(" | ")}
                        </span>
                      </div>
                    )}
                    <ul className="list-none pl-4">
                      {entry.bullets.map((b, k) => (
                        <li key={k} className="text-sm">
                          {resume.style.bulletChar} {b}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            ))}

            {editing && (
              <button
                onClick={() => withDraft((d) => d.sections[i].entries.push({ bullets: [""] }))}
                className="text-xs text-accent hover:text-accent2"
              >
                + Add entry
              </button>
            )}
          </div>
        ))}
      </div>

      {resume.changeLog.length > 0 && (
        <div className="bg-panel border border-border rounded-xl p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted mb-3">
            What changed and why ({resume.changeLog.length}) — every change traces back to something already in
            your resume
          </div>
          <div className="space-y-3">
            {resume.changeLog.map((c, i) => (
              <div key={i} className="text-sm border-l-2 border-accent pl-3">
                <div className="font-medium">
                  <span className="text-muted">{c.section}:</span> {c.change}
                </div>
                <div className="text-xs text-muted mt-0.5">Basis: {c.basis}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
