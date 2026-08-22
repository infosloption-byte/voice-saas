<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Named DubbingJob (not VideoDubbingJob) on purpose — the queued worker
 * classes are App\Jobs\PrepareDubbingJob and App\Jobs\FinalizeDubbingJob
 * (split Aug 22, 2026 — see task #6 in docs/ENHANCEMENT_TASKS.md), and
 * Eloquent model + Bus job sharing one name across two namespaces is a
 * needless footgun (easy to `use` the wrong one).
 */
class DubbingJob extends Model
{
    protected $table = 'video_dubbing_jobs';

    protected $keyType = 'string';
    public $incrementing = false;

    protected $fillable = [
        'id', 'user_id', 'activity_log_id',
        'voice_profile_id', 'engine', 'source_language', 'target_language', 'original_filename',
        'status', 'progress', 'error',
        'segment_count', 'segment_overflow_count', 'segments_json',
        'source_video_path', 'result_video_path', 'duration_seconds',
        'started_at', 'ended_at',
    ];

    protected $casts = [
        'progress'         => 'integer',
        'duration_seconds' => 'float',
        'started_at'       => 'datetime',
        'ended_at'         => 'datetime',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function activityLog(): BelongsTo
    {
        return $this->belongsTo(ActivityLog::class);
    }
}
