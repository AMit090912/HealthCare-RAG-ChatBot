# 🏥 Health AI — On-device Clinical RAG Assistant

A **100% local**, privacy-first Retrieval-Augmented Generation (RAG) chatbot for healthcare.

Upload your hospital's Standard Operating Procedures (SOPs), clinical guidelines, and policy documents (PDF / CSV) into a local knowledge base, then ask questions in natural language. The assistant answers **strictly from your documents** — nothing is sent to the cloud, and it refuses to answer anything not backed by the uploaded material.

> **Why local?** Embeddings, vector storage, and LLM inference all run on your machine via [Ollama](https://ollama.com). No patient data or clinical documents ever leave the device.

---

## ✨ Features

- **100% on-device** — no external API calls. Full data sovereignty.
- **Grounded answers** — the model is prompted to use only retrieved context; if the answer isn't in your documents it replies *"I could not find this information in the uploaded documents."*
- **Conversational memory** — a history-aware retriever rewrites follow-up questions using the chat so far, so "what about children?" resolves against the previous turn.
- **Streaming responses** — answers render token-by-token as the model generates them.
- **PDF & CSV ingestion** — parsed, chunked, embedded, and indexed automatically.
- **Smooth uploads** — files appear instantly with a live *Indexing…* indicator that flips to ✓ per file (embedding is CPU-bound, so this reflects the real work happening locally).
- **Modern, minimal UI** — a monochrome graphite theme built with Next.js, Tailwind CSS v4, and Framer Motion. Responsive, keyboard-accessible, and respects `prefers-reduced-motion`.

---

## 🧱 Tech Stack

| Layer | Technology |
|-------|------------|
| **LLM** | [Ollama](https://ollama.com) running `qwen2.5:3b` |
| **Embeddings** | HuggingFace `all-MiniLM-L6-v2` (fast, CPU-friendly) |
| **RAG pipeline** | LangChain (`langchain-classic` history-aware + retrieval chains) |
| **Vector DB** | ChromaDB (persistent, local) |
| **Document loading** | PyMuPDF (PDF), LangChain `CSVLoader` (CSV) |
| **Backend API** | FastAPI + Uvicorn (streaming responses) |
| **Frontend** | Next.js 16 (App Router), React 19, TypeScript |
| **Styling / UI** | Tailwind CSS v4, Framer Motion, lucide-react, react-markdown |

---

## 🧠 How it works

```
Upload
  PDF/CSV ─▶ save to backend/data ─▶ PyMuPDF / CSVLoader
          ─▶ split into chunks (1000 chars, 200 overlap)
          ─▶ embed each chunk (all-MiniLM-L6-v2)
          ─▶ store vectors in ChromaDB

Ask
  question + chat history
          ─▶ history-aware retriever rewrites it into a standalone query
          ─▶ retrieve top-4 relevant chunks from ChromaDB
          ─▶ stuff chunks into a strict "answer only from context" prompt
          ─▶ qwen2.5:3b (via Ollama) streams the grounded answer
          ─▶ frontend renders it as Markdown
```

---

## 🚀 Getting Started

### Prerequisites

1. **Python 3.10+**
2. **Node.js 18.18+** (or 20+) and npm
3. **[Ollama](https://ollama.com/download)** installed

You'll run **three processes** at once: Ollama, the backend, and the frontend.

### 1. Model (Ollama)

Pull the model once, then make sure Ollama is running (it serves on port `11434`):

```bash
ollama pull qwen2.5:3b
ollama run qwen2.5:3b      # or just `ollama serve` in the background
```

### 2. Backend (FastAPI — must be on port 8000)

```bash
# from the project root
python -m venv venv
# Activate:
#   Windows (PowerShell):  .\venv\Scripts\Activate.ps1
#   macOS / Linux:         source venv/bin/activate

pip install -r backend/requirements.txt

cd backend
uvicorn app.main:app --reload --port 8000
```

> On first run the backend downloads the `all-MiniLM-L6-v2` embedding model from HuggingFace (one time, needs internet).
> Verify it's up at **http://localhost:8000** — you should see `{"status":"ok", ...}`.

### 3. Frontend (Next.js — must be on port 3000)

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:3000**.

### ⚠️ Ports are fixed

- The frontend calls the backend at `http://localhost:8000` → the backend **must** run on `8000`.
- The backend's CORS only allows `http://localhost:3000` → the frontend **must** run on `3000`.

If Next.js says port 3000 is taken and offers another, free port 3000 instead — otherwise requests are blocked by CORS.

---

## 🔌 API Reference

Base URL: `http://localhost:8000/api/v1`

| Method | Endpoint | Body | Description |
|--------|----------|------|-------------|
| `POST` | `/upload` | `multipart/form-data` (`files`: PDF/CSV) | Parse, chunk, embed, and index documents |
| `POST` | `/chat` | `{ "message": string, "history": [{role, content}] }` | Streams a grounded answer (`text/plain`) |
| `POST` | `/clear` | — | Wipes the vector store and uploaded files |
| `GET`  | `/` (root) | — | Health check |

---

## 📁 Project Structure

```text
AI-Healthcare-RAG-Chatbot/
├── backend/
│   ├── app/
│   │   ├── api/endpoints.py        # /upload, /chat, /clear routes
│   │   ├── core/config.py          # settings: model, paths, Ollama URL
│   │   ├── services/rag_service.py # ingestion + RAG chains
│   │   └── main.py                 # FastAPI app + CORS
│   ├── data/                       # uploaded source documents (git-ignored, created at runtime)
│   ├── chroma_db/                  # local vector store (git-ignored, regenerated)
│   └── requirements.txt
└── frontend/
    └── src/
        ├── app/
        │   ├── page.tsx            # chat UI, upload, streaming
        │   ├── layout.tsx          # fonts + metadata
        │   └── globals.css         # theme tokens + styles
        ├── components/ui/          # button, input, card, scroll-area
        └── lib/utils.ts
```

---

## ⚙️ Configuration

Backend settings live in [`backend/app/core/config.py`](backend/app/core/config.py):

| Setting | Default | Notes |
|---------|---------|-------|
| `LLM_MODEL` | `qwen2.5:3b` | Any Ollama model you've pulled (e.g. `llama3.2`, `qwen2.5:7b`) |
| `EMBEDDING_MODEL` | `all-MiniLM-L6-v2` | HuggingFace sentence-transformer |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Where Ollama is listening |

To use a different model, `ollama pull <model>` and update `LLM_MODEL`, then restart the backend.

---

## 📝 Notes & Limitations

- **Indexing takes a few seconds** for larger PDFs — embeddings are computed on the CPU. This is inherent to running everything locally; it's the trade-off for privacy.
- The sidebar's file list is **per-session** — it shows files you upload during the current visit, not documents already sitting in the vector store from a previous run.
- This is a local/demo setup. For any real clinical use, review data handling, access control, and compliance (e.g. HIPAA) for your environment — and keep inference local rather than swapping in a cloud LLM.

---

## 🔒 Privacy

Everything — parsing, embeddings, the vector database, and the language model — runs on your machine. There are no outbound network calls for inference. Keep it that way for sensitive documents.
