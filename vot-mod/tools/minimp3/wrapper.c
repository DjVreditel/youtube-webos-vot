#define MINIMP3_IMPLEMENTATION
#include "minimp3.h"

static mp3dec_t decoder;
static mp3dec_frame_info_t info;
static short pcm[MINIMP3_MAX_SAMPLES_PER_FRAME];
static int frame[3];

void mp3_init(void) {
  mp3dec_init(&decoder);
}

int mp3_decode(const unsigned char *data, int size) {
  int samples = mp3dec_decode_frame(&decoder, data, size, pcm, &info);
  frame[0] = info.frame_bytes;
  frame[1] = info.channels;
  frame[2] = info.hz;
  return samples;
}

short *mp3_pcm(void) {
  return pcm;
}

int *mp3_frame(void) {
  return frame;
}
