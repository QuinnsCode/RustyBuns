// Q Keys' firmware logic: see keys.h. Listens on every MIDI channel.
#include "keys.h"

static const uint8_t DIVS[3] = { 24, 12, 6 };

void keys_init(Keys *k) {
  uint8_t *p = (uint8_t *)k;
  for (unsigned i = 0; i < sizeof *k; i++) p[i] = 0;
  k->div = DIVS[1];
  k->dirty = 1;
}

// The clock out for the tick now: high for the first half of each Div.
static void clock_out(Keys *k) { k->clock = (uint8_t)(k->tick % k->div < k->div / 2u); }

static void forget(Keys *k, uint8_t note) {
  uint8_t j = 0;
  for (uint8_t i = 0; i < k->count; i++) if (k->held[i] != note) k->held[j++] = k->held[i];
  k->count = j;
}

static void note(Keys *k, uint8_t n, uint8_t vel) {
  forget(k, n);
  if (vel > 0) {
    if (k->count == KEYS_HELD) forget(k, k->held[0]);
    k->held[k->count++] = n;
    // vel / 127 of the top, rounded (127 is odd, so there's never a half to round).
    k->code_b = (uint16_t)(((uint32_t)vel * KEYS_DAC_TOP + 63) / 127);
  }
  if (k->count > 0) {
    // (n - C2) / 12 octaves of a volt, halved for U5's gain of two, in 1 mV steps: (n - 36) * 1000 / 24, rounded.
    uint8_t last = k->held[k->count - 1];
    uint32_t c = last < KEYS_BASE ? 0 : ((uint32_t)(last - KEYS_BASE) * 1000 + 12) / 24;
    k->code_a = (uint16_t)(c > KEYS_DAC_TOP ? KEYS_DAC_TOP : c);
  }
  k->gate = k->count > 0;
  k->dirty = 1;
}

// A channel message's data bytes, by status (0x80 to 0xE0): two, except program change and channel pressure.
static uint8_t wants(uint8_t status) { uint8_t t = status & 0xF0; return t == 0xC0 || t == 0xD0 ? 1 : 2; }

void keys_byte(Keys *k, uint8_t b) {
  if (b >= 0xF8) {           // real time: anywhere, even between a message's bytes
    if (b == 0xF8) { clock_out(k); k->tick = (uint8_t)((k->tick + 1) % KEYS_PPQN); }
    else if (b == 0xFA) { k->tick = 0; k->clock = 0; }
    else if (b == 0xFC) k->clock = 0;
    return;
  }
  if (b >= 0xF0) {           // system common: ends running status; the song position is the only one kept
    k->status = b == 0xF2 ? b : 0;
    k->have = 0;
    return;
  }
  if (b & 0x80) { k->status = b; k->have = 0; return; }
  if (!k->status) return;
  k->data[k->have++] = b;
  if (k->status == 0xF2) {   // song position: sixteenths since the start, 14 bits, six ticks each
    if (k->have == 2) { k->tick = (uint8_t)((k->data[0] | (k->data[1] << 7)) % 4 * 6); k->status = 0; k->have = 0; }
    return;
  }
  if (k->have < wants(k->status)) return;
  k->have = 0;
  uint8_t t = k->status & 0xF0;
  if (t == 0x90) note(k, k->data[0], k->data[1]);
  else if (t == 0x80) note(k, k->data[0], 0);
  else if (t == 0xB0 && (k->data[0] == 123 || k->data[0] == 120)) { k->count = 0; k->gate = 0; k->dirty = 1; } // all notes off
}

void keys_div(Keys *k, uint16_t adc) {
  uint8_t i = (uint8_t)((uint32_t)adc * 3 / 1024);
  k->div = DIVS[i > 2 ? 2 : i];
}
