# Synthetic MP3 decoder fixtures

These two 1.6-second mono tones are generated test data, with no user audio.
Each contains more than the decoder's 25-frame processing slice so concurrent
decode calls overlap before completion. Tests read the committed files; CI does
not need FFmpeg.

Recreate with FFmpeg (libmp3lame):

```sh
ffmpeg -v error -f lavfi -i 'sine=frequency=440:sample_rate=44100:duration=1.6' -c:a libmp3lame -b:a 96k -f mp3 tone-440.mp3
ffmpeg -v error -f lavfi -i 'sine=frequency=880:sample_rate=44100:duration=1.6' -c:a libmp3lame -b:a 96k -f mp3 tone-880.mp3
```

The tests compare parallel decoding to serial decoding with the same decoder,
including sample counts and PCM values, rather than relying on encoder padding.
