from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.core.database import get_db
from app.api.auth import get_current_user
from app.models.models import User, Conversation, ConversationMessage

router = APIRouter(prefix="/conversations", tags=["conversations"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class ConversationOut(BaseModel):
    id: str
    title: str
    created_at: str
    updated_at: str

    class Config:
        from_attributes = True


class MessageOut(BaseModel):
    id: str
    role: str
    content: str
    created_at: str

    class Config:
        from_attributes = True


# ── Helpers ───────────────────────────────────────────────────────────────────

def _own_conversation(conversation_id: str, user: User, db: Session) -> Conversation:
    """Return conversation if it belongs to this user, else raise 404."""
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


def _fmt(conv: Conversation) -> dict:
    return {
        "id": conv.id,
        "title": conv.title,
        "created_at": conv.created_at.isoformat(),
        "updated_at": conv.updated_at.isoformat(),
    }


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/", status_code=201)
def create_conversation(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a blank conversation. The title is set to a placeholder until
    the first message auto-updates it."""
    conv = Conversation(
        user_id=current_user.id,
        tenant_id=current_user.tenant_id,
        title="New conversation",
    )
    db.add(conv)
    db.commit()
    db.refresh(conv)
    return _fmt(conv)


@router.get("/")
def list_conversations(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List conversations for the current user, newest-active first."""
    convs = (
        db.query(Conversation)
        .filter(Conversation.user_id == current_user.id)
        .order_by(Conversation.updated_at.desc())
        .all()
    )
    return [_fmt(c) for c in convs]


@router.get("/{conversation_id}/messages")
def get_messages(
    conversation_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return all messages in a conversation (oldest first)."""
    conv = _own_conversation(conversation_id, current_user, db)
    return [
        {
            "id": m.id,
            "role": m.role,
            "content": m.content,
            "created_at": m.created_at.isoformat(),
        }
        for m in conv.messages
    ]


@router.delete("/{conversation_id}", status_code=200)
def delete_conversation(
    conversation_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a conversation and all its messages (cascade handled by ORM)."""
    conv = _own_conversation(conversation_id, current_user, db)
    db.delete(conv)
    db.commit()
    return {"deleted": conversation_id}
