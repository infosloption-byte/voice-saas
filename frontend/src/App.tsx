import { useState, useEffect, useRef, useCallback } from 'react'
import './App.css'

const API = 'http://localhost:8000'

type AppMode = 'transcribe' | 'clone'
type CloneStep = 'record' | 'synthesize'

interface VoiceProfile {
  profile_id: string
  filename: string
}

// ── Waveform visualiser ──────────────────────────────────────────────
function WaveVisualiser({ active }: { active: boolean }) {
  const bars = 28
  return (
    <div className="wave-vis" aria-hidden>
      {Array.from({ length: bars }).map((_, i) => (
        <span
          key={i}
          className={`bar ${active ? 'bar--live' : ''}`}
          style={{ '--i': i } as React.CSSProperties}
        />
      ))}
    </div>
  )
}

// ── Mic Button ────────────────────────────────────────────────────────
function MicButton({
  recording,
  onClick,
  disabled,
  label,
}: {
  recording: boolean
  onClick: () => void
  disabled?: boolean
  label: string
}) {
  return (
    <button
      className={`mic-btn ${recording ? 'mic-btn--recording' : ''}`}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="mic-btn__ring" />
      <span className="mic-btn__ring mic-btn__ring--2" />
      <svg className="mic-btn__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {recording ? (
          <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />
        ) : (
          <>
            <path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="22" />
            <line x1="8" y1="22" x2="16" y2="22" />
          </>
        )}
      </svg>
      <span className="mic-btn__label">{label}</span>
    </button>
  )
}

// ── useAudioRecorder hook ─────────────────────────────────────────────
function useAudioRecorder() {
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const recRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const start = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })

    // Prefer webm/opus; fallback to whatever browser supports
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm')
      ? 'audio/webm'
      : ''

    recRef.current = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream)
    chunksRef.current = []
    recRef.current.ondataavailable = e => chunksRef.current.push(e.data)
    recRef.current.start(100)
    setRecording(true)
    setSeconds(0)
    timerRef.current = setInterval(() => setSeconds(s => s + 1), 1000)
  }, [])

  const stop = useCallback((): Promise<Blob> => {
    return new Promise(resolve => {
      if (!recRef.current) return resolve(new Blob())
      recRef.current.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: recRef.current?.mimeType || 'audio/webm',
        })
        resolve(blob)
        recRef.current?.stream.getTracks().forEach(t => t.stop())
      }
      recRef.current.stop()
      if (timerRef.current) clearInterval(timerRef.current)
      setRecording(false)
    })
  }, [])

  return { recording, seconds, start, stop }
}

