import { useState, useCallback } from 'react'
import { api } from '../api'
import type { User } from '../types'

interface UseAuthReturn {
  user: User | null
  loading: boolean
  error: string | null
  checkUser: () => Promise<User | null>
  signIn: (email: string, password: string) => Promise<User | null>
  signUp: (name: string, email: string, password: string) => Promise<User | null>
  signInWithGoogle: (credential: string) => Promise<User | null>
  signOut: () => Promise<void>
}

export function useAuth(): UseAuthReturn {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const checkUser = useCallback(async (): Promise<User | null> => {
    try {
      const data = await api.get('/user') as User
      setUser(data)
      return data
    } catch {
      setUser(null)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const signIn = useCallback(async (email: string, password: string): Promise<User | null> => {
    setError(null)
    try {
      await api.post('/login', { email, password })
      return checkUser()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Sign in failed'
      setError(msg)
      throw e
    }
  }, [checkUser])

  const signUp = useCallback(async (name: string, email: string, password: string): Promise<User | null> => {
    setError(null)
    try {
      await api.post('/register', { name, email, password })
      return checkUser()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Sign up failed'
      setError(msg)
      throw e
    }
  }, [checkUser])

  const signInWithGoogle = useCallback(async (credential: string): Promise<User | null> => {
    setError(null)
    try {
      await api.post('/auth/google', { credential })
      return checkUser()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Google sign-in failed'
      setError(msg)
      throw e
    }
  }, [checkUser])

  const signOut = useCallback(async (): Promise<void> => {
    try {
      await api.post('/logout')
    } catch {
      // Ignore logout errors — clear state regardless
    } finally {
      setUser(null)
    }
  }, [])

  return { user, loading, error, checkUser, signIn, signUp, signInWithGoogle, signOut }
}