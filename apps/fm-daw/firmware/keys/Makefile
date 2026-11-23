# Q Keys' firmware for its ATtiny1614: `make` builds keys.hex with avr-gcc (Debian/Ubuntu: gcc-avr avr-libc),
# `make flash` programs it over UPDI on JP3 with a serial UPDI adapter (pymcuprog; PORT=/dev/ttyUSB0).
MCU = attiny1614
CFLAGS = -mmcu=$(MCU) -Os -std=c11 -Wall -Wextra -Werror -ffunction-sections -fdata-sections
PORT ?= /dev/ttyUSB0

keys.hex: keys.elf
	avr-objcopy -O ihex -R .eeprom $< $@
	avr-size $<

keys.elf: main.c keys.c keys.h
	avr-gcc $(CFLAGS) -Wl,--gc-sections -o $@ main.c keys.c

flash: keys.hex
	pymcuprog write -t uart -u $(PORT) -d $(MCU) -f keys.hex --erase --verify

clean:
	rm -f keys.elf keys.hex

.PHONY: flash clean
