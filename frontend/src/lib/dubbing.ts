import type { DubSegment, DubSegmentAction, DubSegmentHistory } from './types'

/** Minimum segment duration the editor will allow (seconds) — same order of magnitude as MAX_STRETCH_RATIO's tolerance server-side; anything shorter isn't meaningfully editable. */
export const MIN_SEGMENT_DUR = 0.3

/** Minimum gap enforced between adjacent segments (seconds) — purely a UI/editing convenience so blocks never visually or literally overlap; the backend's own ordering (VideoDubbingController::updateSegments sorts by start) doesn't depend on this. */
export const MIN_GAP = 0.05

// ── Segment history reducer ────────────────────────────────────────
// Identical shape to timelineReducer in audio.ts, just typed for
// DubSegment[] instead of TimelineClip[] — see lib/types.ts for why
// these aren't unified into one generic.
export function segmentReducer(state: DubSegmentHistory, action: DubSegmentAction): DubSegmentHistory {
  switch (action.type) {
    case 'SET':
      if (JSON.stringify(action.segments) === JSON.stringify(state.present)) return state
      return { past: [...state.past, state.present].slice(-50), present: action.segments, future: [] }
    case 'UNDO':
      if (!state.past.length) return state
      return { past: state.past.slice(0, -1), present: state.past[state.past.length - 1], future: [state.present, ...state.future] }
    case 'REDO':
      if (!state.future.length) return state
      return { past: [...state.past, state.present], present: state.future[0], future: state.future.slice(1) }
    default: return state
  }
}

/**
 * Move segment `id` so its start becomes `newStart` (dragging the whole
 * block — duration is preserved), clamped so it can't cross into its
 * left/right neighbor (segments are always kept in chronological order —
 * dubbing lines can't be reordered relative to the speech they translate,
 * only retimed within the gaps around them) and never goes negative.
 */
export function retimeSegment(segments: DubSegment[], id: string, newStart: number): DubSegment[] {
  const idx = segments.findIndex(s => s.id === id)
  if (idx === -1) return segments
  const seg = segments[idx]
  const dur = seg.end - seg.start
  const prev = segments[idx - 1]
  const next = segments[idx + 1]
  const minStart = prev ? prev.end + MIN_GAP : 0
  const maxStart = next ? next.start - MIN_GAP - dur : Infinity
  const clampedStart = Math.max(minStart, Math.min(maxStart === Infinity ? newStart : Math.max(minStart, maxStart), newStart))
  const start = Math.max(minStart, Math.round(clampedStart * 100) / 100)
  return segments.map((s, i) => i === idx ? { ...s, start, end: start + dur } : s)
}

/**
 * Resize segment `id` from one edge — dragging the left handle changes
 * `start` (and thus duration) while `end` stays fixed, and vice versa for
 * the right handle. Clamped to MIN_SEGMENT_DUR and to not cross the
 * adjacent segment (with MIN_GAP of breathing room).
 */
export function resizeSegment(segments: DubSegment[], id: string, side: 'left' | 'right', newValue: number): DubSegment[] {
  const idx = segments.findIndex(s => s.id === id)
  if (idx === -1) return segments
  const seg = segments[idx]
  const prev = segments[idx - 1]
  const next = segments[idx + 1]

  if (side === 'left') {
    const minStart = prev ? prev.end + MIN_GAP : 0
    const maxStart = seg.end - MIN_SEGMENT_DUR
    const start = Math.round(Math.max(minStart, Math.min(maxStart, newValue)) * 100) / 100
    return segments.map((s, i) => i === idx ? { ...s, start } : s)
  } else {
    const maxEnd = next ? next.start - MIN_GAP : Infinity
    const minEnd = seg.start + MIN_SEGMENT_DUR
    const end = Math.round(Math.max(minEnd, maxEnd === Infinity ? newValue : Math.min(maxEnd, newValue)) * 100) / 100
    return segments.map((s, i) => i === idx ? { ...s, end } : s)
  }
}
