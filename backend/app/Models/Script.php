<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Script extends Model
{
    protected $keyType = 'string';
    public $incrementing = false;
    protected $guarded = [];
    protected $casts = [
        'has_audio' => 'boolean',
        'waveform_peaks' => 'array',
    ];

    public function project()
    {
        return $this->belongsTo(Project::class);
    }
}
