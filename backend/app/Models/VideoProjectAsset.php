<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Str;

/**
 * Task #15 (Video Studio) Phase 1 — one entry in a project's media bin.
 * See the migration docblock for the kind/source/parent_asset_id design —
 * this deliberately isn't scoped to "video clip" the way task #6a's
 * VideoProjectClip was, since Phase 2/4 add image and audio (including
 * derived audio) assets to the same table.
 */
class VideoProjectAsset extends Model
{
    protected $table = 'video_project_assets';

    protected $keyType = 'string';
    public $incrementing = false;

    protected static function boot(): void
    {
        parent::boot();
        static::creating(function (VideoProjectAsset $asset) {
            if (! $asset->id) {
                $asset->id = (string) Str::uuid();
            }
        });
    }

    protected $fillable = [
        'id', 'video_project_id', 'kind', 'source',
        'parent_asset_id', 'dubbing_job_id',
        'original_filename', 'storage_path', 'duration_seconds', 'status', 'error',
        'transcript_json', 'detected_language',
    ];

    protected $casts = [
        'duration_seconds' => 'float',
        // Same schemaless-JSON-blob choice as DubbingJob::segments_json —
        // see the Phase 4 migration's docblock for why this isn't its own
        // table. Only ever populated on an 'extracted_audio' asset.
        'transcript_json'  => 'array',
    ];

    public function project(): BelongsTo
    {
        return $this->belongsTo(VideoProject::class, 'video_project_id');
    }

    public function parent(): BelongsTo
    {
        return $this->belongsTo(VideoProjectAsset::class, 'parent_asset_id');
    }

    public function children(): HasMany
    {
        return $this->hasMany(VideoProjectAsset::class, 'parent_asset_id');
    }

    public function dubbingJob(): BelongsTo
    {
        return $this->belongsTo(DubbingJob::class, 'dubbing_job_id');
    }
}
