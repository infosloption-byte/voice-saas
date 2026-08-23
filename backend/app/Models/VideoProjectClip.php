<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Task #6a (Video Studio) — one item in a video_project's media bin.
 * See create_video_project_clips_table migration for how `kind` +
 * `parent_clip_id` + `dubbing_job_id` model dubbing as a clip variant
 * that reuses the existing DubbingJob pipeline unchanged.
 */
class VideoProjectClip extends Model
{
    protected $keyType = 'string';
    public $incrementing = false;

    protected $fillable = [
        'id', 'video_project_id', 'kind', 'parent_clip_id', 'dubbing_job_id',
        'original_filename', 'storage_path', 'duration_seconds', 'status',
    ];

    protected $casts = [
        'duration_seconds' => 'float',
    ];

    public function project(): BelongsTo
    {
        return $this->belongsTo(VideoProject::class, 'video_project_id');
    }

    public function parentClip(): BelongsTo
    {
        return $this->belongsTo(VideoProjectClip::class, 'parent_clip_id');
    }

    public function dubbedVariants(): HasMany
    {
        return $this->hasMany(VideoProjectClip::class, 'parent_clip_id');
    }

    public function dubbingJob(): BelongsTo
    {
        return $this->belongsTo(DubbingJob::class, 'dubbing_job_id');
    }
}