// ── Main App ──────────────────────────────────────────────────────────
export default function App() {
  const [mode, setMode] = useState<AppMode>('transcribe')
  const [engineStatus, setEngineStatus] = useState<'checking' | 'online' | 'offline'>('checking')

  // Transcribe state
  const [transcript, setTranscript] = useState('')
  const [transcribing, setTranscribing] = useState(false)

  // Clone state
  const [cloneStep, setCloneStep] = useState<CloneStep>('record')
  const [profiles, setProfiles] = useState<VoiceProfile[]>([])
  const [selectedProfile, setSelectedProfile] = useState<string>('')
  const [profileName, setProfileName] = useState('my-voice')
  const [savingProfile, setSavingProfile] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [synthText, setSynthText] = useState("Hello! This is my voice speaking, generated entirely from artificial intelligence.")
  const [synthesizing, setSynthesizing] = useState(false)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [synthError, setSynthError] = useState('')

  const recorder = useAudioRecorder()

  // Engine health check
  useEffect(() => {
    fetch(`${API}/`)
      .then(r => r.json())
      .then(() => setEngineStatus('online'))
      .catch(() => setEngineStatus('offline'))
  }, [])

  // Load voice profiles
  const loadProfiles = useCallback(() => {
    fetch(`${API}/voice-profile/list`)
      .then(r => r.json())
      .then(d => {
        setProfiles(d.profiles || [])
        if (d.profiles?.length && !selectedProfile) {
          setSelectedProfile(d.profiles[0].profile_id)
        }
      })
      .catch(() => {})
  }, [selectedProfile])

  useEffect(() => { loadProfiles() }, [])

  // ── Transcription ────────────────────────────────────────────────
  const handleTranscribeToggle = async () => {
    if (recorder.recording) {
      setTranscribing(true)
      setTranscript('')
      const blob = await recorder.stop()
      const fd = new FormData()
      fd.append('file', blob, 'audio.webm')
      try {
        const res = await fetch(`${API}/transcribe`, { method: 'POST', body: fd })
        const data = await res.json()
        setTranscript(data.text || '(no speech detected)')
      } catch {
        setTranscript('Connection error — is the AI engine running?')
      } finally {
        setTranscribing(false)
      }
    } else {
      setTranscript('')
      await recorder.start()
    }
  }

  // ── Save Voice Profile ───────────────────────────────────────────
  const handleSaveProfile = async () => {
    if (recorder.recording) {
      setSavingProfile(true)
      setSaveMsg('')
      const blob = await recorder.stop()
      const fd = new FormData()
      fd.append('file', blob, 'voice.webm')
      fd.append('profile_id', profileName.trim() || 'my-voice')
      try {
        const res = await fetch(`${API}/voice-profile/save`, { method: 'POST', body: fd })
        const data = await res.json()
        if (data.success) {
          setSaveMsg(`✓ Saved "${data.profile_id}" (${data.duration_seconds}s)`)
          setSelectedProfile(data.profile_id)
          loadProfiles()
          setTimeout(() => setCloneStep('synthesize'), 800)
        } else {
          setSaveMsg('Failed to save profile.')
        }
      } catch {
        setSaveMsg('Error connecting to AI engine.')
      } finally {
        setSavingProfile(false)
      }
    } else {
      setSaveMsg('')
      await recorder.start()
    }
  }

  // ── Synthesize ───────────────────────────────────────────────────
  const handleSynthesize = async () => {
    if (!selectedProfile) { setSynthError('Select a voice profile first.'); return }
    if (!synthText.trim()) { setSynthError('Enter some text to synthesize.'); return }
    setSynthesizing(true)
    setSynthError('')
    setAudioUrl(null)
    const fd = new FormData()
    fd.append('text', synthText)
    fd.append('profile_id', selectedProfile)
    try {
      const res = await fetch(`${API}/synthesize`, { method: 'POST', body: fd })
      if (!res.ok) {
        const err = await res.json()
        setSynthError(err.detail || 'Synthesis failed.')
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      setAudioUrl(url)
      new Audio(url).play().catch(() => {})
    } catch {
      setSynthError('Connection error.')
    } finally {
      setSynthesizing(false)
    }
  }

  const fmt = (s: number) => `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header__brand">
          <div className="brand-mark">
            <svg viewBox="0 0 32 32" fill="none">
              <circle cx="16" cy="16" r="15" stroke="url(#g1)" strokeWidth="2" />
              <path d="M10 16c0-3.31 2.69-6 6-6s6 2.69 6 6" stroke="url(#g2)" strokeWidth="2" strokeLinecap="round" />
              <circle cx="16" cy="20" r="3" fill="url(#g3)" />
              <line x1="16" y1="23" x2="16" y2="26" stroke="url(#g2)" strokeWidth="2" strokeLinecap="round" />
              <defs>
                <linearGradient id="g1" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#a78bfa" /><stop offset="1" stopColor="#38bdf8" />
                </linearGradient>
                <linearGradient id="g2" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#a78bfa" /><stop offset="1" stopColor="#38bdf8" />
                </linearGradient>
                <linearGradient id="g3" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#a78bfa" /><stop offset="1" stopColor="#38bdf8" />
                </linearGradient>
              </defs>
            </svg>
          </div>
          <span className="brand-name">VoiceSaaS</span>
        </div>
        <div className={`engine-badge engine-badge--${engineStatus}`}>
          <span className="engine-badge__dot" />
          {engineStatus === 'checking' ? 'Connecting…' : engineStatus === 'online' ? 'Engine Online' : 'Engine Offline'}
        </div>
      </header>

      {/* Mode Tabs */}
      <nav className="tabs">
        <button
          className={`tab ${mode === 'transcribe' ? 'tab--active' : ''}`}
          onClick={() => setMode('transcribe')}
        >
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M3 5h14M3 10h10M3 15h7" />
          </svg>
          Transcription
        </button>
        <button
          className={`tab ${mode === 'clone' ? 'tab--active' : ''}`}
          onClick={() => setMode('clone')}
        >
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 2a3 3 0 0 1 3 3v4a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z" />
            <path d="M16 9v1a6 6 0 0 1-12 0V9" />
            <line x1="10" y1="16" x2="10" y2="19" />
            <line x1="7" y1="19" x2="13" y2="19" />
          </svg>
          Voice Cloning
        </button>
      </nav>

      <main className="main">
        {/* ── TRANSCRIPTION MODE ── */}
        {mode === 'transcribe' && (
          <section className="panel">
            <div className="panel__head">
              <h2>Speech to Text</h2>
              <p>Speak clearly into your microphone — we'll transcribe in real time.</p>
            </div>

            <div className="record-stage">
              <WaveVisualiser active={recorder.recording} />

              {recorder.recording && (
                <div className="timer">{fmt(recorder.seconds)}</div>
              )}

              <MicButton
                recording={recorder.recording}
                onClick={handleTranscribeToggle}
                disabled={transcribing}
                label={
                  transcribing
                    ? 'Transcribing…'
                    : recorder.recording
                    ? 'Stop & Transcribe'
                    : 'Start Recording'
                }
              />
            </div>

            {transcribing && (
              <div className="status-row">
                <span className="spinner" /> Processing audio…
              </div>
            )}

            {transcript && (
              <div className="result-box">
                <div className="result-box__label">Transcript</div>
                <p className="result-box__text">{transcript}</p>
                <button
                  className="copy-btn"
                  onClick={() => navigator.clipboard.writeText(transcript)}
                >
                  Copy
                </button>
              </div>
            )}

            <div className="tips">
              <span className="tip">💡 Speak 6–10 seconds for best results</span>
              <span className="tip">🎙 Reduce background noise</span>
            </div>
          </section>
        )}

        {/* ── VOICE CLONING MODE ── */}
        {mode === 'clone' && (
          <section className="panel">
            <div className="panel__head">
              <h2>Voice Cloning</h2>
              <p>Record your voice once. Use it to speak anything, forever.</p>
            </div>

            {/* Step switcher */}
            <div className="clone-steps">
              <button
                className={`clone-step ${cloneStep === 'record' ? 'clone-step--active' : ''}`}
                onClick={() => setCloneStep('record')}
              >
                <span className="clone-step__num">1</span>
                Record Voice
              </button>
              <span className="clone-steps__line" />
              <button
                className={`clone-step ${cloneStep === 'synthesize' ? 'clone-step--active' : ''}`}
                onClick={() => setCloneStep('synthesize')}
              >
                <span className="clone-step__num">2</span>
                Synthesize
              </button>
            </div>

            {/* ── STEP 1: Record voice ── */}
            {cloneStep === 'record' && (
              <div className="step-body">
                <div className="script-card">
                  <div className="script-card__label">Read this script aloud:</div>
                  <p className="script-card__text">
                    "The quick brown fox jumps over the lazy dog. My name is recorded here to create a precise digital clone of my voice for artificial intelligence synthesis."
                  </p>
                  <span className="script-card__hint">≈ 15–20 seconds ideal</span>
                </div>

                <div className="profile-name-row">
                  <label>Profile name</label>
                  <input
                    className="text-input"
                    value={profileName}
                    onChange={e => setProfileName(e.target.value.replace(/[^a-z0-9-_]/gi, '-'))}
                    placeholder="my-voice"
                    disabled={recorder.recording}
                  />
                </div>

                <div className="record-stage">
                  <WaveVisualiser active={recorder.recording} />
                  {recorder.recording && <div className="timer">{fmt(recorder.seconds)}</div>}

                  <MicButton
                    recording={recorder.recording}
                    onClick={handleSaveProfile}
                    disabled={savingProfile}
                    label={
                      savingProfile
                        ? 'Saving profile…'
                        : recorder.recording
                        ? 'Stop & Save Profile'
                        : 'Record Voice'
                    }
                  />
                </div>

                {saveMsg && (
                  <div className={`msg ${saveMsg.startsWith('✓') ? 'msg--ok' : 'msg--err'}`}>
                    {saveMsg}
                  </div>
                )}

                {profiles.length > 0 && (
                  <div className="existing-profiles">
                    <span>Or use an existing profile</span>
                    <div className="profile-chips">
                      {profiles.map(p => (
                        <button
                          key={p.profile_id}
                          className={`chip ${selectedProfile === p.profile_id ? 'chip--active' : ''}`}
                          onClick={() => {
                            setSelectedProfile(p.profile_id)
                            setCloneStep('synthesize')
                          }}
                        >
                          {p.profile_id}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── STEP 2: Synthesize ── */}
            {cloneStep === 'synthesize' && (
              <div className="step-body">
                {/* Profile selector */}
                {profiles.length > 0 && (
                  <div className="field">
                    <label className="field__label">Voice profile</label>
                    <div className="profile-chips">
                      {profiles.map(p => (
                        <button
                          key={p.profile_id}
                          className={`chip ${selectedProfile === p.profile_id ? 'chip--active' : ''}`}
                          onClick={() => setSelectedProfile(p.profile_id)}
                        >
                          {p.profile_id}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {profiles.length === 0 && (
                  <div className="msg msg--warn">
                    No voice profiles yet.{' '}
                    <button className="link-btn" onClick={() => setCloneStep('record')}>
                      Record one first →
                    </button>
                  </div>
                )}

                <div className="field">
                  <label className="field__label">Text to synthesize</label>
                  <textarea
                    className="textarea"
                    value={synthText}
                    onChange={e => setSynthText(e.target.value)}
                    rows={4}
                    placeholder="Type anything you want your cloned voice to say…"
                    disabled={synthesizing}
                  />
                  <span className="field__hint">{synthText.length} characters</span>
                </div>

                <button
                  className={`synth-btn ${synthesizing ? 'synth-btn--loading' : ''}`}
                  onClick={handleSynthesize}
                  disabled={synthesizing || profiles.length === 0}
                >
                  {synthesizing ? (
                    <><span className="spinner" /> Generating Voice…</>
                  ) : (
                    <>
                      <svg viewBox="0 0 20 20" fill="currentColor"><path d="M6 4l12 6-12 6V4z" /></svg>
                      Generate with My Voice
                    </>
                  )}
                </button>

                {synthError && <div className="msg msg--err">{synthError}</div>}

                {audioUrl && (
                  <div className="audio-result">
                    <div className="audio-result__label">
                      <svg viewBox="0 0 20 20" fill="currentColor"><path d="M6 4l12 6-12 6V4z" /></svg>
                      Generated Audio
                    </div>
                    <audio className="audio-player" src={audioUrl} controls />
                    <a className="download-btn" href={audioUrl} download="cloned_voice.wav">
                      Download WAV
                    </a>
                  </div>
                )}
              </div>
            )}
          </section>
        )}
      </main>

      <footer className="footer">
        Powered by Whisper · XTTS v2 · FastAPI
      </footer>
    </div>
  )
}