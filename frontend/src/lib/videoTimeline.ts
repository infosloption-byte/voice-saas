import type { VideoTimelineClip, VideoTimelineHistory, VideoTimelineAction, VideoProjectAsset } from './types'

/**
 * Task #15 (Video Studio) Phase 5 — the multi-lane timeline's clamping
 * math. Deliberately NOT a reuse of `lib/dubbing.ts`'s
 * retimeSegment()/resizeSegment(): those clamp against the *whole*
 * segment array in chronological order, because a dub review timeline is
 * single-lane by definition. Here, clips in *different* lanes are
 * allowed to overlap in time — that's the entire point of a lane (an
 * audio track under a video track, a title image over it) — so every
 * clamp below only ever looks at OTHER CLIPS IN THE SAME LANE. Within
 * one lane, clips still can't overlap (a lane is a single sequential
 * track), so the shape of the clamp itself is the same idea as
 * retimeSegment/resizeSegment, just scoped per-lane instead of
 * globally.
 */

/** Shortest a clip's visible (post-trim) duration can be, seconds. Same figure as MIN_SEGMENT_DUR in lib/dubbing.ts — no reason for this to differ. */
export const MIN_CLIP_DUR = 0.3

/** Minimum gap enforced between two clips in the same lane — pure UI/editing convenience, same role as MIN_GAP in lib/dubbing.ts. */
export const MIN_LANE_GAP = 0.05

/** Fallback duration (seconds) for an image clip added to the timeline — images have no intrinsic duration (VideoProjectAsset.duration_seconds is null for them), so this is just a reasonable starting size the user can resize afterward. */
export const DEFAULT_IMAGE_DUR = 5

/** Upper bound on trim_out for an image clip — arbitrary but generous; prevents a runaway resize drag from producing a nonsensical multi-hour still. */
export const MAX_IMAGE_DUR = 300

// ── History reducer ──────────────────────────────────────────────────
// Identical shape to timelineReducer (lib/audio.ts) and segmentReducer
// (lib/dubbing.ts) — see lib/types.ts for why these parallel types
// aren't unified into one generic reducer.
export function videoTimelineReducer(state: VideoTimelineHistory, action: VideoTimelineAction): VideoTimelineHistory {
  switch (action.type) {
    case 'SET':
      if (JSON.stringify(action.clips) === JSON.stringify(state.present)) return state
      return { past: [...state.past, state.present].slice(-30), present: action.clips, future: [] }
    case 'UNDO':
      if (!state.past.length) return state
      return { past: state.past.slice(0, -1), present: state.past[state.past.length - 1], future: [state.present, ...state.future] }
    case 'REDO':
      if (!state.future.length) return state
      return { past: [...state.past, state.present], present: state.future[0], future: state.future.slice(1) }
    default: return state
  }
}

/** A clip's visible (post-trim) duration. */
export function clipDuration(c: VideoTimelineClip): number {
  return c.trim_out - c.trim_in
}

/** Every OTHER clip sharing clip `id`'s lane, sorted by start_time — the neighbor set every clamp below works against. */
function laneNeighbors(clips: VideoTimelineClip[], id: string, lane: number): VideoTimelineClip[] {
  return clips.filter(c => c.id !== id && c.lane === lane).sort((a, b) => a.start_time - b.start_time)
}

/** The nearest neighbor ending at or before `t`, and the nearest neighbor starting at or after `t`, within a (sorted, already-excludes-self) neighbor list. */
function boundingNeighbors(neighbors: VideoTimelineClip[], t: number): { prevEnd: number; nextStart: number } {
  let prevEnd = 0
  let nextStart = Infinity
  for (const n of neighbors) {
    const nEnd = n.start_time + clipDuration(n)
    if (nEnd <= t && nEnd > prevEnd) prevEnd = nEnd
    if (n.start_time >= t && n.start_time < nextStart) nextStart = n.start_time
  }
  return { prevEnd, nextStart }
}

/**
 * The one real positioning primitive both retimeClip() and
 * moveClipToLane() below are thin wrappers around — moves clip `id` to
 * `lane` at `desiredStart`, clamped against whatever's already in that
 * lane (excluding itself). Exists as its own export because the
 * editor's drag handler changes lane and start_time together in one
 * continuous mouse gesture (drag diagonally = reposition AND retrack at
 * once) — calling retimeClip() then moveClipToLane() as two separate
 * clamped steps could fight each other's clamps mid-drag; this does it
 * in one pass against the real target lane.
 */
export function positionClip(clips: VideoTimelineClip[], id: string, lane: number, desiredStart: number): VideoTimelineClip[] {
  const clip = clips.find(c => c.id === id)
  if (!clip || lane < 0) return clips
  const dur = clipDuration(clip)
  const neighbors = clips.filter(c => c.id !== id && c.lane === lane).sort((a, b) => a.start_time - b.start_time)
  const { prevEnd, nextStart } = boundingNeighbors(neighbors, desiredStart)
  const minStart = prevEnd > 0 ? prevEnd + MIN_LANE_GAP : 0
  const maxStart = nextStart === Infinity ? Infinity : nextStart - MIN_LANE_GAP - dur
  const clamped = Math.max(minStart, Math.min(maxStart === Infinity ? Math.max(minStart, desiredStart) : Math.max(minStart, maxStart), desiredStart))
  const start_time = Math.round(Math.max(0, clamped) * 100) / 100
  return clips.map(c => (c.id === id ? { ...c, lane, start_time } : c))
}

