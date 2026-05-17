import { useState, useCallback } from 'react'

export type TTSEngine = 'xtts' | 'f5'

const STORAGE_KEY = 'vo_tts_engine'

export function useTTSEngine() {
  const [engine, setEngineState] = useState<TTSEngine>(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    return (saved === 'f5' ? 'f5' : 'xtts') as TTSEngine
  })

  const setEngine = useCallback((e: TTSEngine) => {
    localStorage.setItem(STORAGE_KEY, e)
    setEngineState(e)
  }, [])

  return { engine, setEngine }
}