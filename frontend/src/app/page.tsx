"use client";

import React, { useState, useRef, useEffect } from "react";
import {
  ArrowUp,
  UploadCloud,
  FileText,
  Loader2,
  Plus,
  Menu,
  X,
  ShieldCheck,
  Check,
  AlertCircle,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { motion, AnimatePresence } from "framer-motion";
import { useDropzone } from "react-dropzone";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type UploadItem = {
  id: string;
  name: string;
  status: "indexing" | "ready" | "error";
  error?: string;
};

const API = "http://localhost:8000/api/v1";

/* The graphite cross — a quiet medical mark, not the usual stethoscope. */
function Mark({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-[10px] bg-primary text-primary-foreground shadow-[0_2px_8px_-3px_rgba(15,18,21,0.35)]",
        className
      )}
    >
      <Plus className="h-[55%] w-[55%]" strokeWidth={2.75} />
    </div>
  );
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [files, setFiles] = useState<UploadItem[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  // Auto-grow the composer up to a ceiling.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = Math.min(el.scrollHeight, 180) + "px";
  }, [input]);

  const setStatus = (id: string, patch: Partial<UploadItem>) =>
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));

  const onDrop = async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;

    // Show every dropped file immediately as "indexing" — no waiting on the server.
    const queued: UploadItem[] = acceptedFiles.map((file) => ({
      id: `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: file.name,
      status: "indexing",
    }));
    setFiles((prev) => [...prev, ...queued]);
    setIsUploading(true);

    // One request per file, sequentially — embedding is CPU-bound, so parallel
    // requests wouldn't finish sooner; this way each card resolves on its own.
    for (let i = 0; i < acceptedFiles.length; i++) {
      const item = queued[i];
      const formData = new FormData();
      formData.append("files", acceptedFiles[i]);
      try {
        const res = await fetch(`${API}/upload`, { method: "POST", body: formData });
        const data = await res.json().catch(() => ({}));
        setStatus(
          item.id,
          res.ok
            ? { status: "ready" }
            : { status: "error", error: data.detail || "Couldn't index this file" }
        );
      } catch (error) {
        console.error(error);
        setStatus(item.id, { status: "error", error: "Couldn't reach the backend" });
      }
    }

    setIsUploading(false);
  };

  // Two independent drop targets (hero + sidebar) sharing one handler.
  const dropOpts = {
    onDrop,
    accept: { "application/pdf": [".pdf"], "text/csv": [".csv"] },
  };
  const hero = useDropzone(dropOpts);
  const sidebar = useDropzone(dropOpts);

  const clearDatabase = async () => {
    if (!confirm("Remove all documents from the knowledge base?")) return;
    try {
      await fetch(`${API}/clear`, { method: "POST" });
      setFiles([]);
      setMessages([]);
    } catch (error) {
      console.error(error);
    }
  };

  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isTyping) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: trimmed,
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsTyping(true);

    const assistantId = (Date.now() + 1).toString();
    setMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: "" }]);

    try {
      const historyToSend = messages
        .filter((m) => m.content.trim() !== "")
        .map((m) => ({ role: m.role, content: m.content }));

      const response = await fetch(`${API}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, history: historyToSend }),
      });

      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");

      let done = false;
      let streamedText = "";

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) {
          streamedText += decoder.decode(value, { stream: true });
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantId ? { ...msg, content: streamedText } : msg
            )
          );
        }
      }
    } catch (error) {
      console.error(error);
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantId
            ? {
                ...msg,
                content:
                  "**Couldn't reach the local AI engine.** Make sure the backend and Ollama are running, then try again.",
              }
            : msg
        )
      );
    } finally {
      setIsTyping(false);
    }
  };

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    sendMessage(input);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const spring = { type: "spring" as const, stiffness: 380, damping: 32 };
  const readyCount = files.filter((f) => f.status === "ready").length;
  const hasFiles = readyCount > 0;

  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      {/* Mobile backdrop */}
      <AnimatePresence>
        {navOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setNavOpen(false)}
            className="fixed inset-0 z-30 bg-foreground/25 backdrop-blur-sm md:hidden"
          />
        )}
      </AnimatePresence>

      {/* Left rail — knowledge base */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-[300px] flex-col border-r border-border bg-card transition-transform duration-300 ease-out md:static md:translate-x-0",
          navOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full md:translate-x-0"
        )}
      >
        <div className="flex items-center justify-between px-5 py-5">
          <div className="flex items-center gap-3">
            <Mark className="h-9 w-9" />
            <div className="leading-tight">
              <div className="font-display text-[15px] font-semibold tracking-tight">
                Health AI
              </div>
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                On-device
              </div>
            </div>
          </div>
          <button
            onClick={() => setNavOpen(false)}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary md:hidden"
            aria-label="Close menu"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5">
          <div className="h-px bg-border" />
        </div>

        <div className="flex min-h-0 flex-1 flex-col px-5 pt-6">
          {/* Uploader */}
          <div className="mb-2 flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Add documents
            </span>
          </div>
          <div
            {...sidebar.getRootProps()}
            className={cn(
              "group cursor-pointer rounded-xl border border-dashed p-5 text-center transition-colors",
              sidebar.isDragActive
                ? "border-primary bg-primary/[0.06]"
                : "border-border hover:border-primary/50 hover:bg-primary/[0.03]"
            )}
          >
            <input {...sidebar.getInputProps()} />
            <div className="mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-secondary transition-transform group-hover:scale-105">
              {isUploading ? (
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
              ) : (
                <UploadCloud className="h-4 w-4 text-primary" />
              )}
            </div>
            <p className="text-[13px] font-medium">
              {isUploading ? "Indexing…" : "Drop SOPs or guidelines"}
            </p>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              PDF · CSV
            </p>
          </div>

          {/* Indexed files */}
          <div className="mb-2 mt-7 flex items-center justify-between">
            <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Knowledge base
              <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-semibold text-secondary-foreground">
                {files.length}
              </span>
            </span>
            {files.length > 0 && (
              <button
                onClick={clearDatabase}
                className="font-mono text-[10px] uppercase tracking-wider text-destructive transition-opacity hover:opacity-70"
              >
                Clear
              </button>
            )}
          </div>

          <ScrollArea className="-mr-2 flex-1 pr-2">
            <div className="space-y-1.5 pb-4">
              <AnimatePresence initial={false}>
                {files.map((file) => (
                  <motion.div
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, filter: "blur(3px)" }}
                    transition={spring}
                    key={file.id}
                    className="rounded-lg border border-border bg-background px-3 py-2.5"
                  >
                    <div className="flex items-center gap-2.5">
                      <FileText className="h-3.5 w-3.5 shrink-0 text-primary" />
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                        {file.name}
                      </span>
                      {file.status === "indexing" && (
                        <span className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                          Indexing
                        </span>
                      )}
                      {file.status === "ready" && (
                        <Check className="h-3.5 w-3.5 shrink-0 text-primary" strokeWidth={2.5} />
                      )}
                      {file.status === "error" && (
                        <AlertCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
                      )}
                    </div>
                    {file.status === "indexing" && <div className="progress-track mt-2" />}
                    {file.status === "error" && (
                      <p className="mt-1.5 text-[11px] leading-snug text-destructive">
                        {file.error}
                      </p>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>

              {files.length === 0 && (
                <p className="rounded-lg border border-dashed border-border px-3 py-4 text-[12px] leading-relaxed text-muted-foreground">
                  Nothing indexed this session. Upload documents, then ask
                  questions about them.
                </p>
              )}
            </div>
          </ScrollArea>
        </div>

        <div className="px-5 pb-5 pt-3">
          <div className="flex items-center gap-2 rounded-lg bg-secondary px-3 py-2.5">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="font-mono text-[10px] leading-tight text-muted-foreground">
              Runs locally. Nothing leaves this machine.
            </span>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="relative flex min-w-0 flex-1 flex-col">
        {/* Subtle depth */}
        <div className="page-glow pointer-events-none absolute inset-x-0 top-0 h-80" />

        {/* Header */}
        <header className="relative z-10 flex h-14 shrink-0 items-center justify-between border-b border-border bg-background/70 px-4 backdrop-blur-md md:px-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setNavOpen(true)}
              className="rounded-md p-1.5 text-foreground hover:bg-secondary md:hidden"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              Clinical assistant
            </span>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              Local inference
            </span>
          </div>
        </header>

        {/* Conversation */}
        <div ref={scrollRef} className="relative z-10 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-2xl px-5 pb-40 pt-8 md:px-6">
            {messages.length === 0 ? (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
                className="flex flex-col items-center pt-[6vh] text-center"
              >
                <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary">
                  Private · On-device
                </span>
                <h1 className="mt-4 font-display text-[2.1rem] font-semibold leading-[1.08] tracking-tight md:text-[2.6rem]">
                  {hasFiles ? (
                    <>
                      Ask anything about
                      <br />
                      your documents.
                    </>
                  ) : (
                    <>
                      Add your documents
                      <br />
                      to begin.
                    </>
                  )}
                </h1>
                <p className="mt-4 max-w-md text-[15px] leading-relaxed text-muted-foreground">
                  Health AI answers only from the SOPs and guidelines you upload —
                  grounded, cited, and never leaving this machine.
                </p>

                {/* Primary upload target */}
                <div
                  {...hero.getRootProps()}
                  className={cn(
                    "group mt-9 w-full max-w-md cursor-pointer rounded-2xl border-2 border-dashed p-8 transition-all",
                    hero.isDragActive
                      ? "scale-[1.01] border-primary bg-primary/[0.06]"
                      : "border-border bg-card hover:border-primary/60 hover:bg-primary/[0.02]"
                  )}
                >
                  <input {...hero.getInputProps()} />
                  <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 transition-transform group-hover:scale-105">
                    {isUploading ? (
                      <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    ) : (
                      <UploadCloud className="h-6 w-6 text-primary" />
                    )}
                  </div>
                  <p className="text-[15px] font-semibold">
                    {isUploading ? "Indexing your documents…" : "Drag & drop your files"}
                  </p>
                  <p className="mt-1 text-[13px] text-muted-foreground">
                    or <span className="font-medium text-primary">click to browse</span>
                  </p>
                  <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    PDF · CSV
                  </p>
                </div>

                {hasFiles && (
                  <p className="mt-6 font-mono text-[11px] text-muted-foreground">
                    {readyCount} document{readyCount > 1 ? "s" : ""} ready · type a
                    question below
                  </p>
                )}
              </motion.div>
            ) : (
              <div className="space-y-7 pt-2">
                <AnimatePresence initial={false}>
                  {messages.map((msg) =>
                    msg.role === "user" ? (
                      <motion.div
                        layout
                        key={msg.id}
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={spring}
                        className="flex justify-end"
                      >
                        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-[15px] leading-relaxed text-primary-foreground shadow-[0_4px_16px_-8px_rgba(15,18,21,0.4)]">
                          {msg.content}
                        </div>
                      </motion.div>
                    ) : (
                      <motion.div
                        layout
                        key={msg.id}
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={spring}
                        className="flex gap-3"
                      >
                        <Mark className="mt-0.5 h-7 w-7 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                            Health AI
                          </div>
                          <div className="rounded-2xl rounded-tl-md border border-border bg-card px-5 py-4 shadow-[0_1px_2px_rgba(15,23,41,0.04),0_12px_28px_-20px_rgba(15,23,41,0.25)]">
                            {msg.content ? (
                              <div className="answer-prose prose max-w-none">
                                <ReactMarkdown>{msg.content}</ReactMarkdown>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5 py-1">
                                <span className="dot" />
                                <span className="dot" />
                                <span className="dot" />
                              </div>
                            )}
                          </div>
                        </div>
                      </motion.div>
                    )
                  )}
                </AnimatePresence>
              </div>
            )}
          </div>
        </div>

        {/* Composer */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-background via-background to-transparent pb-5 pt-12">
          <div className="pointer-events-auto mx-auto w-full max-w-2xl px-5 md:px-6">
            <form
              onSubmit={handleSubmit}
              className="flex items-end gap-2 rounded-2xl border border-border bg-card p-2 shadow-[0_10px_40px_-14px_rgba(15,23,41,0.25)] transition-colors focus-within:border-primary/60 focus-within:ring-4 focus-within:ring-primary/10"
            >
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                rows={1}
                placeholder={
                  hasFiles
                    ? "Ask a question about your documents…"
                    : "Upload documents, or ask about what's already indexed…"
                }
                disabled={isTyping}
                className="max-h-[180px] flex-1 resize-none bg-transparent px-3 py-2 text-[15px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/70 disabled:opacity-60"
              />
              <Button
                type="submit"
                size="icon"
                disabled={!input.trim() || isTyping}
                className="h-9 w-9 shrink-0 rounded-xl transition-transform hover:scale-105 active:scale-95 disabled:opacity-40 disabled:hover:scale-100"
                aria-label="Send message"
              >
                {isTyping ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
                )}
              </Button>
            </form>
            <p className="mt-3 text-center font-mono text-[10px] tracking-wide text-muted-foreground">
              Grounded in your documents · verify against source SOPs before acting
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
