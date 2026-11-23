// keys.c on a computer, for test/wall-firmware.test.ts: each line in is MIDI bytes in hex ("90 30 65"), or "div N"
// for the knob's ADC reading; each line out is the state after it: DAC A's code, DAC B's, the gate, the clock, Div.
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include "keys.h"

int main(void) {
  Keys k;
  keys_init(&k);
  char line[1024];
  while (fgets(line, sizeof line, stdin)) {
    if (strncmp(line, "div ", 4) == 0) keys_div(&k, (uint16_t)atoi(line + 4));
    else for (char *p = strtok(line, " \t\r\n"); p; p = strtok(NULL, " \t\r\n")) keys_byte(&k, (uint8_t)strtoul(p, NULL, 16));
    printf("%u %u %u %u %u\n", k.code_a, k.code_b, k.gate, k.clock, k.div);
  }
  return 0;
}
