<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Project extends Model
{
    protected $keyType = 'string';
    public $incrementing = false;
    protected $guarded = [];
    protected $casts = [
        'timeline_clips' => 'array',
    ];

    public function user()
    {
        return $this->belongsTo(User::class);
    }

    public function scripts()
    {
        return $this->hasMany(Script::class)->orderBy('order_index');
    }
}
