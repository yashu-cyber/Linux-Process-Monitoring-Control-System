# Linux Process Monitoring and Control System

A terminal-based system programming application developed in C for monitoring, inspecting, creating, and controlling processes using operating-system process management mechanisms.

## Overview

The Linux Process Monitoring and Control System is a command-line application designed to demonstrate practical Operating Systems and System Programming concepts.

The application provides a central interface for discovering running processes, inspecting process information, creating new processes, monitoring processes during execution, controlling processes using signals, and representing parent-child process relationships.

The project focuses on user-space system programming and demonstrates process-management mechanisms such as `fork()`, `exec()`, signals, process identification, and periodic monitoring.

## Objectives

- Discover and display running processes.
- Inspect information about a selected process.
- Create and launch new processes.
- Monitor a running process over a selected period.
- Control processes using operating-system signals.
- Demonstrate process creation using `fork()`.
- Demonstrate program execution using `exec()`.
- Provide a practical terminal-based demonstration of process management.

## Features

### 1. Process Dashboard / Process Discovery

The Process Dashboard is the main entry point of the application.

It displays information about currently running processes, including:

- Process ID (PID)
- Process name
- Total process count
- Available process-state information

The dashboard can be refreshed to obtain an updated process list.

### 2. Process Inspector

The Process Inspector allows the user to inspect a selected process using its PID.

The current implementation displays:

- Process ID
- Process name
- Executable path

On the Linux target environment, the inspector is designed to obtain additional process information through the `/proc/<PID>/` interface.

### 3. Process Control

The Process Control module allows the user to control a selected process using operating-system signals.

Available operations:

- Stop Process
- Continue Process
- Terminate Process
- Force Kill Process
- Cancel

The implementation demonstrates the following signals:

- `SIGSTOP`
- `SIGCONT`
- `SIGTERM`
- `SIGKILL`

These operations demonstrate how a user-space application can communicate with and control running processes through the operating system.

### 4. Process Creation and Launch

The Process Creation and Launch module allows the user to enter a command and launch it as a new process.

The implementation demonstrates:

- `fork()`
- `exec()`

Example:

~~~bash
sleep 60
~~~

The newly created process can then be discovered through the Process Dashboard and used for inspection, monitoring, and control.

### 5. Live Process Monitoring

The Live Process Monitoring module periodically checks a selected process while it is running.

The user specifies:

- Process ID
- Monitoring duration

The application performs periodic checks and displays the process status during the monitoring period.

This allows the user to observe process behavior while the process is active.

### 6. Process Tree

The Process Tree module provides the foundation for representing parent-child relationships between processes.

The Linux implementation is intended to use:

- PID
- PPID
- `/proc`
- Parent-child process relationships

The current development version provides the process-tree interface and process-list foundation. Complete hierarchical PID/PPID traversal is reserved for the Linux-specific implementation.

## Operating System Concepts Demonstrated

| Operating System Concept | Demonstration |
|---|---|
| Process Identification | Process discovery using PIDs |
| Process Creation | `fork()` |
| Program Execution | `exec()` |
| Process Control | Linux/POSIX signals |
| Process Monitoring | Periodic process observation |
| Parent-Child Relationships | PID and PPID |
| User-Space System Programming | Terminal-based OS interaction |
| Linux Process Information | `/proc` interface |

## Technologies Used

- **Language:** C
- **System Programming:** POSIX/Linux process-management concepts
- **Target Platform:** Linux / Ubuntu
- **Compiler:** GCC / Clang
- **Process Information:** Linux `/proc`
- **Version Control:** Git
- **Repository:** GitHub

## Project Structure

~~~text
Linux-Process-Monitoring-Control-System/
├── src/
│   └── process_monitor.c
├── screenshots/
├── docs/
│   ├── ABSTRACT.md
│   └── REPORT.md
├── Makefile
├── README.md
└── .gitignore
~~~

## Compilation

The project includes a Makefile for building the application.

~~~bash
make
~~~

The application can also be compiled manually:

~~~bash
clang src/process_monitor.c -o process_monitor
~~~

## Running the Application

Using the Makefile:

~~~bash
make run
~~~

Or directly:

~~~bash
./process_monitor
~~~

## Main Menu

~~~text
[1] Process Dashboard
[2] Process Inspector
[3] Process Control
[4] Process Creation & Launch
[5] Live Process Monitoring
[6] Process Tree
[7] Refresh Dashboard
[8] Exit
~~~

## Demonstration Workflow

~~~text
Process Creation
       ↓
Create a controlled process
       ↓
Process Dashboard
       ↓
Discover the process
       ↓
Process Inspector
       ↓
Inspect process information
       ↓
Live Process Monitoring
       ↓
Observe the running process
       ↓
Process Control
       ↓
Stop / Continue / Terminate
       ↓
Refresh Dashboard
       ↓
Verify process state
~~~

## Testing

Controlled processes such as `sleep 60` and `sleep 120` were used during testing.

| Feature | Test Performed | Result |
|---|---|---|
| Process Dashboard | Display running processes | PASS |
| Process Inspector | Inspect selected PID | PASS |
| Process Control | Stop / Continue / Terminate | PASS |
| Process Creation | Launch `sleep` process | PASS |
| Live Process Monitoring | Monitor running process | PASS |
| Process Tree | Process listing/interface | PARTIAL |

### Process Control Test

A controlled `sleep` process was used to safely test signal-based process management.

The process was:

1. Created using the Process Creation module.
2. Stopped using `SIGSTOP`.
3. Continued using `SIGCONT`.
4. Terminated using `SIGTERM`.
5. Verified through the dashboard after termination.

## Platform Note

Development and initial testing were performed on macOS using the available process-management APIs.

The intended target environment for the project is Linux/Ubuntu because the project requirements emphasize Linux/POSIX system programming and Linux interfaces such as the `/proc` filesystem.

Linux-specific functionality such as complete `/proc/<PID>/` process inspection and complete hierarchical PID/PPID process-tree traversal is therefore reserved for the Linux target implementation.

## Limitations

- Initial development and testing were performed on macOS.
- Complete Linux `/proc/<PID>/` integration is not implemented in the current development version.
- Complete hierarchical PID/PPID traversal is not implemented in the current Process Tree module.
- Process-state information is platform-dependent during macOS development.
- Advanced CPU and memory graphs are not included.
- The application is intentionally terminal-based.

## Future Improvements

- Complete Linux `/proc/<PID>/` integration.
- Full hierarchical process-tree traversal.
- CPU and memory utilization monitoring.
- Process filtering and sorting.
- Additional process statistics.
- Improved Linux-specific process-state detection.
- More detailed resource monitoring.

## Documentation

Additional documentation is available in the `docs/` directory:

- `ABSTRACT.md` — Project abstract
- `REPORT.md` — Detailed project report

## Academic Purpose

This project was developed as a practical implementation of Operating Systems and System Programming concepts.

It demonstrates how user-space applications can interact with operating-system process mechanisms to create, execute, monitor, and control processes.

## Conclusion

The Linux Process Monitoring and Control System combines process discovery, process inspection, process creation, live monitoring, signal-based process control, and a process-tree interface into a single terminal-based system-programming application.

The project provides a practical foundation for understanding process management and Linux system programming while allowing further extension with Linux-specific process information and resource-monitoring capabilities.

## License

This project was developed for academic and educational purposes.
