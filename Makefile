CC = clang
CFLAGS = -Wall -Wextra -std=c11

TARGET = process_monitor
SOURCE = src/process_monitor.c

all: $(TARGET)

$(TARGET): $(SOURCE)
	$(CC) $(CFLAGS) $(SOURCE) -o $(TARGET)

run: $(TARGET)
	./$(TARGET)

clean:
	rm -f $(TARGET)

.PHONY: all run clean