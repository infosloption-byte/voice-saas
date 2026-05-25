export type ToastKind = 'ok' | 'err' | 'info'

export interface ToastItem {
  id: number
  msg: string
  kind: ToastKind
}

type Listener = (t: ToastItem) => void
const listeners = new Set<Listener>()
let _id = 0

function fire(msg: string, kind: ToastKind) {
  const t: ToastItem = { id: ++_id, msg, kind }
  listeners.forEach(l => l(t))
}

export const toast = {
  ok:   (msg: string) => fire(msg, 'ok'),
  err:  (msg: string) => fire(msg, 'err'),
  info: (msg: string) => fire(msg, 'info'),
}

export function subscribeToast(l: Listener): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}
