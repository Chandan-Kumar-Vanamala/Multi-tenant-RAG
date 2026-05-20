from sqlalchemy.orm import Session
from sqlalchemy import text
from app.models.models import DocumentChunk
from app.services.embeddings import embed_text

TOP_K = 5  # number of chunks to retrieve

def retrieve_chunks(
    question: str,
    tenant_id: str,
    db: Session
) -> list[dict]:
    # Embed the question using the same model as ingestion
    question_embedding = embed_text(question)

    # Vector similarity search — filtered by tenant_id at SQL level
    # <=> is the pgvector cosine distance operator
    results = db.execute(
        text("""
            SELECT
                dc.id,
                dc.content,
                dc.chunk_index,
                dc.document_id,
                d.filename,
                1 - (dc.embedding <=> CAST(:embedding AS vector)) AS similarity
            FROM document_chunks dc
            JOIN documents d ON dc.document_id = d.id
            WHERE dc.tenant_id = :tenant_id
            ORDER BY dc.embedding <=> CAST(:embedding AS vector)
            LIMIT :top_k
        """),
        {
            "embedding": str(question_embedding),
            "tenant_id": tenant_id,
            "top_k": TOP_K
        }
    ).fetchall()

    return [
        {
            "id": str(row.id),
            "content": row.content,
            "chunk_index": row.chunk_index,
            "document_id": str(row.document_id),
            "filename": row.filename,
            "similarity": round(float(row.similarity), 4)
        }
        for row in results
    ]


def assemble_context(chunks: list[dict]) -> str:
    # Format chunks into a context string for the LLM
    parts = []
    for i, chunk in enumerate(chunks):
        parts.append(
            f"[Source {i+1}: {chunk['filename']}, chunk {chunk['chunk_index']}]\n"
            f"{chunk['content']}"
        )
    return "\n\n---\n\n".join(parts)