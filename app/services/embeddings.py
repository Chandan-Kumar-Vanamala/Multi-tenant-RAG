from fastembed import TextEmbedding
from app.core.config import settings

# Load once at startup — not on every request
_model = None

def get_embedding_model() -> TextEmbedding:
    global _model
    if _model is None:
        print(f"Loading embedding model: {settings.EMBEDDING_MODEL}")
        _model = TextEmbedding(model_name=settings.EMBEDDING_MODEL)
        print("Embedding model loaded.")
    return _model

def embed_text(text: str) -> list[float]:
    model = get_embedding_model()
    embeddings = list(model.embed([text]))
    return embeddings[0].tolist()

def embed_texts(texts: list[str]) -> list[list[float]]:
    model = get_embedding_model()
    embeddings = list(model.embed(texts))
    return [e.tolist() for e in embeddings]