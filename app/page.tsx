"use client";

import { useState } from "react";
import ChatPanel, { ChatMessage } from "@/components/ChatPanel";
import ResultPanel from "@/components/ResultPanel";
import { JdInput, TailoredResume } from "@/lib/types";

const WELCOME_MESSAGE: ChatMessage = {
  role: "assistant",
  text: "Hi — I'm your personal agent. Ask me anything, or attach files with the 📎 button if you want me to work with them.",
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string; // "data:application/pdf;base64,XXXX"
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file."));
    reader.readAsDataURL(file);
  });
}

export default function HomePage() {
  const [resumeBase64, setResumeBase64] = useState<string | null>(null);
  const [resumeFileName, setResumeFileName] = useState<string | null>(null);
  const [jd, setJd] = useState<JdInput | null>(null);
  const [jdLabel, setJdLabel] = useState<string | null>(null);
  const [filesProcessing, setFilesProcessing] = useState(false);

  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE]);
  // Round-tripped opaquely with the server on every /api/chat call — this is
  // Gemini's own Content[] history (including function-call/function-response
  // turns), not just display text. Untyped here on purpose: the client
  // doesn't need @google/genai's types, it just needs to hand this back
  // unchanged on the next request. See app/api/chat/route.ts.
  const [geminiHistory, setGeminiHistory] = useState<unknown[]>([]);
  const [currentResume, setCurrentResume] = useState<TailoredResume | null>(null);
  const [files, setFiles] = useState<{ docxBase64: string; pdfBase64: string } | null>(null);
  const [lastToolCalls, setLastToolCalls] = useState<string[]>([]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fills whichever "slot" is still empty: the first PDF becomes the resume
  // if one isn't already attached, and anything after that becomes the job
  // description (PNG/JPEG/WebP/PDF/.docx — normalized server-side via
  // /api/parse-jd). This is a file-shape heuristic, not the agent asking a
  // clarifying question, so it's kept generic on purpose: it doesn't know or
  // care that "resume" and "JD" are resume-tailoring-specific concepts — a
  // future tool added to this same agent could reuse this same attach flow
  // as long as it also just needs "a PDF" + "one more file." Click the ✕ on
  // a chip in the chat panel to clear that slot and re-attach a replacement.
  const handleFilesSelected = async (selected: File[]) => {
    setError(null);
    setFilesProcessing(true);
    try {
      for (const file of selected) {
        const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
        const resumeSlotOpen = isPdf && !resumeBase64;
        if (resumeSlotOpen) {
          try {
            const base64 = await fileToBase64(file);
            setResumeBase64(base64);
            setResumeFileName(file.name);
          } catch (err: any) {
            setError(`Couldn't read "${file.name}": ${String(err?.message ?? err)}`);
          }
          continue;
        }

        try {
          const form = new FormData();
          form.append("jd", file);
          const res = await fetch("/api/parse-jd", { method: "POST", body: form });
          const json = await res.json();
          if (!res.ok) {
            setError(json.error ?? `Couldn't read "${file.name}".`);
            continue;
          }
          setJd(json.jd);
          setJdLabel(file.name);
        } catch (err: any) {
          setError(String(err?.message ?? err));
        }
      }
    } finally {
      setFilesProcessing(false);
    }
  };

  const handleSend = async (message: string) => {
    setBusy(true);
    setError(null);
    setLastToolCalls([]);
    setMessages((prev) => [...prev, { role: "user", text: message }]);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, history: geminiHistory, resumeBase64, jd, currentResume }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Something went wrong.");
        setMessages((prev) => [...prev, { role: "assistant", text: `Error: ${json.error ?? "something went wrong."}` }]);
        return;
      }
      setMessages((prev) => [...prev, { role: "assistant", text: json.reply || "(no reply)" }]);
      setGeminiHistory(json.history ?? []);
      if (json.currentResume) setCurrentResume(json.currentResume);
      if (json.files) setFiles(json.files);
      setLastToolCalls(json.toolCalls ?? []);
    } catch (err: any) {
      const msg = String(err?.message ?? err);
      setError(msg);
      setMessages((prev) => [...prev, { role: "assistant", text: `Error: ${msg}` }]);
    } finally {
      setBusy(false);
    }
  };

  const handleReset = () => {
    setResumeBase64(null);
    setResumeFileName(null);
    setJd(null);
    setJdLabel(null);
    setMessages([WELCOME_MESSAGE]);
    setGeminiHistory([]);
    setCurrentResume(null);
    setFiles(null);
    setLastToolCalls([]);
    setError(null);
  };

  return (
    <div className="space-y-8">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Personal Agentic AI Agent</h1>
          <p className="text-sm text-muted mt-1">
            Your personal AI agent — attach files and tell it what you need. Nothing is persisted
            server-side; the conversation and any attached files live only in this browser tab.
          </p>
        </div>
        <button
          onClick={handleReset}
          className="shrink-0 px-3 py-1.5 rounded-lg border border-border text-xs text-muted hover:text-gray-900 transition"
        >
          Reset session
        </button>
      </header>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">{error}</div>
      )}

      <ChatPanel
        messages={messages}
        onSend={handleSend}
        busy={busy}
        lastToolCalls={lastToolCalls}
        onFilesSelected={handleFilesSelected}
        filesProcessing={filesProcessing}
        resumeName={resumeFileName}
        jdLabel={jdLabel}
        onClearResume={() => {
          setResumeBase64(null);
          setResumeFileName(null);
        }}
        onClearJd={() => {
          setJd(null);
          setJdLabel(null);
        }}
      />

      {currentResume && (
        <ResultPanel
          resume={currentResume}
          docxBase64={files?.docxBase64 ?? null}
          pdfBase64={files?.pdfBase64 ?? null}
          onReset={handleReset}
          onResumeChange={(updated) => {
            // A direct edit in the preview — not a chat turn. Update the
            // shared draft (so the next chat message, e.g. a follow-up
            // refine_resume, sees the edited version, not the pre-edit one)
            // and clear the previously-generated files, since they no
            // longer match what's on screen until "Update files" is clicked.
            setCurrentResume(updated);
            setFiles(null);
          }}
          onFilesReady={(newFiles) => setFiles(newFiles)}
        />
      )}
    </div>
  );
}
