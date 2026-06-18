# 🧠 Multi-Tenant RAG Platform

A **production-ready, multi-tenant Retrieval-Augmented Generation (RAG) platform** that allows multiple organizations to upload private documents and ask questions against them — with strict per-tenant data isolation. Built with **FastAPI**, **PostgreSQL + pgvector**, **Groq (LLaMA 3.3)**, and a **React** frontend.

> **Eval results (v3 — first valid baseline):** 75.0% accuracy · 7.5/10 avg score · 4.21s avg latency across 20 questions

🌐 **Live Demo:**
- Frontend: [https://frontend-6a7r.onrender.com](https://frontend-6a7r.onrender.com)
- Backend API: [https://rag-backend-ad03.onrender.com](https://rag-backend-ad03.onrender.com)
- API Docs: [https://rag-backend-ad03.onrender.com/docs](https://rag-backend-ad03.onrender.com/docs)

---

## ✨ Features

- **Multi-tenant isolation** — every document chunk carries a `tenant_id`; cross-tenant data leaks are structurally impossible
- **Multi-format ingestion** — upload **PDF, DOCX, and TXT** files; parsed, chunked (500 chars / 50 overlap), and embedded with `BAAI/bge-small-en-v1.5`
- **Semantic search** — pgvector cosine similarity retrieval (TOP_K=8, MIN_SIMILARITY=0.30) scoped strictly to the requesting tenant
- **Conversation history** — multi-turn conversations with auto-titling and persistent message history
- **Streaming answers** — token-by-token SSE streaming via Groq's `llama-3.3-70b-versatile` model
- **Citations** — every answer returns the source chunks it was grounded on (filename + similarity score)
- **JWT auth** — stateless Bearer tokens with tenant context baked into the payload
- **LLM-as-judge eval harness** — automated evaluation pipeline scoring answer quality 0–10 against expected answers

---

## 🏗️ Architecture

```
┌───────────────────────────────────────────────┐
│                React Frontend                 │
│     (Vite · JSX · Render Static Site)        │
└──────────────────┬────────────────────────────┘
                   │ HTTP / SSE
┌──────────────────▼────────────────────────────┐
│            FastAPI Backend (Python)           │
│  /auth  ·  /documents  ·  /query              │
│  Gunicorn + UvicornWorker (Render Web Svc)   │
└──────┬───────────────────────┬────────────────┘
       │                       │
┌──────▼──────┐      ┌─────────▼──────────────┐
│  PostgreSQL  │      │  Groq API              │
│  + pgvector  │      │  llama-3.3-70b         │
│  (Render DB) │      │  (LLM inference)       │
└─────────────┘      └────────────────────────┘
```

### Directory Structure

```
Multi-tenant RAG/
├── app/
│   ├── api/
│   │   ├── auth.py            # Register, login, /me endpoints
│   │   ├── conversations.py   # Create, list, delete conversations
│   │   ├── documents.py       # PDF/DOCX/TXT upload + document listing
│   │   └── query.py           # RAG query with streaming SSE + history
│   ├── core/
│   │   ├── config.py          # Pydantic settings (env-driven)
│   │   ├── database.py        # SQLAlchemy engine + session
│   │   └── security.py        # JWT helpers, password hashing
│   ├── models/
│   │   └── models.py          # Tenant, User, Document, DocumentChunk, Conversation ORM models
│   ├── services/
│   │   ├── embeddings.py      # fastembed (ONNX) batch embedding — lightweight, ~100MB RAM
│   │   ├── ingestion.py       # PDF/DOCX/TXT → chunks → embeddings → DB (batched)
│   │   └── retrieval.py       # pgvector similarity search (TOP_K=8, threshold=0.30)
│   └── main.py                # FastAPI app + CORS + router registration + model pre-warming
├── eval/
│   ├── questions.json          # 20 ground-truth Q&A pairs
│   ├── prompts.json            # Prompt version definitions (v1–v3)
│   ├── run_eval.py             # LLM-as-judge evaluation harness
│   ├── report_v1.json          # LEGACY — invalid (broken harness)
│   ├── report_v2.json          # LEGACY — invalid (broken harness)
│   └── report_v3.json          # ✅ First valid baseline eval results
├── frontend/                   # React + Vite UI
├── docker-compose.yml          # PostgreSQL + pgvector local setup
├── render.yaml                 # Render.com deployment config
├── Procfile                    # Gunicorn process definition
├── runtime.txt                 # Python 3.11.9 pin for Render
└── requirements.txt
```

---

## 🚀 Quick Start

### Prerequisites

- Python 3.11+
- Node.js 18+
- Docker & Docker Compose
- [Groq API key](https://console.groq.com/)

### 1. Clone & configure environment

```bash
git clone https://github.com/Chandan-Kumar-Vanamala/Multi-tenant-RAG.git
cd Multi-tenant-RAG
```

Create a `.env` file in the project root:

```env
DATABASE_URL=postgresql://raguser:ragpassword@localhost:5432/ragdb
SECRET_KEY=your-secret-key-here-minimum-32-chars
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30
GROQ_API_KEY=your-groq-api-key-here
EMBEDDING_MODEL=BAAI/bge-small-en-v1.5
```

### 2. Start the database

```bash
docker-compose up -d
```

This spins up a **pgvector-enabled PostgreSQL 16** instance on port `5432`.

### 3. Set up Python environment & run the backend

```bash
python -m venv venv
# Windows
venv\Scripts\activate
# macOS/Linux
source venv/bin/activate

pip install -r requirements.txt
uvicorn app.main:app --reload
```

The API will be available at `http://localhost:8000`.  
Interactive docs: `http://localhost:8000/docs`

### 4. Run the frontend

```bash
cd frontend
npm install
npm run dev
```

The UI will be available at `http://localhost:5173`.

---

## 🔌 API Reference

### Auth

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/auth/register` | Create a new tenant + admin user |
| `POST` | `/auth/login` | Login and receive a JWT Bearer token |
| `GET` | `/auth/me` | Get current user info |

**Register payload:**
```json
{
  "tenant_name": "acme-corp",
  "email": "admin@acme.com",
  "password": "securepassword"
}
```

### Documents

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/documents/upload` | Upload a PDF, DOCX, or TXT file (max 10 MB) |
| `GET` | `/documents/` | List all documents for the current tenant |
| `DELETE` | `/documents/{id}` | Delete a document and all its chunks |

### Conversations

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/conversations/` | Create a new conversation |
| `GET` | `/conversations/` | List all conversations for current user |
| `GET` | `/conversations/{id}/messages` | Get all messages in a conversation |
| `DELETE` | `/conversations/{id}` | Delete a conversation and its messages |

### Query

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/query/` | Ask a question; returns streaming SSE or JSON |

**Query payload:**
```json
{
  "question": "What are the key findings in the Q3 report?",
  "conversation_id": "<uuid from POST /conversations/>",
  "stream": true
}
```

**Streaming response format (SSE):**
```
data: {"type": "citations", "data": [...]}
data: {"type": "token", "data": "The key"}
data: {"type": "token", "data": " findings..."}
data: {"type": "done"}
```

---

## 🔒 Tenant Isolation Design

Tenant isolation is enforced at **multiple layers**:

1. **JWT payload** — `tenant_id` is embedded at login time; no client-supplied tenant IDs are trusted
2. **Database schema** — `DocumentChunk.tenant_id` is a direct foreign key; every chunk is tagged at write time
3. **Query scoping** — `retrieve_chunks()` always adds `WHERE tenant_id = :current_tenant` before the pgvector ANN search

This means even if a user somehow forges a request, they can only retrieve chunks belonging to their own tenant.

---

## 📊 Evaluation

The `eval/` directory contains a **LLM-as-judge harness** that benchmarks answer quality against 20 ground-truth Q&A pairs.

```bash
# Run evaluation against a live server (ensure server is running first)
python eval/run_eval.py v3
```

The judge uses `llama-3.3-70b-versatile` (temperature=0) to score each answer 0–10 and writes a full report to `eval/report_<version>.json`.

### Results

| Prompt Version | Avg Score | Accuracy | Avg Latency | Status |
|----------------|-----------|----------|-------------|--------|
| v1 | — | — | — | ❌ Legacy (broken harness) |
| v2 | — | — | — | ❌ Legacy (broken harness) |
| **v3** | **7.5 / 10** | **75.0%** | **4.21s** | ✅ Valid baseline |

---

## ☁️ Deployment (Render.com)

The app is deployed on [Render](https://render.com/) with three services:

| Service | Type | Notes |
|---------|------|-------|
| `rag-db` | PostgreSQL 16 | With pgvector extension |
| `rag-backend` | Web Service (Python 3.11) | FastAPI + Gunicorn |
| `rag-frontend` | Static Site | React + Vite build |

### Backend Environment Variables

| Key | Description |
|-----|-------------|
| `DATABASE_URL` | Internal PostgreSQL URL from Render |
| `SECRET_KEY` | Random 64-char hex string for JWT signing |
| `ALGORITHM` | `HS256` |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `30` (or `1440` for 24h sessions) |
| `GROQ_API_KEY` | From [console.groq.com](https://console.groq.com/) |
| `EMBEDDING_MODEL` | `BAAI/bge-small-en-v1.5` |
| `PYTHON_VERSION` | `3.11.9` |

### Backend Start Command

```bash
gunicorn app.main:app -w 1 -k uvicorn.workers.UvicornWorker --bind 0.0.0.0:$PORT --timeout 120
```

> **Note:** 1 worker is required on the free tier (512MB RAM). The `fastembed` ONNX model uses ~100MB, leaving headroom for requests.

### Frontend Environment Variables

| Key | Value |
|-----|-------|
| `VITE_API_URL` | Your backend Render URL |

### Deploy Steps

1. Create a **PostgreSQL** database on Render → copy the Internal Database URL
2. Create a **Web Service** → connect GitHub repo → set env vars + start command above
3. Create a **Static Site** → Root Directory: `frontend` → Build: `npm install && npm run build` → Publish: `dist`

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | FastAPI, Python 3.11, Uvicorn, Gunicorn |
| **Database** | PostgreSQL 16, pgvector extension |
| **ORM** | SQLAlchemy 2.0 |
| **Embeddings** | `fastembed` ONNX (`BAAI/bge-small-en-v1.5`) — ~100MB RAM vs ~400MB for sentence-transformers |
| **LLM** | Groq API (`llama-3.3-70b-versatile`) |
| **Auth** | JWT (python-jose), bcrypt (passlib) |
| **Document Parsing** | pypdf (PDF), python-docx (DOCX), built-in (TXT) |
| **Text Splitting** | LangChain `RecursiveCharacterTextSplitter` |
| **Frontend** | React 18, Vite |
| **Containerization** | Docker, Docker Compose |
| **Deployment** | Render.com (Web Service + Static Site + PostgreSQL) |

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

---

## 👤 Author

**Chandan Kumar Vanamala**  
Full-Stack Engineer · AWS Certified Developer Associate  
[GitHub](https://github.com/Chandan-Kumar-Vanamala) · Authorized to work in the US (F-1 STEM OPT)
