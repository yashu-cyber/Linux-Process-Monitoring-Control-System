# Linux Process Monitoring and Control System

A terminal-based system programming project for monitoring, inspecting, launching, and controlling processes using operating-system process management mechanisms.

## Overview

The Linux Process Monitoring and Control System is a command-line application designed to demonstrate practical operating system concepts through process management.

The system provides a central process dashboard and allows the user to inspect running processes, launch new processes, monitor them over time, and control them using operating-system signals.

The project is implemented in C and uses POSIX-style process management concepts such as process creation, program execution, signals, and process identification.

## Objectives

- Discover and display currently running processes.
- Inspect information about a selected process.
- Create and launch new processes.
- Monitor a process while it is running.
- Control processes using operating-system signals.
- Demonstrate practical process-management concepts through a terminal application.

## Features

### 1. Process Dashboard

Displays the currently running processes along with:

- Process ID (PID)
- Process name
- Process count
- Process state information available on the development platform

The dashboard can also be refreshed to obtain an updated process list.

### 2. Process Inspector

Allows the user to enter a PID and retrieve information about the selected process, including:

- PID
- Process name
- Executable path

### 3. Process Control

Allows a process to be controlled using operating-system signals:

- Stop Process
- Continue Process
- Terminate Process
- Force Kill Process

The implementation uses signals such as:

- `SIGSTOP`
- `SIGCONT`
- `SIGTERM`
- `SIGKILL`

### 4. Process Creation and Launch

Allows the user to enter a command and launch it as a new process.

The implementation demonstrates:

- `fork()`
- `exec()`

Example test command:

```bash
sleep 60