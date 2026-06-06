// Persisted audio + appearance preferences shared between SettingsPage and
// the recorder / script creation.

const AUDIO_KEY      = 'vs_audio_settings'
const APPEARANCE_KEY = 'vs_appearance_settings'

export interface AudioPrefs {
  defaultLang:       string
  defaultSpeed:      number
  noiseSuppression:  boolean
  autoGain:          boolean
  defaultGain:       number
}

export interface AppearancePrefs {
  density:          'comfortable' | 'compact'
  sidebarCollapsed: boolean
}

const AUDIO_DEFAULTS: AudioPrefs = {
  defaultLang:      'en',
  defaultSpeed:     1.0,
  noiseSuppression: true,
  autoGain:         true,
  defaultGain:      0.85,
}

const APPEARANCE_DEFAULTS: AppearancePrefs = {
  density:          'comfortable',
  sidebarCollapsed: false,
}

function load<T>(key: string, defaults: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return defaults
    return { ...defaults, ...JSON.parse(raw) }
  } catch {
    return defaults
  }
}

export function getAudioPrefs(): AudioPrefs {
  return load<AudioPrefs>(AUDIO_KEY, AUDIO_DEFAULTS)
}

export function saveAudioPrefs(prefs: AudioPrefs): void {
  localStorage.setItem(AUDIO_KEY, JSON.stringify(prefs))
}

export function getAppearancePrefs(): AppearancePrefs {
  return load<AppearancePrefs>(APPEARANCE_KEY, APPEARANCE_DEFAULTS)
}

export function saveAppearancePrefs(prefs: AppearancePrefs): void {
  localStorage.setItem(APPEARANCE_KEY, JSON.stringify(prefs))
}
