# RVC models directory

`apply_rvc_conversion()` in `main.py` looks here for a **trained** model per
voice profile:

```
rvc_models/
  {profile_id}/
    model.pth      required
    model.index    optional, improves timbre match — recommended
```

## This is the part that doesn't come for free

XTTS and F5 are zero-shot: a 6-30s reference clip is enough because the
model was trained to condition on arbitrary short references. RVC is not
zero-shot in the same way — `model.pth` is a small model **trained on this
specific voice**, and that training has to happen before this directory has
anything useful in it for a given `profile_id`.

Practically, that means:

1. Collect more reference audio for the profile than Voxora's own recorder
   captures today — RVC training wants a few minutes of clean speech, not
   10-30 seconds. The multi-clip upload (now supported) gets you closer,
   but 4 short takes (~1-2 min) is still on the thin side for a from-scratch
   RVC model; results will be usable but not as tight as a model trained on
   5-10+ minutes.
2. Train with RVC's own trainer (e.g. the RVC-WebUI one-click trainer, or
   any pipeline that outputs the standard `.pth`/`.index` pair) on a GPU.
   Expect roughly 10-30 minutes of training time, not something to run
   inline during a user's recording session.
3. Drop the resulting `model.pth` (and `model.index`, if produced) into
   `rvc_models/{profile_id}/`.
4. Set `RVC_ENABLED=1` on the ai-engine process. Profiles without a
   trained model here are unaffected — `apply_rvc_conversion()` silently
   passes their audio through unchanged.

## Alternative worth considering

If a same-day "record → clone" flow matters more than maximum similarity,
a zero-shot voice-conversion model (e.g. OpenVoice's tone-color converter)
is a closer architectural fit than RVC — it remaps timbre from a short
reference with no training step, the same way XTTS/F5 already work here.
RVC generally edges it out on similarity once trained, but only after
that offline training step. Worth deciding which tradeoff the product
wants before investing further in the RVC path specifically.

## Setup

This sandbox's network can reach PyPI/GitHub but not huggingface.co (where
RVC's pretrained content-encoder/pitch-extractor components are typically
hosted), so the actual `pip install -r requirements-rvc.txt` and model
download/training need to happen on a host with full internet access (your
EC2 GPU box, not here). The integration code above is ready for it —
this step is asset acquisition, not more code.