/**
 * Move clip `id` within its own lane to `newStart` — same idea as
 * retimeSegment() in lib/dubbing.ts, just scoped to one lane's clips
 * instead of the whole array. Thin wrapper around positionClip() with
 * the lane held fixed.
 */
export function retimeClip(clips: VideoTimelineClip[], id: string, newStart: number): VideoTimelineClip[] {
  const clip = clips.find(c => c.id === id)
  if (!clip) return clips
  return positionClip(clips, id, clip.lane, newStart)
}

/**
 * Move clip `id` to a different lane entirely (dragging it vertically
 * onto another track) while trying to keep its current start_time.
 * Thin wrapper around positionClip() with the desired start held at the
 * clip's current position.
 */
export function moveClipToLane(clips: VideoTimelineClip[], id: string, newLane: number): VideoTimelineClip[] {
  const clip = clips.find(c => c.id === id)
  if (!clip) return clips
  return positionClip(clips, id, newLane, clip.start_time)
}

/**
 * Resize clip `id` from one edge, adjusting trim_in (left handle) or
 * trim_out (right handle) — dragging the left handle also shifts
 * start_time forward/back to keep the clip's timeline position under
 * the handle the user is actually dragging, matching how a real video
 * editor's trim handles behave (unlike a dub segment's resize, which
 * only ever moves `end`/`start` in absolute timeline time — a bin
 * asset's trim_in/trim_out are relative to the SOURCE file, not the
 * timeline, so moving trim_in must move start_time by the same delta to
 * keep the clip's timeline position anchored at the edge being dragged).
 * `maxDur` is the asset's own duration (Infinity for an image, which has
 * no intrinsic length — see DEFAULT_IMAGE_DUR/MAX_IMAGE_DUR).
 */
export function resizeClip(
  clips: VideoTimelineClip[], id: string, side: 'left' | 'right', newValue: number, maxDur: number
): VideoTimelineClip[] {
  const idx = clips.findIndex(c => c.id === id)
  if (idx === -1) return clips
  const clip = clips[idx]
  const neighbors = laneNeighbors(clips, id, clip.lane)
  const { prevEnd, nextStart } = boundingNeighbors(neighbors, clip.start_time)

  if (side === 'left') {
    // trim_in can't go below 0 or above (trim_out - MIN_CLIP_DUR); the
    // resulting start_time (start_time shifts by the same delta trim_in
    // moves, so the clip's un-trimmed timeline anchor stays fixed at
    // trim_out's edge) can't cross the previous same-lane neighbor.
    const maxTrimIn = clip.trim_out - MIN_CLIP_DUR
    const trimIn = Math.max(0, Math.min(maxTrimIn, newValue))
    const delta = trimIn - clip.trim_in
    let start_time = clip.start_time + delta
    const minStart = prevEnd > 0 ? prevEnd + MIN_LANE_GAP : 0
    start_time = Math.max(minStart, start_time)
    // Re-derive trim_in from the actually-applied start_time so the two
    // stay consistent if the neighbor clamp above pulled start_time back.
    const appliedDelta = start_time - clip.start_time
    const appliedTrimIn = Math.round((clip.trim_in + appliedDelta) * 100) / 100
    return clips.map((c, i) => (i === idx ? { ...c, trim_in: appliedTrimIn, start_time: Math.round(start_time * 100) / 100 } : c))
  } else {
    // trim_out can't go below (trim_in + MIN_CLIP_DUR) or above maxDur;
    // the resulting visible duration can't push start_time+duration past
    // the next same-lane neighbor.
    const minTrimOut = clip.trim_in + MIN_CLIP_DUR
    let trimOut = Math.max(minTrimOut, Math.min(maxDur, newValue))
    const maxEnd = nextStart === Infinity ? Infinity : nextStart - MIN_LANE_GAP
    if (maxEnd !== Infinity && clip.start_time + (trimOut - clip.trim_in) > maxEnd) {
      trimOut = clip.trim_in + Math.max(MIN_CLIP_DUR, maxEnd - clip.start_time)
    }
    trimOut = Math.round(trimOut * 100) / 100
    return clips.map((c, i) => (i === idx ? { ...c, trim_out: trimOut } : c))
  }
}

/**
 * Appends a new timeline entry for `asset` at the end of `lane` — the
 * "+ add to timeline" action from the bin, as opposed to a drag. Full
 * un-trimmed length by default (video/audio: the asset's own
 * duration_seconds; image: DEFAULT_IMAGE_DUR, since there's no source
 * length to default to).
 */
export function addClipToTimeline(clips: VideoTimelineClip[], asset: VideoProjectAsset, lane: number): VideoTimelineClip[] {
  const laneClips = clips.filter(c => c.lane === lane)
  const laneEnd = laneClips.reduce((max, c) => Math.max(max, c.start_time + clipDuration(c)), 0)
  const dur = asset.kind === 'image' ? DEFAULT_IMAGE_DUR : (asset.duration_seconds ?? MIN_CLIP_DUR)
  const newClip: VideoTimelineClip = {
    id: `vtc_${Math.random().toString(36).slice(2, 10)}`,
    asset_id: asset.id,
    lane,
    start_time: Math.round((laneEnd > 0 ? laneEnd + MIN_LANE_GAP : 0) * 100) / 100,
    trim_in: 0,
    trim_out: Math.max(MIN_CLIP_DUR, dur),
    kind: asset.kind,
  }
  return [...clips, newClip]
}

export function removeClip(clips: VideoTimelineClip[], id: string): VideoTimelineClip[] {
  return clips.filter(c => c.id !== id)
}
