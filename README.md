# 🧠 Multi-Tenant RAG Platform

A **production-ready, multi-tenant Retrieval-Augmented Generation (RAG) platform** that allows multiple organizations to upload private documents and ask questions against them — with strict per-tenant data isolation. Built with **FastAPI**, **PostgreSQL + pgvector**, **Groq (LLaMA 3.3)**, and a **React** frontend.

> **Eval results (v1):** 86.5% accuracy · 8.65/10 avg score · 3.06s avg latency across 20 questions

---

## ✨ Features

- **Multi-tenant isolation** — every document chunk carries a `tenant_id`; cross-tenant data leaks are structurally impossible
- **PDF ingestion pipeline** — upload PDFs that are parsed, chunked (500 chars / 50 overlap), and embedded with `BAAI/bge-small-en-v1.5`
- **Semantic search** — pgvector cosine similarity retrieval scoped strictly to the requesting tenant
- **Streaming answers** — token-by-token SSE streaming via Groq's `llama-3.3-70b-versatile` model
- **Citations** — every answer returns the source chunks it was grounded on (filename + similarity score)
- **JWT auth** — stateless Bearer tokens with tenant context baked into the payload
- **LLM-as-judge eval harness** — automated evaluation pipeline scoring answer quality 0–10 against expected answers

---

## 🏗️ Architecture

```
┌───────────────────────────────────────────────┐
│                React Frontend                 │
│          (Vite · JSX · port 5173)             │
└──────────────────┬────────────────────────────┘
                   │ HTTP / SSE
┌──────────────────▼────────────────────────────┐
│            FastAPI Backend (Python)           │
│  /auth  ·  /documents  ·  /query              │
└──────┬───────────────────────┬────────────────┘
       │                       │
┌──────▼──────┐      ┌─────────▼──────────────┐
│  PostgreSQL  │      │  Groq API              │
│  + pgvector  │      │  llama-3.3-70b         │
│  (embeddings)│      │  (LLM inference)       │
└─────────────┘      └────────────────────────┘
```

### Directory Structure

```
Multi-tenant RAG/
├── app/
│   ├── api/
│   │   ├── auth.py          # Register, login, /me endpoints
│   │   ├── documents.py     # PDF upload + document listing
│   │   └── query.py         # RAG query with streaming SSE
│   ├── core/
│   │   ├── config.py        # Pydantic settings (env-driven)
│   │   ├── database.py      # SQLAlchemy engine + session
│   │   └── security.py      # JWT helpers, password hashing
│   ├── models/
│   │   └── models.py        # Tenant, User, Document, DocumentChunk ORM models
│   ├── services/
│   │   ├── embeddings.py    # sentence-transformers batch embedding
│   │   ├── ingestion.py     # PDF → chunks → embeddings → DB
│   │   └── retrieval.py     # pgvector similarity search
│   └── main.py              # FastAPI app + CORS + router registration
├── eval/
│   ├── questions.json        # 20 ground-truth Q&A pairs
│   ├── prompts.json          # Prompt version definitions
│   ├── run_eval.py           # LLM-as-judge evaluation harness
│   ├── report_v1.json        # Eval results — prompt v1
│   └── report_v2.json        # Eval results — prompt v2
├── frontend/                 # React + Vite UI
├── docker-compose.yml        # PostgreSQL + pgvector local setup
├── render.yaml               # Render.com deployment config
├── Procfile                  # Gunicorn process definition
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
SECRET_KEY=your-secret-key-here
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
| `POST` | `/documents/upload` | Upload a PDF (max 10 MB) |
| `GET` | `/documents/` | List all documents for the current tenant |

### Query

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/query/` | Ask a question; returns streaming SSE or JSON |

**Query payload:**
```json
{
  "question": "What are the key findings in the Q3 report?",
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
python eval/run_eval.py v1
```

The judge uses `llama-3.3-70b-versatile` (temperature=0) to score each answer 0–10 and writes a full report to `eval/report_<version>.json`.

### Results

| Prompt Version | Avg Score | Accuracy | Avg Latency |
|----------------|-----------|----------|-------------|
| v1 | 8.65 / 10 | **86.5%** | 3.06s |
| v2 | *(see report_v2.json)* | | |

---

## 🐳 Deployment

### Render.com

The project includes a `render.yaml` for one-click deployment to [Render](https://render.com/):

```bash
# The render.yaml configures:
# - Python web service with Gunicorn + Uvicorn workers
# - Environment variables (DATABASE_URL, SECRET_KEY, GROQ_API_KEY)
```

### Manual (Gunicorn)

```bash
gunicorn app.main:app -w 4 -k uvicorn.workers.UvicornWorker --bind 0.0.0.0:8000
```

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | FastAPI, Python 3.11, Uvicorn, Gunicorn |
| **Database** | PostgreSQL 16, pgvector extension |
| **ORM** | SQLAlchemy 2.0 |
| **Embeddings** | `sentence-transformers` (`BAAI/bge-small-en-v1.5`) |
| **LLM** | Groq API (`llama-3.3-70b-versatile`) |
| **Auth** | JWT (python-jose), bcrypt (passlib) |
| **PDF Parsing** | pypdf |
| **Text Splitting** | LangChain `RecursiveCharacterTextSplitter` |
| **Frontend** | React 18, Vite |
| **Containerization** | Docker, Docker Compose |
| **Deployment** | Render.com, Gunicorn |

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

---

## 👤 Author

**Chandan Kumar Vanamala**  
Full-Stack Engineer · AWS Certified Developer Associate  
[GitHub](https://github.com/Chandan-Kumar-Vanamala) · Authorized to work in the US (F-1 STEM OPT)
