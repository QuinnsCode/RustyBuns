// Q Keys on its ATtiny1614 (circuits/wall-keys.tsx): MIDI in on USART0's RX (PB3, 31250 baud, from the opto), the
// MCP4822 on SPI0 (PA1 MOSI, PA3 SCK, PA4 its CS; LDAC is tied low, so CS rising latches it), the gate on PA6, the
// clock on PA7 and the Div knob's wiper on PB1 (AIN10). The logic is keys.c. Programmed over UPDI on JP3.
#include <avr/io.h>
#include <avr/interrupt.h>
#include "keys.h"

#define F_CPU 20000000UL
#define MIDI_BAUD 31250UL

// The MCP4822's command: channel B in bit 15, gain 2x (bit 13 clear: 2.048 V full scale, 1 mV a step), on (bit 12).
#define DAC_A 0x1000
#define DAC_B 0x9000

// MIDI bytes off the serial in, kept by its interrupt so a burst of them is never lost while the DAC is written.
static volatile uint8_t ring[64];
static volatile uint8_t head, tail;

ISR(USART0_RXC_vect) {
  uint8_t b = USART0.RXDATAL, next = (uint8_t)((head + 1) & 63);
  if (next != tail) { ring[head] = b; head = next; }
}

static void spi_word(uint16_t w) {
  PORTA.OUTCLR = PIN4_bm;
  SPI0.DATA = (uint8_t)(w >> 8);
  while (!(SPI0.INTFLAGS & SPI_IF_bm)) {}
  SPI0.DATA = (uint8_t)w;
  while (!(SPI0.INTFLAGS & SPI_IF_bm)) {}
  PORTA.OUTSET = PIN4_bm;
}

static void setup(void) {
  _PROTECTED_WRITE(CLKCTRL.MCLKCTRLB, 0); // the 20 MHz oscillator undivided (the board runs at 5 V)

  PORTA.OUTSET = PIN4_bm;                  // CS idles high
  PORTA.DIRSET = PIN1_bm | PIN3_bm | PIN4_bm | PIN6_bm | PIN7_bm;
  SPI0.CTRLB = SPI_SSD_bm;                 // mode 0, and PA4 is ours, not a slave select
  SPI0.CTRLA = SPI_MASTER_bm | SPI_CLK2X_bm | SPI_PRESC_DIV4_gc | SPI_ENABLE_bm; // 10 MHz, the DAC's 20 MHz is the top

  PORTB.PIN3CTRL = PORT_PULLUPEN_bm;       // R2 pulls it up too; this holds it with the opto unplugged
  USART0.BAUD = (uint16_t)(4 * F_CPU / MIDI_BAUD);
  USART0.CTRLA = USART_RXCIE_bm;
  USART0.CTRLB = USART_RXEN_bm;

  PORTB.PIN1CTRL = PORT_ISC_INPUT_DISABLE_gc;
  ADC0.CTRLC = ADC_REFSEL_VDDREF_gc | ADC_PRESC_DIV16_gc; // the wiper against the 5 V it swings over, 1.25 MHz
  ADC0.MUXPOS = ADC_MUXPOS_AIN10_gc;
  ADC0.CTRLA = ADC_FREERUN_bm | ADC_ENABLE_bm;
  ADC0.COMMAND = ADC_STCONV_bm;

  sei();
}

int main(void) {
  static Keys k;
  keys_init(&k);
  setup();
  for (;;) {
    while (tail != head) { keys_byte(&k, ring[tail]); tail = (uint8_t)((tail + 1) & 63); }
    if (ADC0.INTFLAGS & ADC_RESRDY_bm) keys_div(&k, ADC0.RES); // reading RES clears the flag
    if (k.gate) PORTA.OUTSET = PIN6_bm; else PORTA.OUTCLR = PIN6_bm;
    if (k.clock) PORTA.OUTSET = PIN7_bm; else PORTA.OUTCLR = PIN7_bm;
    if (k.dirty) { k.dirty = 0; spi_word(DAC_A | k.code_a); spi_word(DAC_B | k.code_b); }
  }
}
