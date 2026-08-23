<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Task #6a (Video Studio) — the parent entity for the media-bin / timeline
 * video editor. See create_video_projects_table migration for the full
 * rationale and docs/ENHANCEMENT_TASKS.md task #6a for the phased plan.
 */
class VideoProject extends Model
{
    protected $keyType = 'string';
    public $incrementing = false;

    protected $fillable = [
        'id', 'user_id', 'name', 'timeline_json',
        'status', 'output_video_path', 'duration_seconds', 'error',
    ];

    protected $casts = [
        'timeline_json'    => 'array',
        'duration_seconds' => 'float',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function clips(): HasMany
    {
        return $this->hasMany(VideoProjectClip::class)->orderBy('created_at');
    }
}
