from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
from groq import Groq
import json

from app.core.database import get_db
from app.core.config import settings
from app.api.auth import get_current_user
from app.models.models import User
from app.services.retrieval import retrieve_chunks, assemble_context

router = APIRouter(prefix="/query", tags=["query"])

SYSTEM_PROMPT = """You are a helpful assistant that answers questions based strictly on the provided context.

Rules:
- Only use information from the provided context to answer
- If the context doesn't contain enough information, say so clearly
- Be concise and accurate
- Reference the source when relevant (e.g. "According to Source 1...")
- Never make up information not in the context"""


def get_groq_client() -> Groq:
    return Groq(api_key=settings.GROQ_API_KEY)


class QueryRequest(BaseModel):
    question: str
    stream: bool = True


@router.post("/")
async def query_documents(
    payload: QueryRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if not payload.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty")

    # Step 1: Retrieve relevant chunks (tenant-scoped)
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

    # Step 2: Assemble context
    context = assemble_context(chunks)

    # Step 3: Build messages
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {
            "role": "user",
            "content": f"Context:\n{context}\n\nQuestion: {payload.question}"
        }
    ]

    # Step 4: Call Groq with streaming
    client = get_groq_client()

    if payload.stream:
        def generate():
            # First yield the citations as a metadata chunk
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

            # Then stream the answer token by token
            stream = client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=messages,
                stream=True,
                temperature=0.1,  # low temp = more factual, less creative
                max_tokens=1024
            )

            for chunk in stream:
                delta = chunk.choices[0].delta.content
                if delta:
                    yield f"data: {json.dumps({'type': 'token', 'data': delta})}\n\n"

            yield f"data: {json.dumps({'type': 'done'})}\n\n"

        return StreamingResponse(
            generate(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no"
            }
        )

    else:
        # Non-streaming version (easier to test in Swagger)
        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=messages,
            stream=False,
            temperature=0.1,
            max_tokens=1024
        )
        return {
            "answer": response.choices[0].message.content,
            "citations": [
                {
                    "filename": c["filename"],
                    "chunk_index": c["chunk_index"],
                    "similarity": c["similarity"]
                }
                for c in chunks
            ],
            "question": payload.question
        }