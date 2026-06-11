import { useState, useEffect } from 'react'
import axios from 'axios'
import '../App.css'

/* ── Toast helper (local) ─────────────────────────────────────────────────── */
function useToast() {
    const [toasts, setToasts] = useState([])
    const add = (msg, type = 'info') => {
        const id = Date.now()
        setToasts(t => [...t, { id, msg, type }])
        setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500)
    }
    return { toasts, add }
}

export default function Login({ onLogin }) {
    const [mode, setMode] = useState('login')
    const [form, setForm] = useState({ tenant_name: '', email: '', password: '' })
    const [showPw, setShowPw] = useState(false)
    const [loading, setLoading] = useState(false)
    const { toasts, add } = useToast()

    const handle = (e) => setForm({ ...form, [e.target.name]: e.target.value })

    const submit = async () => {
        if (loading) return
        setLoading(true)
        try {
            if (mode === 'register') {
                await axios.post('/auth/register', form)
                add('Workspace created! Please sign in.', 'success')
                setMode('login')
                setForm(f => ({ ...f, tenant_name: '' }))
            } else {
                const params = new URLSearchParams()
                params.append('username', form.email)
                params.append('password', form.password)
                const res = await axios.post('/auth/login', params)
                onLogin(res.data.access_token)
            }
        } catch (e) {
            add(e.response?.data?.detail || 'Something went wrong', 'error')
        } finally {
            setLoading(false)
        }
    }

    const onKey = (e) => { if (e.key === 'Enter') submit() }

    return (
        <div className="login-root">
            {/* Animated mesh background */}
            <div className="login-bg">
                <div className="login-orb login-orb-1" />
                <div className="login-orb login-orb-2" />
                <div className="login-orb login-orb-3" />
            </div>

            {/* Toast notifications */}
            <div className="toast-container">
                {toasts.map(t => (
                    <div key={t.id} className={`toast ${t.type}`}>
                        <span className="toast-icon">
                            {t.type === 'success' ? '✓' : t.type === 'error' ? '✕' : 'ℹ'}
                        </span>
                        {t.msg}
                    </div>
                ))}
            </div>

            {/* Card */}
            <div className="login-card glass-card">
                {/* Brand header */}
                <div className="login-brand">
                    <div className="login-logo">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
                                stroke="url(#brandGrad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            <defs>
                                <linearGradient id="brandGrad" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
                                    <stop stopColor="#3b82f6" />
                                    <stop offset="1" stopColor="#8b5cf6" />
                                </linearGradient>
                            </defs>
                        </svg>
                    </div>
                    <span className="login-brand-name">DocMind</span>
                </div>

                {/* Tabs */}
                <div className="login-tabs">
                    <button
                        className={`login-tab ${mode === 'login' ? 'active' : ''}`}
                        onClick={() => setMode('login')}
                    >
                        Sign In
                    </button>
                    <button
                        className={`login-tab ${mode === 'register' ? 'active' : ''}`}
                        onClick={() => setMode('register')}
                    >
                        Register
                    </button>
                    <div className={`login-tab-indicator ${mode === 'register' ? 'right' : ''}`} />
                </div>

                <p className="login-sub">
                    {mode === 'login' ? 'Welcome back — sign in to your workspace' : 'Create a private workspace for your team'}
                </p>

                <div className="login-fields">
                    {mode === 'register' && (
                        <div className="login-field" style={{ animation: 'fadeUp 0.25s ease' }}>
                            <label className="login-label">Workspace name</label>
                            <input
                                className="form-input"
                                name="tenant_name"
                                placeholder="acme-corp"
                                value={form.tenant_name}
                                onChange={handle}
                                onKeyDown={onKey}
                                autoComplete="off"
                            />
                        </div>
                    )}
                    <div className="login-field">
                        <label className="login-label">Email</label>
                        <input
                            className="form-input"
                            name="email"
                            type="email"
                            placeholder="you@company.com"
                            value={form.email}
                            onChange={handle}
                            onKeyDown={onKey}
                            autoComplete="email"
                        />
                    </div>
                    <div className="login-field">
                        <label className="login-label">Password</label>
                        <div className="login-pw-wrap">
                            <input
                                className="form-input"
                                name="password"
                                type={showPw ? 'text' : 'password'}
                                placeholder="••••••••"
                                value={form.password}
                                onChange={handle}
                                onKeyDown={onKey}
                                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                                style={{ paddingRight: '2.8rem' }}
                            />
                            <button
                                type="button"
                                className="login-pw-toggle"
                                onClick={() => setShowPw(s => !s)}
                                tabIndex={-1}
                            >
                                {showPw ? '🙈' : '👁️'}
                            </button>
                        </div>
                    </div>
                </div>

                <button
                    className="btn-primary login-submit"
                    onClick={submit}
                    disabled={loading}
                >
                    {loading ? <><span className="spinner" /> Processing…</> : (
                        mode === 'login' ? 'Sign In →' : 'Create Workspace →'
                    )}
                </button>

                <p className="login-switch">
                    {mode === 'login' ? "Don't have a workspace? " : 'Already have an account? '}
                    <button
                        className="login-switch-btn"
                        onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
                    >
                        {mode === 'login' ? 'Register' : 'Sign in'}
                    </button>
                </p>
            </div>

            <style>{`
                .login-root {
                    position: relative;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    min-height: 100vh;
                    overflow: hidden;
                }
                .login-bg {
                    position: absolute;
                    inset: 0;
                    background: var(--bg-base);
                    z-index: 0;
                }
                .login-orb {
                    position: absolute;
                    border-radius: 50%;
                    filter: blur(80px);
                    opacity: 0.35;
                    animation: gradient-shift 8s ease infinite;
                    background-size: 200% 200%;
                }
                .login-orb-1 {
                    width: 480px; height: 480px;
                    top: -120px; left: -100px;
                    background: radial-gradient(circle, #3b82f6 0%, transparent 70%);
                    animation-duration: 9s;
                }
                .login-orb-2 {
                    width: 400px; height: 400px;
                    bottom: -80px; right: -60px;
                    background: radial-gradient(circle, #8b5cf6 0%, transparent 70%);
                    animation-duration: 11s;
                    animation-delay: -3s;
                }
                .login-orb-3 {
                    width: 300px; height: 300px;
                    top: 50%; left: 55%;
                    background: radial-gradient(circle, #06b6d4 0%, transparent 70%);
                    opacity: 0.18;
                    animation-duration: 13s;
                    animation-delay: -6s;
                }
                .login-card {
                    position: relative;
                    z-index: 1;
                    width: 100%;
                    max-width: 420px;
                    padding: 2.2rem 2rem;
                    animation: fadeUp 0.4s ease;
                    margin: 1rem;
                }
                .login-brand {
                    display: flex;
                    align-items: center;
                    gap: 0.6rem;
                    margin-bottom: 1.6rem;
                }
                .login-logo {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: 36px; height: 36px;
                    background: var(--gradient-surface);
                    border: 1px solid var(--border-default);
                    border-radius: var(--radius-md);
                }
                .login-brand-name {
                    font-size: 1.2rem;
                    font-weight: 700;
                    background: var(--gradient-brand);
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                    background-clip: text;
                }
                .login-tabs {
                    position: relative;
                    display: flex;
                    background: var(--bg-surface);
                    border: 1px solid var(--border-subtle);
                    border-radius: var(--radius-md);
                    padding: 3px;
                    margin-bottom: 1.4rem;
                }
                .login-tab {
                    flex: 1;
                    padding: 0.45rem;
                    background: transparent;
                    border: none;
                    border-radius: calc(var(--radius-md) - 2px);
                    color: var(--text-secondary);
                    font-family: inherit;
                    font-size: 0.875rem;
                    font-weight: 500;
                    cursor: pointer;
                    position: relative;
                    z-index: 1;
                    transition: color var(--transition-fast);
                }
                .login-tab.active { color: var(--text-primary); }
                .login-tab-indicator {
                    position: absolute;
                    top: 3px; left: 3px;
                    width: calc(50% - 3px);
                    height: calc(100% - 6px);
                    background: var(--bg-elevated);
                    border: 1px solid var(--border-default);
                    border-radius: calc(var(--radius-md) - 2px);
                    transition: transform var(--transition-normal);
                    box-shadow: var(--shadow-sm);
                }
                .login-tab-indicator.right {
                    transform: translateX(100%);
                }
                .login-sub {
                    color: var(--text-secondary);
                    font-size: 0.85rem;
                    margin-bottom: 1.4rem;
                }
                .login-fields {
                    display: flex;
                    flex-direction: column;
                    gap: 0.9rem;
                    margin-bottom: 1.2rem;
                }
                .login-field { display: flex; flex-direction: column; gap: 0.4rem; }
                .login-label { font-size: 0.8rem; font-weight: 500; color: var(--text-secondary); }
                .login-pw-wrap { position: relative; }
                .login-pw-toggle {
                    position: absolute;
                    right: 0.7rem;
                    top: 50%;
                    transform: translateY(-50%);
                    background: none;
                    border: none;
                    cursor: pointer;
                    font-size: 0.9rem;
                    opacity: 0.6;
                    transition: opacity var(--transition-fast);
                    line-height: 1;
                }
                .login-pw-toggle:hover { opacity: 1; }
                .login-submit {
                    width: 100%;
                    padding: 0.8rem;
                    font-size: 0.95rem;
                    margin-bottom: 1rem;
                }
                .login-switch {
                    text-align: center;
                    font-size: 0.82rem;
                    color: var(--text-muted);
                }
                .login-switch-btn {
                    background: none;
                    border: none;
                    color: var(--accent-blue);
                    font-family: inherit;
                    font-size: inherit;
                    font-weight: 500;
                    cursor: pointer;
                    padding: 0;
                    transition: color var(--transition-fast);
                }
                .login-switch-btn:hover { color: #60a5fa; text-decoration: underline; }
                .toast-icon {
                    font-style: normal;
                    font-size: 0.85rem;
                    flex-shrink: 0;
                }
            `}</style>
        </div>
    )
}