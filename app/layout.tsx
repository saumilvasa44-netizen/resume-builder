import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Personal Agentic AI Agent",
  description: "Your personal AI agent — attach files and tell it what you need.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-bg text-gray-900 min-h-screen antialiased">
        <main className="max-w-4xl mx-auto px-4 py-10">{children}</main>
      </body>
    </html>
  );
}
