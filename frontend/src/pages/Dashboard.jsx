import { useState, useRef, useEffect, useCallback } from 'react'
import axios from 'axios'
import ReactMarkdown from 'react-markdown'
import '../App.css'

/* ── Toast system ─────────────────────────────────────────────────────────── */
function useToast() {
    const [toasts, setToasts] = useState([])
    const add = useCallback((msg, type = 'info') => {
        const id = Date.now()
        setToasts(t => [...t, { id, msg, type }])
        setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500)
    }, [])
    return { toasts, add }
}

/* ── Time formatting ──────────────────────────────────────────────────────── */
function relativeTime(iso) {
    const diff = Date.now() - new Date(iso).getTime()
    const m = Math.floor(diff / 60000)
    if (m < 1) return 'just now'
    if (m < 60) return `${m}m ago`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h}h ago`
    return `${Math.floor(h / 24)}d ago`
}

/* ── Similarity bar color ─────────────────────────────────────────────────── */
function simColor(sim) {
    if (sim >= 0.85) return 'var(--success)'
    if (sim >= 0.65) return 'var(--accent-blue)'
    return 'var(--text-muted)'
}

/* ── Suggested questions ──────────────────────────────────────────────────── */
const SUGGESTIONS = [
    'What are the main topics covered in my documents?',
    'Summarise the key findings from the uploaded files.',
    'What are the most important dates or deadlines mentioned?',
]

export default function Dashboard({ token, onLogout }) {
    // Conversations
    const [conversations, setConversations] = useState([])
    const [activeConvId, setActiveConvId] = useState(null)
    const [deletingConvId, setDeletingConvId] = useState(null)

    // Documents
    const [docs, setDocs] = useState([])
    const [docsOpen, setDocsOpen] = useState(true)
    const [uploading, setUploading] = useState(false)
    const [dragging, setDragging] = useState(false)
    const [deletingDocId, setDeletingDocId] = useState(null)

    // Chat
    const [messages, setMessages] = useState([])
    const [input, setInput] = useState('')
    const [loading, setLoading] = useState(false)

    const fileRef = useRef()
    const bottomRef = useRef()
    const inputRef = useRef()
    const { toasts, add: toast } = useToast()

    const headers = { Authorization: `Bearer ${token}` }

    /* ── Bootstrap ────────────────────────────────────────────────────────── */
    useEffect(() => {
        loadConversations()
        loadDocs()
    }, [])

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages])

    /* ── Conversations ────────────────────────────────────────────────────── */
    const loadConversations = async () => {
        try {
            const res = await axios.get('/conversations/', { headers })
            const data = Array.isArray(res.data) ? res.data : []
            setConversations(data)
            // Auto-select most recent or create a fresh one
            if (data.length > 0) {
                await switchConversation(data[0].id)
            } else {
                await createConversation()
            }
        } catch {
            toast('Failed to load conversations', 'error')
        }
    }

    const createConversation = async () => {
        try {
            const res = await axios.post('/conversations/', {}, { headers })
            const newConv = res.data
            setConversations(prev => (Array.isArray(prev) ? [newConv, ...prev] : [newConv]))
            setActiveConvId(newConv.id)
            setMessages([])
            return newConv.id
        } catch {
            toast('Failed to create conversation', 'error')
        }
    }

    const switchConversation = async (convId) => {
        if (convId === activeConvId) return
        setActiveConvId(convId)
        try {
            const res = await axios.get(`/conversations/${convId}/messages`, { headers })
            // Re-hydrate messages into UI format
            const loaded = []
            for (const m of res.data) {
                if (m.role === 'user') {
                    loaded.push({ role: 'user', content: m.content })
                } else {
                    loaded.push({ role: 'bot', content: m.content, citations: [] })
                }
            }
            setMessages(loaded)
        } catch {
            toast('Failed to load conversation messages', 'error')
        }
    }

    const deleteConversation = async (conv, e) => {
        e.stopPropagation()
        setDeletingConvId(conv.id)
        try {
            await axios.delete(`/conversations/${conv.id}`, { headers })
            const remaining = conversations.filter(c => c.id !== conv.id)
            setConversations(remaining)
            if (activeConvId === conv.id) {
                if (remaining.length > 0) {
                    await switchConversation(remaining[0].id)
                } else {
                    await createConversation()
                }
            }
            toast('Conversation deleted', 'info')
        } catch {
            toast('Failed to delete conversation', 'error')
        } finally {
            setDeletingConvId(null)
        }
    }

    /* ── Documents ────────────────────────────────────────────────────────── */
    const loadDocs = async () => {
        try {
            const res = await axios.get('/documents/', { headers })
            setDocs(res.data)
        } catch { }
    }

    const handleUpload = async (file) => {
        if (!file) return
        if (file.type !== 'application/pdf') { toast('Only PDF files are supported', 'error'); return }
        if (file.size > 10 * 1024 * 1024) { toast('File must be under 10 MB', 'error'); return }
        setUploading(true)
        const form = new FormData()
        form.append('file', file)
        try {
            await axios.post('/documents/upload', form, { headers })
            toast(`"${file.name}" uploaded`, 'success')
            await loadDocs()
        } catch (err) {
            toast(err.response?.data?.detail || 'Upload failed', 'error')
        } finally {
            setUploading(false)
            if (fileRef.current) fileRef.current.value = ''
        }
    }

    const deleteDoc = async (doc) => {
        setDeletingDocId(doc.id)
        try {
            await axios.delete(`/documents/${doc.id}`, { headers })
            setDocs(d => d.filter(x => x.id !== doc.id))
            toast(`"${doc.filename}" deleted`, 'info')
        } catch (err) {
            toast(err.response?.data?.detail || 'Delete failed', 'error')
        } finally {
            setDeletingDocId(null)
        }
    }

    /* ── Drag & drop ──────────────────────────────────────────────────────── */
    const onDragOver = (e) => { e.preventDefault(); setDragging(true) }
    const onDragLeave = () => setDragging(false)
    const onDrop = (e) => { e.preventDefault(); setDragging(false); handleUpload(e.dataTransfer.files[0]) }

    /* ── Chat ─────────────────────────────────────────────────────────────── */
    const sendMessage = async (question) => {
        const q = (question ?? input).trim()
        if (!q || loading) return

        // Ensure we have a conversation
        let convId = activeConvId
        if (!convId) {
            convId = await createConversation()
            if (!convId) return
        }

        setInput('')
        setMessages(m => [...m, { role: 'user', content: q }])
        setLoading(true)

        const botIdx = messages.length + 1
        setMessages(m => [...m, { role: 'bot', content: '', citations: [], typing: true }])

        try {
            const res = await fetch('/query/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ question: q, conversation_id: convId, stream: true })
            })

            if (!res.ok) {
                const data = await res.json().catch(() => ({}))
                const msg = data.detail || `Error ${res.status}`
                setMessages(m => m.map((x, i) => i === botIdx ? { ...x, content: msg, typing: false } : x))
                toast(msg, 'error')
                return
            }

            const reader = res.body.getReader()
            const decoder = new TextDecoder()
            let buffer = ''

            while (true) {
                const { done, value } = await reader.read()
                if (done) break
                buffer += decoder.decode(value, { stream: true })
                const lines = buffer.split('\n')
                buffer = lines.pop()

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue
                    try {
                        const data = JSON.parse(line.slice(6))
                        if (data.type === 'citations') {
                            setMessages(m => m.map((x, i) =>
                                i === botIdx ? { ...x, citations: data.data, typing: false } : x
                            ))
                        } else if (data.type === 'token') {
                            setMessages(m => m.map((x, i) =>
                                i === botIdx ? { ...x, content: x.content + data.data, typing: false } : x
                            ))
                        } else if (data.type === 'done') {
                            // Refresh conversation list so title + updated_at update
                            const updated = await axios.get('/conversations/', { headers })
                            setConversations(updated.data)
                        }
                    } catch { /* ignore partial JSON */ }
                }
            }
        } catch {
            setMessages(m => m.map((x, i) =>
                i === botIdx ? { ...x, content: 'Failed to get a response. Is the server running?', typing: false } : x
            ))
            toast('Connection error', 'error')
        } finally {
            setLoading(false)
            inputRef.current?.focus()
        }
    }

    /* ── Active conversation title ────────────────────────────────────────── */
    const activeConv = Array.isArray(conversations)
        ? conversations.find(c => c.id === activeConvId)
        : undefined

    /* ── Render ───────────────────────────────────────────────────────────── */
    return (
        <div className="dash-root">

            {/* Toasts */}
            <div className="toast-container">
                {toasts.map(t => (
                    <div key={t.id} className={`toast ${t.type}`}>
                        <span>{t.type === 'success' ? '✓' : t.type === 'error' ? '✕' : 'ℹ'}</span>
                        {t.msg}
                    </div>
                ))}
            </div>

            {/* ── Sidebar ─────────────────────────────────────────────────── */}
            <aside className="dash-sidebar">
                {/* Brand */}
                <div className="dash-brand">
                    <div className="dash-brand-icon">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
                                stroke="url(#dg)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            <defs>
                                <linearGradient id="dg" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
                                    <stop stopColor="#3b82f6" /><stop offset="1" stopColor="#8b5cf6" />
                                </linearGradient>
                            </defs>
                        </svg>
                    </div>
                    <span className="dash-brand-name">DocMind</span>
                </div>

                {/* New chat button */}
                <button
                    className="btn-primary new-chat-btn"
                    onClick={createConversation}
                    disabled={loading}
                >
                    <span style={{ fontSize: '1rem', lineHeight: 1 }}>＋</span> New Chat
                </button>

                {/* Conversations list */}
                <div className="sidebar-section-label" style={{ marginBottom: '0.4rem' }}>
                    Conversations
                    <span className="badge" style={{ marginLeft: '0.4rem' }}>{conversations.length}</span>
                </div>

                <div className="conv-list">
                    {conversations.length === 0 ? (
                        <div className="doc-empty">No conversations yet</div>
                    ) : conversations.map(conv => (
                        <div
                            key={conv.id}
                            className={`conv-item ${conv.id === activeConvId ? 'active' : ''}`}
                            onClick={() => switchConversation(conv.id)}
                        >
                            <div className="conv-item-body">
                                <div className="conv-item-title" title={conv.title}>{conv.title}</div>
                                <div className="conv-item-time">{relativeTime(conv.updated_at)}</div>
                            </div>
                            <button
                                className="doc-delete-btn"
                                onClick={(e) => deleteConversation(conv, e)}
                                disabled={deletingConvId === conv.id}
                                title="Delete conversation"
                            >
                                {deletingConvId === conv.id
                                    ? <span className="spinner" style={{ width: 11, height: 11 }} />
                                    : '✕'}
                            </button>
                        </div>
                    ))}
                </div>

                {/* Documents section (collapsible) */}
                <div className="docs-section">
                    <button
                        className="docs-toggle"
                        onClick={() => setDocsOpen(o => !o)}
                    >
                        <span className="sidebar-section-label" style={{ margin: 0 }}>
                            Documents
                            <span className="badge" style={{ marginLeft: '0.4rem' }}>{docs.length}</span>
                        </span>
                        <span className="docs-chevron">{docsOpen ? '▾' : '▸'}</span>
                    </button>

                    {docsOpen && (
                        <div className="docs-body">
                            {/* Upload zone */}
                            <div
                                className={`upload-zone ${dragging ? 'dragging' : ''} ${uploading ? 'uploading' : ''}`}
                                onDragOver={onDragOver}
                                onDragLeave={onDragLeave}
                                onDrop={onDrop}
                                onClick={() => !uploading && fileRef.current?.click()}
                            >
                                <input ref={fileRef} type="file" accept=".pdf" style={{ display: 'none' }}
                                    onChange={e => handleUpload(e.target.files[0])} />
                                {uploading ? (
                                    <><span className="spinner" style={{ borderTopColor: 'var(--accent-blue)' }} /><span>Uploading…</span></>
                                ) : (
                                    <>
                                        <span className="upload-icon">⬆</span>
                                        <span className="upload-label">{dragging ? 'Drop to upload' : 'Upload PDF'}</span>
                                        <span className="upload-hint">drag & drop · max 10 MB</span>
                                    </>
                                )}
                            </div>

                            <div className="doc-list" style={{ maxHeight: '160px' }}>
                                {docs.length === 0
                                    ? <div className="doc-empty">No documents yet</div>
                                    : docs.map(doc => (
                                        <div key={doc.id} className="doc-item">
                                            <div className="doc-item-icon">📄</div>
                                            <div className="doc-item-info">
                                                <div className="doc-item-name" title={doc.filename}>{doc.filename}</div>
                                                <div className="doc-item-date">
                                                    {new Date(doc.uploaded_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                                </div>
                                            </div>
                                            <button
                                                className="doc-delete-btn"
                                                onClick={() => deleteDoc(doc)}
                                                disabled={deletingDocId === doc.id}
                                                title="Delete"
                                            >
                                                {deletingDocId === doc.id
                                                    ? <span className="spinner" style={{ width: 11, height: 11 }} />
                                                    : '✕'}
                                            </button>
                                        </div>
                                    ))
                                }
                            </div>
                        </div>
                    )}
                </div>

                {/* Logout */}
                <button className="btn-ghost dash-logout" onClick={onLogout}>
                    <span>⎋</span> Sign out
                </button>
            </aside>

            {/* ── Main chat area ───────────────────────────────────────────── */}
            <main className="dash-main">
                {/* Chat header showing conversation title */}
                {activeConv && (
                    <div className="chat-header">
                        <div className="chat-header-title">{activeConv.title}</div>
                    </div>
                )}

                <div className="dash-messages">
                    {messages.length === 0 ? (
                        <div className="dash-empty">
                            <div className="dash-empty-icon">🔍</div>
                            <h2 className="dash-empty-title">Ask your documents anything</h2>
                            <p className="dash-empty-sub">Upload a PDF, then try one of these:</p>
                            <div className="dash-suggestions">
                                {SUGGESTIONS.map((s, i) => (
                                    <button key={i} className="suggestion-chip" onClick={() => sendMessage(s)}>
                                        {s}
                                    </button>
                                ))}
                            </div>
                        </div>
                    ) : (
                        messages.map((msg, i) => (
                            <div
                                key={i}
                                className={`message-row ${msg.role}`}
                                style={{ animation: 'fadeUp 0.25s ease' }}
                            >
                                {msg.role === 'bot' && (
                                    <div className="msg-avatar bot-avatar">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                                            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
                                                stroke="url(#ag)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                            <defs>
                                                <linearGradient id="ag" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
                                                    <stop stopColor="#3b82f6" /><stop offset="1" stopColor="#8b5cf6" />
                                                </linearGradient>
                                            </defs>
                                        </svg>
                                    </div>
                                )}
                                <div className={`message-bubble ${msg.role}`}>
                                    {msg.typing ? (
                                        <div className="typing-dots"><span /><span /><span /></div>
                                    ) : msg.role === 'bot' ? (
                                        <div className="md-content">
                                            <ReactMarkdown>{msg.content || ' '}</ReactMarkdown>
                                        </div>
                                    ) : (
                                        <span>{msg.content}</span>
                                    )}

                                    {msg.citations?.length > 0 && (
                                        <div className="citations">
                                            <div className="citations-label">Sources</div>
                                            {msg.citations.map((c, j) => {
                                                const simPct = Math.round((c.similarity ?? 0) * 100)
                                                return (
                                                    <div key={j} className="citation-card">
                                                        <div className="citation-top">
                                                            <span className="citation-file">📄 {c.filename}</span>
                                                            <span className="citation-chunk">chunk {c.chunk_index}</span>
                                                        </div>
                                                        <div className="citation-sim-row">
                                                            <div className="citation-sim-bar">
                                                                <div className="citation-sim-fill"
                                                                    style={{ width: `${simPct}%`, background: simColor(c.similarity) }} />
                                                            </div>
                                                            <span className="citation-sim-pct" style={{ color: simColor(c.similarity) }}>
                                                                {simPct}%
                                                            </span>
                                                        </div>
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    )}
                                </div>
                                {msg.role === 'user' && (
                                    <div className="msg-avatar user-avatar">U</div>
                                )}
                            </div>
                        ))
                    )}
                    <div ref={bottomRef} />
                </div>

                {/* Input bar */}
                <div className="dash-input-bar">
                    <div className="dash-input-wrap">
                        <input
                            ref={inputRef}
                            className="dash-input"
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
                            placeholder="Ask a question about your documents…"
                            disabled={loading}
                        />
                        <button
                            className="dash-send-btn"
                            onClick={() => sendMessage()}
                            disabled={loading || !input.trim()}
                        >
                            {loading ? <span className="spinner" /> : (
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                                    <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"
                                        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                            )}
                        </button>
                    </div>
                    <div className="dash-input-hint">Press Enter to send · conversations are saved automatically</div>
                </div>
            </main>

            <style>{`
                .dash-root {
                    display: flex;
                    height: 100vh;
                    overflow: hidden;
                    background: var(--bg-base);
                }

                /* ── Sidebar ──────────────────────────────────────────────── */
                .dash-sidebar {
                    width: 272px;
                    flex-shrink: 0;
                    display: flex;
                    flex-direction: column;
                    gap: 0.75rem;
                    background: var(--bg-surface);
                    border-right: 1px solid var(--border-subtle);
                    padding: 1.25rem 1rem;
                    overflow: hidden;
                }
                .dash-brand {
                    display: flex;
                    align-items: center;
                    gap: 0.55rem;
                    padding: 0 0.25rem;
                    margin-bottom: 0.1rem;
                }
                .dash-brand-icon {
                    display: flex; align-items: center; justify-content: center;
                    width: 30px; height: 30px;
                    background: var(--gradient-surface);
                    border: 1px solid var(--border-default);
                    border-radius: var(--radius-sm);
                }
                .dash-brand-name {
                    font-size: 1rem; font-weight: 700;
                    background: var(--gradient-brand);
                    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
                    background-clip: text;
                }
                .new-chat-btn { width: 100%; justify-content: center; gap: 0.4rem; }

                /* Conversation list */
                .conv-list {
                    flex: 1;
                    overflow-y: auto;
                    display: flex;
                    flex-direction: column;
                    gap: 0.3rem;
                    min-height: 0;
                }
                .conv-item {
                    display: flex;
                    align-items: center;
                    gap: 0.4rem;
                    padding: 0.5rem 0.65rem;
                    border-radius: var(--radius-sm);
                    cursor: pointer;
                    border: 1px solid transparent;
                    transition: background var(--transition-fast), border-color var(--transition-fast);
                }
                .conv-item:hover { background: var(--bg-elevated); }
                .conv-item.active {
                    background: rgba(59,130,246,0.1);
                    border-color: rgba(59,130,246,0.25);
                }
                .conv-item-body { flex: 1; min-width: 0; }
                .conv-item-title {
                    font-size: 0.8rem; font-weight: 500;
                    color: var(--text-secondary);
                    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                }
                .conv-item.active .conv-item-title { color: var(--text-primary); }
                .conv-item-time {
                    font-size: 0.68rem; color: var(--text-muted); margin-top: 1px;
                }
                .conv-item .doc-delete-btn { opacity: 0; }
                .conv-item:hover .doc-delete-btn { opacity: 1; }

                /* Documents collapsible */
                .docs-section {
                    border-top: 1px solid var(--border-subtle);
                    padding-top: 0.6rem;
                    display: flex;
                    flex-direction: column;
                    gap: 0.5rem;
                }
                .docs-toggle {
                    display: flex; align-items: center; justify-content: space-between;
                    background: none; border: none; cursor: pointer; width: 100%; padding: 0 0.1rem;
                }
                .docs-chevron { font-size: 0.7rem; color: var(--text-muted); }
                .docs-body { display: flex; flex-direction: column; gap: 0.5rem; }

                /* Upload zone */
                .upload-zone {
                    display: flex; flex-direction: column; align-items: center; gap: 0.25rem;
                    padding: 0.75rem 0.5rem;
                    border: 1.5px dashed var(--border-default);
                    border-radius: var(--radius-md);
                    cursor: pointer;
                    transition: border-color var(--transition-fast), background var(--transition-fast);
                    text-align: center;
                }
                .upload-zone:hover, .upload-zone.dragging { border-color: var(--accent-blue); background: rgba(59,130,246,0.06); }
                .upload-zone.uploading { cursor: default; }
                .upload-icon { font-size: 1.1rem; }
                .upload-label { font-size: 0.8rem; font-weight: 600; color: var(--text-primary); }
                .upload-hint { font-size: 0.68rem; color: var(--text-muted); }

                /* Doc list */
                .doc-list { overflow-y: auto; display: flex; flex-direction: column; gap: 0.35rem; }
                .doc-empty { font-size: 0.78rem; color: var(--text-muted); text-align: center; padding: 0.5rem 0; }
                .doc-item {
                    display: flex; align-items: center; gap: 0.45rem;
                    padding: 0.4rem 0.5rem;
                    border-radius: var(--radius-sm);
                    background: var(--bg-elevated);
                    border: 1px solid transparent;
                    transition: border-color var(--transition-fast);
                }
                .doc-item:hover { border-color: var(--border-subtle); }
                .doc-item-icon { font-size: 0.85rem; flex-shrink: 0; }
                .doc-item-info { flex: 1; min-width: 0; }
                .doc-item-name { font-size: 0.75rem; font-weight: 500; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                .doc-item-date { font-size: 0.65rem; color: var(--text-muted); }
                .doc-delete-btn {
                    flex-shrink: 0; width: 20px; height: 20px;
                    display: flex; align-items: center; justify-content: center;
                    background: none; border: none; color: var(--text-muted);
                    font-size: 0.68rem; cursor: pointer; border-radius: var(--radius-sm);
                    transition: opacity var(--transition-fast), color var(--transition-fast), background var(--transition-fast);
                }
                .doc-item:hover .doc-delete-btn { opacity: 1 !important; }
                .doc-delete-btn:hover { color: var(--error); background: rgba(239,68,68,0.1); }

                .dash-logout { width: 100%; margin-top: auto; }

                /* ── Chat header ──────────────────────────────────────────── */
                .chat-header {
                    padding: 0.85rem 1.5rem;
                    border-bottom: 1px solid var(--border-subtle);
                    background: var(--bg-surface);
                }
                .chat-header-title {
                    font-size: 0.875rem; font-weight: 600;
                    color: var(--text-secondary);
                    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                }

                /* ── Main ─────────────────────────────────────────────────── */
                .dash-main { flex: 1; display: flex; flex-direction: column; overflow: hidden; min-width: 0; }
                .dash-messages {
                    flex: 1; overflow-y: auto; padding: 1.75rem 1.5rem;
                    display: flex; flex-direction: column; gap: 1.2rem;
                }

                /* Empty state */
                .dash-empty {
                    display: flex; flex-direction: column; align-items: center;
                    justify-content: center; flex: 1;
                    text-align: center; padding: 3rem 2rem;
                    animation: fadeIn 0.5s ease;
                }
                .dash-empty-icon { font-size: 2.5rem; margin-bottom: 1rem; opacity: 0.6; }
                .dash-empty-title { font-size: 1.3rem; font-weight: 600; margin-bottom: 0.4rem; }
                .dash-empty-sub { font-size: 0.875rem; color: var(--text-secondary); margin-bottom: 1.4rem; }
                .dash-suggestions { display: flex; flex-direction: column; gap: 0.55rem; width: 100%; max-width: 480px; }
                .suggestion-chip {
                    padding: 0.65rem 1rem;
                    background: var(--bg-elevated);
                    border: 1px solid var(--border-default);
                    border-radius: var(--radius-md);
                    color: var(--text-secondary);
                    font-family: inherit; font-size: 0.85rem; text-align: left; cursor: pointer;
                    transition: border-color var(--transition-fast), color var(--transition-fast), background var(--transition-fast);
                }
                .suggestion-chip:hover { border-color: var(--accent-blue); color: var(--text-primary); background: rgba(59,130,246,0.06); }

                /* Message rows */
                .message-row { display: flex; align-items: flex-start; gap: 0.7rem; max-width: 820px; }
                .message-row.user { flex-direction: row-reverse; align-self: flex-end; }
                .message-row.bot { align-self: flex-start; }
                .msg-avatar {
                    flex-shrink: 0; width: 28px; height: 28px; border-radius: 50%;
                    display: flex; align-items: center; justify-content: center;
                    font-size: 0.72rem; font-weight: 700; margin-top: 2px;
                }
                .bot-avatar { background: var(--gradient-surface); border: 1px solid var(--border-default); }
                .user-avatar { background: var(--gradient-brand); color: #fff; }
                .message-bubble {
                    padding: 0.75rem 0.95rem;
                    border-radius: var(--radius-lg);
                    font-size: 0.9rem; line-height: 1.65; max-width: 100%;
                }
                .message-bubble.user {
                    background: var(--gradient-brand); color: #fff;
                    border-radius: var(--radius-lg) var(--radius-lg) var(--radius-sm) var(--radius-lg);
                }
                .message-bubble.bot {
                    background: var(--bg-elevated); border: 1px solid var(--border-subtle); color: var(--text-primary);
                    border-radius: var(--radius-sm) var(--radius-lg) var(--radius-lg) var(--radius-lg);
                }

                /* Citations */
                .citations { margin-top: 0.8rem; padding-top: 0.7rem; border-top: 1px solid var(--border-subtle); display: flex; flex-direction: column; gap: 0.4rem; }
                .citations-label { font-size: 0.68rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); margin-bottom: 0.1rem; }
                .citation-card { background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: 0.4rem 0.55rem; display: flex; flex-direction: column; gap: 0.3rem; }
                .citation-top { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
                .citation-file { font-size: 0.73rem; color: var(--text-secondary); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                .citation-chunk { font-size: 0.65rem; color: var(--text-muted); flex-shrink: 0; }
                .citation-sim-row { display: flex; align-items: center; gap: 0.45rem; }
                .citation-sim-bar { flex: 1; height: 3px; background: var(--border-subtle); border-radius: var(--radius-full); overflow: hidden; }
                .citation-sim-fill { height: 100%; border-radius: var(--radius-full); transition: width 0.6s ease; }
                .citation-sim-pct { font-size: 0.65rem; font-weight: 600; flex-shrink: 0; }

                /* ── Input bar ────────────────────────────────────────────── */
                .dash-input-bar {
                    padding: 1rem 1.5rem 1.25rem;
                    border-top: 1px solid var(--border-subtle);
                    background: var(--bg-surface);
                    display: flex; flex-direction: column; gap: 0.35rem;
                }
                .dash-input-wrap {
                    display: flex; align-items: center; gap: 0.6rem;
                    background: var(--bg-elevated);
                    border: 1px solid var(--border-default);
                    border-radius: var(--radius-xl);
                    padding: 0.45rem 0.45rem 0.45rem 1.1rem;
                    transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
                }
                .dash-input-wrap:focus-within { border-color: var(--accent-blue); box-shadow: 0 0 0 3px var(--accent-blue-glow); }
                .dash-input { flex: 1; background: none; border: none; outline: none; color: var(--text-primary); font-family: inherit; font-size: 0.9rem; }
                .dash-input::placeholder { color: var(--text-muted); }
                .dash-input:disabled { opacity: 0.5; }
                .dash-send-btn {
                    display: flex; align-items: center; justify-content: center;
                    width: 36px; height: 36px;
                    background: var(--gradient-brand); border: none; border-radius: 50%;
                    color: #fff; cursor: pointer; flex-shrink: 0;
                    transition: opacity var(--transition-fast), transform var(--transition-fast);
                }
                .dash-send-btn:hover:not(:disabled) { opacity: 0.85; transform: scale(1.05); }
                .dash-send-btn:disabled { opacity: 0.35; cursor: not-allowed; }
                .dash-input-hint { font-size: 0.68rem; color: var(--text-muted); text-align: center; }
            `}</style>
        </div>
    )
}