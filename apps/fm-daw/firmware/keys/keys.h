// Q Keys' firmware logic (WALL.md, circuits/wall-keys.tsx): MIDI bytes in, what the DAC, the gate and the clock
// should be out. No hardware here, so the same file builds for the ATtiny1614 (main.c) and on a computer for the test
// that plays the same notes through it and the sim's `Keys` (test/wall-firmware.test.ts).
#ifndef KEYS_H
#define KEYS_H
#include <stdint.h>

// The key at 0 V (C2), the DAC's top code, the MIDI clock's ticks a beat, and how many keys it remembers held.
#define KEYS_BASE 36
#define KEYS_DAC_TOP 4095
#define KEYS_PPQN 24
#define KEYS_HELD 16

typedef struct {
  uint8_t held[KEYS_HELD]; // keys down, oldest first
  uint8_t count;
  uint16_t code_a;         // pitch: 1 mV a step (U5's gain of two makes it 1 V an octave), C2 at 0
  uint16_t code_b;         // the last key's velocity, 0 to the top
  uint8_t gate;            // high while any key is
  uint8_t clock;           // high for the first half of each Div
  uint8_t div;             // Div in MIDI clock ticks: 24, 12 or 6
  uint8_t tick;            // MIDI clock ticks into the beat (every Div divides it), from Start or the song position
  uint8_t status;          // running status, 0 for none
  uint8_t data[2];
  uint8_t have;
  uint8_t dirty;           // the DAC needs writing
} Keys;

void keys_init(Keys *k);
// One byte off the serial in.
void keys_byte(Keys *k, uint8_t b);
// The Div knob's wiper on the 10-bit ADC (0 to 1023), in thirds: quarters, eighths, sixteenths.
void keys_div(Keys *k, uint16_t adc);

#endif
