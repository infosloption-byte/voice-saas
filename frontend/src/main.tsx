import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './app/App.tsx'
import { AdminApp } from './app/AdminApp.tsx'

const isAdminRoute =
  window.location.hostname.startsWith('admin.') ||
  window.location.pathname === '/admin' ||
  window.location.pathname.startsWith('/admin/')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isAdminRoute ? <AdminApp /> : <App />}
  </StrictMode>,
)
