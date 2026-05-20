import { useState } from 'react'
import axios from 'axios'

const s = {
    container: { display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' },
    card: { background: '#1a1a1a', padding: '2rem', borderRadius: '12px', width: '100%', maxWidth: '400px', border: '1px solid #333' },
    title: { fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '0.5rem', color: '#fff' },
    sub: { color: '#888', marginBottom: '2rem', fontSize: '0.9rem' },
    label: { display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', color: '#aaa' },
    input: { width: '100%', padding: '0.6rem 0.8rem', background: '#111', border: '1px solid #333', borderRadius: '6px', color: '#fff', marginBottom: '1rem', fontSize: '0.95rem' },
    btn: { width: '100%', padding: '0.7rem', background: '#2563eb', border: 'none', borderRadius: '6px', color: '#fff', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.95rem' },
    toggle: { textAlign: 'center', marginTop: '1rem', color: '#888', fontSize: '0.85rem', cursor: 'pointer' },
    error: { color: '#f87171', fontSize: '0.85rem', marginBottom: '1rem' }
}

export default function Login({ onLogin }) {
    const [mode, setMode] = useState('login')
    const [form, setForm] = useState({ tenant_name: '', email: '', password: '' })
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)

    const handle = (e) => setForm({ ...form, [e.target.name]: e.target.value })

    const submit = async () => {
        setError(''); setLoading(true)
        try {
            if (mode === 'register') {
                await axios.post('/auth/register', form)
                setMode('login')
                setError('Registered! Please log in.')
            } else {
                const params = new URLSearchParams()
                params.append('username', form.email)
                params.append('password', form.password)
                const res = await axios.post('/auth/login', params)
                onLogin(res.data.access_token)
            }
        } catch (e) {
            setError(e.response?.data?.detail || 'Something went wrong')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div style={s.container}>
            <div style={s.card}>
                <div style={s.title}>RAG Platform</div>
                <div style={s.sub}>{mode === 'login' ? 'Sign in to your workspace' : 'Create a new workspace'}</div>
                {error && <div style={s.error}>{error}</div>}
                {mode === 'register' && (
                    <>
                        <label style={s.label}>Workspace name</label>
                        <input style={s.input} name="tenant_name" placeholder="acme-corp" onChange={handle} />
                    </>
                )}
                <label style={s.label}>Email</label>
                <input style={s.input} name="email" type="email" placeholder="you@company.com" onChange={handle} />
                <label style={s.label}>Password</label>
                <input style={s.input} name="password" type="password" onChange={handle} />
                <button style={s.btn} onClick={submit} disabled={loading}>
                    {loading ? 'Please wait...' : mode === 'login' ? 'Sign in' : 'Create workspace'}
                </button>
                <div style={s.toggle} onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
                    {mode === 'login' ? "Don't have an account? Register" : 'Already have an account? Sign in'}
                </div>
            </div>
        </div>
    )
}