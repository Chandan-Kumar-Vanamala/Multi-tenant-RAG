from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
from groq import Groq
import json

from app.core.database import get_db
from app.core.config import settings
from app.api.auth import get_current_user
from app.models.models import User, Conversation, ConversationMessage
from app.services.retrieval import retrieve_chunks, assemble_context

router = APIRouter(prefix="/query", tags=["query"])

SYSTEM_PROMPT = """You are a helpful assistant that answers questions based strictly on the provided context.

Rules:
- Only use information from the provided context to answer
- If the context doesn't contain enough information, say so clearly
- Be concise and accurate
- Reference the source when relevant (e.g. "According to Source 1...")
- Never make up information not in the context"""

# Number of prior message pairs (user + assistant) to include as history
HISTORY_TURNS = 3


def get_groq_client() -> Groq:
    return Groq(api_key=settings.GROQ_API_KEY)


class QueryRequest(BaseModel):
    question: str
    conversation_id: str          # required — every message belongs to a conversation
    stream: bool = True


def _get_conversation(conversation_id: str, user: User, db: Session) -> Conversation:
    """Fetch conversation and assert ownership."""
    conv = (
        db.query(Conversation)
        .filter(
            Conversation.id == conversation_id,
            Conversation.user_id == user.id
        )
        .first()
    )
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conv


def _build_history(conv: Conversation) -> list[dict]:
    """Return the last HISTORY_TURNS pairs as Groq-formatted messages."""
    # Take the last N*2 messages (each turn = 1 user + 1 assistant msg)
    recent = conv.messages[-(HISTORY_TURNS * 2):]
    return [{"role": m.role, "content": m.content} for m in recent]


def _auto_title(conv: Conversation, question: str, db: Session):
    """Set title from first question if still at the placeholder."""
    if conv.title == "New conversation":
        conv.title = question[:60] + ("…" if len(question) > 60 else "")
        db.add(conv)
        db.flush()


@router.post("/")
async def query_documents(
    payload: QueryRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if not payload.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty")

    # ── 1. Validate conversation ownership ───────────────────────────────────
    conv = _get_conversation(payload.conversation_id, current_user, db)

    # ── 2. Auto-title from first question ────────────────────────────────────
    _auto_title(conv, payload.question.strip(), db)

    # ── 3. Retrieve relevant chunks (tenant-scoped) ──────────────────────────
    chunks = retrieve_chunks(
        question=payload.question,
        tenant_id=current_user.tenant_id,
        db=db
    )

    if not chunks:
        raise HTTPException(
            status_code=404,
            detail="No relevant documents found. Upload documents first."
        )

    # ── 4. Assemble context ──────────────────────────────────────────────────
    context = assemble_context(chunks)

    # ── 5. Save the user's message to DB ────────────────────────────────────
    user_msg = ConversationMessage(
        conversation_id=conv.id,
        role="user",
        content=payload.question.strip(),
    )
    db.add(user_msg)
    db.flush()

    # ── 6. Build full message list for Groq ──────────────────────────────────
    history = _build_history(conv)
    # Remove the just-saved user turn from history (it was added above)
    history = [m for m in history if m["content"] != payload.question.strip() or m["role"] != "user"]

    groq_messages = (
        [{"role": "system", "content": SYSTEM_PROMPT}]
        + history
        + [{"role": "user", "content": f"Context:\n{context}\n\nQuestion: {payload.question}"}]
    )

    client = get_groq_client()

    # ── 7a. Streaming path ────────────────────────────────────────────────────
    if payload.stream:
        # We collect the full text so we can save it after streaming finishes
        collected: list[str] = []

        def generate():
            citations = [
                {
                    "id": c["id"],
                    "filename": c["filename"],
                    "chunk_index": c["chunk_index"],
                    "similarity": c["similarity"]
                }
                for c in chunks
            ]
            yield f"data: {json.dumps({'type': 'citations', 'data': citations})}\n\n"

            stream = client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=groq_messages,
                stream=True,
                temperature=0.1,
                max_tokens=1024
            )

            for chunk in stream:
                delta = chunk.choices[0].delta.content
                if delta:
                    collected.append(delta)
                    yield f"data: {json.dumps({'type': 'token', 'data': delta})}\n\n"

            # Save the complete assistant reply to DB
            full_reply = "".join(collected)
            assistant_msg = ConversationMessage(
                conversation_id=conv.id,
                role="assistant",
                content=full_reply,
            )
            db.add(assistant_msg)
            # Bump updated_at so sidebar re-sorts
            conv.updated_at = datetime.utcnow()
            db.add(conv)
            db.commit()

            yield f"data: {json.dumps({'type': 'done'})}\n\n"

        return StreamingResponse(
            generate(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no"
            }
        )

    # ── 7b. Non-streaming path ────────────────────────────────────────────────
    else:
        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=groq_messages,
            stream=False,
            temperature=0.1,
            max_tokens=1024
        )
        answer = response.choices[0].message.content

        # Save both messages
        assistant_msg = ConversationMessage(
            conversation_id=conv.id,
            role="assistant",
            content=answer,
        )
        db.add(assistant_msg)
        conv.updated_at = datetime.utcnow()
        db.add(conv)
        db.commit()

        return {
            "answer": answer,
            "citations": [
                {
                    "filename": c["filename"],
                    "chunk_index": c["chunk_index"],
                    "similarity": c["similarity"]
                }
                for c in chunks
            ],
            "question": payload.question,
            "conversation_id": conv.id,
        }