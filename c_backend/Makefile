CC ?= gcc
CFLAGS ?= -std=c11 -O2 -Wall -Wextra

.PHONY: all clean

all: process_monitor

process_monitor: ../process_monitor.c
	$(CC) $(CFLAGS) $< -o $@.tmp
	mv $@.tmp $@

clean:
	rm -f process_monitor process_monitor.tmp