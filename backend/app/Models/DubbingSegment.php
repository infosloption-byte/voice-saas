<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One transcribed/translated/synthesized segment within a dubbing job —
 * see the create_dubbing_segments_table migration for why this exists
 * (Tier 1 of the "advanced dubbing" plan, docs/ENHANCEMENT_TASKS.md task #6).
 */
class DubbingSegment extends Model
{
    protected $table = 'dubbing_segments';

    protected $fillable = [
        'dubbing_job_id', 'segment_index', 'start_time', 'end_time',
        'original_text', 'translated_text', 'voice_profile_id',
        'muted', 'status', 'stretch_ratio', 'audio_path',
    ];

    protected $casts = [
        'start_time'    => 'float',
        'end_time'      => 'float',
        'muted'         => 'boolean',
        'stretch_ratio' => 'float',
    ];

    public function dubbingJob(): BelongsTo
    {
        return $this->belongsTo(DubbingJob::class, 'dubbing_job_id');
    }
}
