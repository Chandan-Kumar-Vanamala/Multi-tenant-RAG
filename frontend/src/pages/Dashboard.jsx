import { useState, useRef, useEffect } from 'react'
import axios from 'axios'

const s = {
    app: { display: 'flex', height: '100vh', overflow: 'hidden' },
    sidebar: { width: '260px', background: '#111', borderRight: '1px solid #222', display: 'flex', flexDirection: 'column', padding: '1.5rem 1rem' },
    sideTitle: { fontWeight: 'bold', fontSize: '1rem', color: '#fff', marginBottom: '1.5rem', paddingLeft: '0.5rem' },
    uploadBtn: { background: '#2563eb', border: 'none', color: '#fff', padding: '0.6rem', borderRadius: '8px', cursor: 'pointer', marginBottom: '1rem', fontWeight: '600' },
    fileInput: { display: 'none' },
    docList: { flex: 1, overflowY: 'auto' },
    docItem: { padding: '0.5rem', borderRadius: '6px', fontSize: '0.8rem', color: '#aaa', marginBottom: '0.3rem', background: '#1a1a1a', wordBreak: 'break-all' },
    logoutBtn: { background: 'none', border: '1px solid #333', color: '#666', padding: '0.5rem', borderRadius: '6px', cursor: 'pointer', marginTop: '1rem' },
    main: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
    messages: { flex: 1, overflowY: 'auto', padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' },
    userMsg: { alignSelf: 'flex-end', background: '#2563eb', color: '#fff', padding: '0.75rem 1rem', borderRadius: '12px 12px 2px 12px', maxWidth: '70%', fontSize: '0.95rem' },
    botMsg: { alignSelf: 'flex-start', background: '#1a1a1a', border: '1px solid #222', padding: '0.75rem 1rem', borderRadius: '12px 12px 12px 2px', maxWidth: '75%', fontSize: '0.95rem', lineHeight: '1.6', whiteSpace: 'pre-wrap' },
    citations: { marginTop: '0.75rem', display: 'flex', flexWrap: 'wrap', gap: '0.4rem' },
    cite: { background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: '4px', padding: '0.2rem 0.5rem', fontSize: '0.75rem', color: '#60a5fa' },
    inputRow: { padding: '1rem 2rem', borderTop: '1px solid #1a1a1a', display: 'flex', gap: '0.75rem' },
    input: { flex: 1, background: '#1a1a1a', border: '1px solid #333', borderRadius: '8px', padding: '0.7rem 1rem', color: '#fff', fontSize: '0.95rem' },
    sendBtn: { background: '#2563eb', border: 'none', color: '#fff', padding: '0.7rem 1.5rem', borderRadius: '8px', cursor: 'pointer', fontWeight: '600' },
    empty: { textAlign: 'center', color: '#444', marginTop: '4rem' }
}

export default function Dashboard({ token, onLogout }) {
    const [docs, setDocs] = useState([])
    const [messages, setMessages] = useState([])
    const [input, setInput] = useState('')
    const [loading, setLoading] = useState(false)
    const fileRef = useRef()
    const bottomRef = useRef()

    const headers = { Authorization: `Bearer ${token}` }

    useEffect(() => { loadDocs() }, [])
    useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

    const loadDocs = async () => {
        try {
            const res = await axios.get('/documents/', { headers })
            setDocs(res.data)
        } catch { }
    }

    const uploadFile = async (e) => {
        const file = e.target.files[0]
        if (!file) return
        const form = new FormData()
        form.append('file', file)
        try {
            await axios.post('/documents/upload', form, { headers })
            loadDocs()
        } catch (err) {
            alert(err.response?.data?.detail || 'Upload failed')
        }
    }

    const sendMessage = async () => {
        if (!input.trim() || loading) return
        const question = input.trim()
        setInput('')
        setMessages(m => [...m, { role: 'user', content: question }])
        setLoading(true)

        const botIndex = messages.length + 1
        setMessages(m => [...m, { role: 'bot', content: '', citations: [] }])

        try {
            const res = await fetch('/query/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ question, stream: true })
            })

            const reader = res.body.getReader()
            const decoder = new TextDecoder()
            let citations = []

            while (true) {
                const { done, value } = await reader.read()
                if (done) break
                const lines = decoder.decode(value).split('\n')
                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue
                    const data = JSON.parse(line.slice(6))
                    if (data.type === 'citations') {
                        citations = data.data
                        setMessages(m => m.map((msg, i) =>
                            i === botIndex ? { ...msg, citations } : msg
                        ))
                    } else if (data.type === 'token') {
                        setMessages(m => m.map((msg, i) =>
                            i === botIndex ? { ...msg, content: msg.content + data.data } : msg
                        ))
                    }
                }
            }
        } catch {
            setMessages(m => m.map((msg, i) =>
                i === botIndex ? { ...msg, content: 'Error getting response.' } : msg
            ))
        } finally {
            setLoading(false)
        }
    }

    return (
        <div style={s.app}>
            <div style={s.sidebar}>
                <div style={s.sideTitle}>📄 RAG Platform</div>
                <input ref={fileRef} style={s.fileInput} type="file" accept=".pdf" onChange={uploadFile} />
                <button style={s.uploadBtn} onClick={() => fileRef.current.click()}>+ Upload PDF</button>
                <div style={s.docList}>
                    {docs.map(d => <div key={d.id} style={s.docItem}>📎 {d.filename}</div>)}
                </div>
                <button style={s.logoutBtn} onClick={onLogout}>Sign out</button>
            </div>
            <div style={s.main}>
                <div style={s.messages}>
                    {messages.length === 0 && (
                        <div style={s.empty}>Upload a PDF and ask a question</div>
                    )}
                    {messages.map((msg, i) => (
                        <div key={i} style={msg.role === 'user' ? s.userMsg : s.botMsg}>
                            {msg.content || (loading && i === messages.length - 1 ? '...' : '')}
                            {msg.citations?.length > 0 && (
                                <div style={s.citations}>
                                    {msg.citations.map((c, j) => (
                                        <span key={j} style={s.cite}>
                                            {c.filename} · chunk {c.chunk_index} · {c.similarity}
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>
                    ))}
                    <div ref={bottomRef} />
                </div>
                <div style={s.inputRow}>
                    <input
                        style={s.input}
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && sendMessage()}
                        placeholder="Ask a question about your documents..."
                    />
                    <button style={s.sendBtn} onClick={sendMessage} disabled={loading}>
                        {loading ? '...' : 'Send'}
                    </button>
                </div>
            </div>
        </div>
    )
}