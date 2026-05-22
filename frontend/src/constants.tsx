// ── Static constants & icon set ────────────────────────────────────

export const CLIP_COLORS = [
  '#c96442', '#4278c9', '#3db564', '#c94278', '#c9a442', '#7842c9',
]

export const CLIP_LIGHTS = [
  'rgba(201,100,66,0.10)', 'rgba(66,120,201,0.10)', 'rgba(61,181,100,0.10)',
  'rgba(201,66,120,0.10)', 'rgba(201,164,66,0.10)', 'rgba(120,66,201,0.10)',
]

export const LANGUAGES = [
  { code: 'en', label: 'English' }, { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' }, { code: 'de', label: 'German' },
  { code: 'it', label: 'Italian' }, { code: 'pt', label: 'Portuguese' },
  { code: 'pl', label: 'Polish' }, { code: 'tr', label: 'Turkish' },
  { code: 'ru', label: 'Russian' }, { code: 'nl', label: 'Dutch' },
  { code: 'cs', label: 'Czech' }, { code: 'ar', label: 'Arabic' },
  { code: 'zh', label: 'Chinese' }, { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' }, { code: 'hi', label: 'Hindi' },
]

export const EMOJIS = ['🎬', '🎙', '📹', '🎤', '🎵', '📺', '🌟', '🚀', '💡', '🎯', '📚', '🎧']

export const TONE_PRESETS = {
  natural:    { label: 'Natural',    emoji: '🎙', temperature: 0.65, top_k: 50, top_p: 0.85 },
  expressive: { label: 'Expressive', emoji: '🎭', temperature: 0.85, top_k: 80, top_p: 0.95 },
  calm:       { label: 'Calm',       emoji: '😌', temperature: 0.40, top_k: 30, top_p: 0.70 },
  energetic:  { label: 'Energetic',  emoji: '⚡', temperature: 0.90, top_k: 90, top_p: 0.98 },
} as const
export type TonePreset = keyof typeof TONE_PRESETS

export const icons = {
  dashboard: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="2" y="2" width="7" height="7" rx="1.5" /><rect x="11" y="2" width="7" height="7" rx="1.5" /><rect x="2" y="11" width="7" height="7" rx="1.5" /><rect x="11" y="11" width="7" height="7" rx="1.5" /></svg>,
  projects:  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 7a2 2 0 0 1 2-2h2l2 2h6a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" /></svg>,
  profiles:  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M10 2a3 3 0 0 1 3 3v4a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z" /><path d="M16 9v1a6 6 0 0 1-12 0V9" /><line x1="10" y1="16" x2="10" y2="19" /><line x1="7" y1="19" x2="13" y2="19" /></svg>,
  assembly:  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="2" y="8" width="4" height="4" rx="1" /><rect x="8" y="8" width="4" height="4" rx="1" /><rect x="14" y="8" width="4" height="4" rx="1" /><path d="M4 8V6a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v2" /><path d="M10 12v3" /></svg>,
  scripts:   <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 6h12M4 10h8M4 14h5" /></svg>,
  plus:      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8"><line x1="10" y1="4" x2="10" y2="16" /><line x1="4" y1="10" x2="16" y2="10" /></svg>,
  trash:     <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 6h12M8 6V4h4v2M7 6v10a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V6" /></svg>,
  edit:      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M11.5 5.5l3 3M4 14l1-4 8-8 3 3-8 8-4 1z" /></svg>,
  play:      <svg viewBox="0 0 20 20" fill="currentColor"><path d="M7 5l9 5-9 5V5z" /></svg>,
  pause:     <svg viewBox="0 0 20 20" fill="currentColor"><rect x="5" y="4" width="3" height="12" rx="1" /><rect x="12" y="4" width="3" height="12" rx="1" /></svg>,
  stop:      <svg viewBox="0 0 20 20" fill="currentColor"><rect x="4" y="4" width="12" height="12" rx="2" /></svg>,
  rewind:    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 5v10" strokeLinecap="round" /><path d="M18 5l-8 5 8 5V5z" /></svg>,
  download:  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M10 3v10m-4-4 4 4 4-4" /><path d="M4 17h12" /></svg>,
  undo:      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 9H14a4 4 0 0 1 0 8H10" /><path d="M4 9l3-3M4 9l3 3" /></svg>,
  redo:      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M16 9H6a4 4 0 0 0 0 8h4" /><path d="M16 9l-3-3m3 3l-3 3" /></svg>,
  merge:     <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 6h4l8 8h4" /><path d="M4 14h4L10 10" /></svg>,
  drag:      <svg viewBox="0 0 20 20" fill="currentColor"><circle cx="8" cy="6" r="1.2" /><circle cx="12" cy="6" r="1.2" /><circle cx="8" cy="10" r="1.2" /><circle cx="12" cy="10" r="1.2" /><circle cx="8" cy="14" r="1.2" /><circle cx="12" cy="14" r="1.2" /></svg>,
  back:      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 4l-6 6 6 6" /></svg>,
  menu:      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><line x1="3" y1="6" x2="17" y2="6" /><line x1="3" y1="10" x2="17" y2="10" /><line x1="3" y1="14" x2="17" y2="14" /></svg>,
  close:     <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><line x1="5" y1="5" x2="15" y2="15" /><line x1="15" y1="5" x2="5" y2="15" /></svg>,
  speaker:   <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 8h3l4-4v12l-4-4H3V8z" /><path d="M14 7a4 4 0 0 1 0 6" /></svg>,
  check:     <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 10l5 5 7-8" /></svg>,
  globe:     <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="10" cy="10" r="8" /><path d="M2 10h16M10 2a12 12 0 0 1 0 16A12 12 0 0 1 10 2z" /></svg>,
  zoomIn:    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="9" cy="9" r="6" /><path d="M15 15l3 3M7 9h4M9 7v4" /></svg>,
  zoomOut:   <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="9" cy="9" r="6" /><path d="M15 15l3 3M7 9h4" /></svg>,
  mic:       <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M10 2a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z" /><path d="M16 9v1a6 6 0 0 1-12 0V9" /></svg>,
  upload:    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M10 13V3m-4 4 4-4 4 4" /><path d="M4 17h12" /></svg>,
  bolt:      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M11 2L4 11h7l-2 7 9-10h-7l2-6z" /></svg>,
  silence:   <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><line x1="4" y1="10" x2="16" y2="10" strokeDasharray="2 2" /><circle cx="10" cy="10" r="7" /></svg>,
  fit:       <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 7V4h3M14 4h3v3M3 13v3h3M14 17h3v-3" /></svg>,
  keyboard:  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="2" y="5" width="16" height="11" rx="2" /><path d="M5 9h1M8 9h1M11 9h1M14 9h1M5 13h10" /></svg>,
  volume:    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 8h3l4-4v12l-4-4H3V8z" /><path d="M14 7a4 4 0 0 1 0 6M17 4a9 9 0 0 1 0 12" /></svg>,
  zip:       <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 3h8l4 4v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" /><path d="M8 3v4h4M10 8v2M10 12v2" strokeDasharray="1 1" /></svg>,
  dark:      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M17.5 12.5A7.5 7.5 0 0 1 7.5 2.5a7.5 7.5 0 1 0 10 10z" /></svg>,
  light:     <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="10" cy="10" r="4" /><path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.93 4.93l1.41 1.41M13.66 13.66l1.41 1.41M4.93 15.07l1.41-1.41M13.66 6.34l1.41-1.41" /></svg>,
  // Auth / Settings page icons
  user:         <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="10" cy="7" r="3.5" /><path d="M3 18c0-3.87 3.13-7 7-7s7 3.13 7 7" /></svg>,
  lock:         <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="4" y="9" width="12" height="9" rx="2" /><path d="M7 9V6a3 3 0 0 1 6 0v3" /></svg>,
  mail:         <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="2" y="5" width="16" height="12" rx="2" /><path d="M2 7l8 5 8-5" /></svg>,
  eye:          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M1 10s4-7 9-7 9 7 9 7-4 7-9 7-9-7-9-7z" /><circle cx="10" cy="10" r="2.5" /></svg>,
  eyeOff:       <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 3l14 14M10 4c4.4 0 8 5.3 8 6a9.7 9.7 0 0 1-2 2.9M6.5 6.3A9 9 0 0 0 2 10c0 .7 3.6 6 8 6a8.2 8.2 0 0 0 3.5-.8" /></svg>,
  bell:         <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M10 2a6 6 0 0 1 6 6v3l2 2v1H2v-1l2-2V8a6 6 0 0 1 6-6z" /><path d="M8 17a2 2 0 0 0 4 0" /></svg>,
  shield:       <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M10 2l7 3v5c0 4-3 7-7 8-4-1-7-4-7-8V5l7-3z" /></svg>,
  chevronRight: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M7 4l6 6-6 6" /></svg>,
  info:         <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="10" cy="10" r="8" /><line x1="10" y1="9" x2="10" y2="14" /><circle cx="10" cy="6.5" r="0.5" fill="currentColor" /></svg>,
  api:          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M5 6l-3 4 3 4M15 6l3 4-3 4M11 4l-2 12" /></svg>,
  music:        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M9 18V5l10-2v13" /><circle cx="5" cy="18" r="3" /><circle cx="15" cy="16" r="3" /></svg>,
  mp3:          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 3h8l4 4v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" /><path d="M12 3v4h4" /><text x="6" y="15" fontSize="5.5" strokeWidth="0" fill="currentColor" fontFamily="sans-serif" fontWeight="bold">MP3</text></svg>,
  template:     <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="3" y="3" width="14" height="4" rx="1" /><rect x="3" y="10" width="6" height="7" rx="1" /><path d="M13 10h4M13 13h4M13 16h2" /></svg>,
  newScript:    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 3H5a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V8l-4-5z" /><path d="M12 3v5h5M8 12h4M10 10v4" /></svg>,
}