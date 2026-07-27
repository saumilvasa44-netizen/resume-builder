"use client";

import { useRef, useState } from "react";

export type ChatMessage = { role: "user" | "assistant"; text: string };

const TOOL_LABEL: Record<string, string> = {
  tailor_resume: "tailoring resume",
  refine_resume: "refining resume",
  prepare_downloads: "preparing files",
};

// Whatever this agent's tools currently accept as input files. Adding a new
// tool later that needs a different file type just means adding to this
// list — the attach button itself stays generic.
const ATTACH_ACCEPT = ".pdf,application/pdf,.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp,.docx";

function PaperclipIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

// A generic chat surface: type a prompt, attach files with the paperclip
// button next to Send. What the attached files mean (a resume vs. a job
// description, say) is decided by the app's current tools, not by this
// component — see UploadForm's old two-panel layout, which this replaced.
export default function ChatPanel({
  messages,
  onSend,
  busy,
  lastToolCalls,
  onFilesSelected,
  filesProcessing,
  resumeName,
  jdLabel,
  onClearResume,
  onClearJd,
}: {
  messages: ChatMessage[];
  onSend: (message: string) => void;
  busy: boolean;
  lastToolCalls: string[];
  onFilesSelected: (files: File[]) => void;
  filesProcessing: boolean;
  resumeName: string | null;
  jdLabel: string | null;
  onClearResume: () => void;
  onClearJd: () => void;
}) {
  const [input, setInput] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const send = () => {
    const trimmed = input.trim();
    if (!trimmed || busy) return;
    onSend(trimmed);
    setInput("");
  };

  return (
    <div className="bg-panel border border-border rounded-xl p-5 space-y-3">
      <div className="text-sm font-medium">Chat</div>

      {!resumeName && !jdLabel && (
        <p className="text-xs text-muted">Attach files with the 📎 button below, or just start typing.</p>
      )}

      <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                m.role === "user" ? "bg-accent text-white" : "bg-gray-100 text-gray-900"
              }`}
            >
              {m.text}
            </div>
          </div>
        ))}
        {(busy || filesProcessing) && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-lg px-3 py-2 text-sm bg-gray-100 text-muted italic">
              {filesProcessing
                ? "Reading attached file(s)…"
                : lastToolCalls.length > 0
                ? lastToolCalls.map((t) => TOOL_LABEL[t] ?? t).join(", ") + "…"
                : "Thinking…"}
            </div>
          </div>
        )}
      </div>

      {(resumeName || jdLabel) && (
        <div className="flex flex-wrap gap-2">
          {resumeName && (
            <span
              title="Attached file"
              className="inline-flex items-center gap-1.5 text-xs bg-gray-100 border border-border rounded-full px-2.5 py-1"
            >
              📎 {resumeName}
              <button onClick={onClearResume} className="text-muted hover:text-gray-900" aria-label={`Remove ${resumeName}`}>
                ✕
              </button>
            </span>
          )}
          {jdLabel && (
            <span
              title="Attached file"
              className="inline-flex items-center gap-1.5 text-xs bg-gray-100 border border-border rounded-full px-2.5 py-1"
            >
              📎 {jdLabel}
              <button onClick={onClearJd} className="text-muted hover:text-gray-900" aria-label={`Remove ${jdLabel}`}>
                ✕
              </button>
            </span>
          )}
        </div>
      )}

      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          disabled={busy}
          placeholder="Enter a prompt…"
          className="flex-1 text-sm rounded-lg border border-border px-3 py-2 disabled:opacity-50"
        />
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ATTACH_ACCEPT}
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length > 0) onFilesSelected(files);
            e.target.value = ""; // allow re-selecting the same file again later
          }}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={busy || filesProcessing}
          title="Attach a file"
          className="px-3 py-2 rounded-lg border border-border text-muted hover:text-gray-900 hover:bg-gray-50 transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <PaperclipIcon />
        </button>
        <button
          onClick={send}
          disabled={busy || !input.trim()}
          className="px-4 py-2 rounded-lg bg-accent hover:bg-accent2 text-white text-sm font-medium transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Send
        </button>
      </div>
    </div>
  );
}
