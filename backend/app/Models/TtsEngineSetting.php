<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class TtsEngineSetting extends Model
{
    protected $fillable = ['engine', 'enabled'];

    protected $casts = [
        'enabled' => 'boolean',
    ];

    public $timestamps = true;
}
