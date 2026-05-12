import { useState, useEffect, useRef, useCallback, useReducer } from 'react'
import './App.css'
import { LandingPage, SignInPage, SignUpPage, SettingsPage } from './AuthAndLandingPages'
import { api } from './api'

const API = 'http://127.0.0.1:8000'

// ── IndexedDB audio persistence ────────────────────────────────────
const DB_NAME = 'voicestudio', DB_VER = 1, STORE = 'audio'
