# LINUX PROCESS MONITORING AND CONTROL SYSTEM

## 1. Introduction

Process management is a fundamental responsibility of an operating system. A modern operating system continuously creates, schedules, monitors, and terminates processes while providing mechanisms through which users and applications can interact with them.

The Linux Process Monitoring and Control System is a terminal-based system programming project developed to demonstrate these process-management concepts through a practical C application. The system provides a centralized interface through which users can discover running processes, inspect process information, create new processes, monitor their execution, and control them using operating-system signals.

The application focuses on user-space process management and uses system-level programming mechanisms such as process identification, process creation, program execution, and signals. Controlled test processes are used to demonstrate the behavior of these mechanisms safely.

The project is designed as an educational implementation of operating-system concepts and provides a foundation for extending the application with additional Linux-specific process information and resource-monitoring capabilities.

## 2. Problem Definition

Managing and observing running processes is an important operating-system task. Users may need to identify active processes, inspect process information, start new processes, observe their execution, and control processes that are running.

Traditional system utilities provide these capabilities, but implementing a simplified process-management system is useful for understanding how operating-system mechanisms work internally.

The problem addressed by this project is to develop a command-line application that demonstrates essential process-management operations through system-level programming. The application should provide a simple interface for discovering processes, inspecting selected processes, creating and launching processes, monitoring their availability, and controlling them through operating-system signals.

The project focuses on demonstrating the relationship between a user-level application and operating-system process-management mechanisms rather than providing a graphical user interface or a general-purpose process-management product.

## 3. Objectives

The main objectives of the Linux Process Monitoring and Control System are:

1. To develop a terminal-based application for process monitoring and control.

2. To discover and display currently running processes using system-level process APIs.

3. To inspect information associated with a selected process using its Process ID (PID).

4. To demonstrate process creation and program execution using `fork()` and `exec()`.

5. To monitor a running process periodically for a specified duration.

6. To demonstrate process control using operating-system signals such as `SIGSTOP`, `SIGCONT`, `SIGTERM`, and `SIGKILL`.

7. To provide a simple command-line interface through which the different process-management operations can be accessed.

8. To understand the relationship between user-space applications and operating-system process-management mechanisms.

9. To provide a foundation for Linux-specific process hierarchy and `/proc` filesystem integration.

## 4. System Design

The system follows a modular command-line design in which a main menu provides access to the different process-management operations.

### 4.1 System Workflow

The general workflow of the application is:

```text
                    +----------------------+
                    |   Main Menu          |
                    +----------+-----------+
                               |
          +--------------------+--------------------+
          |          |          |          |         |
          v          v          v          v         v
     Dashboard   Inspector   Control   Creation   Monitoring
          |          |          |          |         |
          v          v          v          v         v
     Process     Process    Signals    fork()     Periodic
     Discovery   Details               exec()     Checking

## 5. Implementation

The application is implemented as a C-based command-line program. Each major operation is organized as a separate function, while the main menu controls the overall execution flow.

### 5.1 Process Discovery

The process dashboard retrieves the available process identifiers and obtains the corresponding process names. The information is formatted into a table so that the user can observe the currently available processes.

The implementation uses process-management APIs provided by the development platform.

### 5.2 Process Inspection

The process inspector accepts a PID from the user and retrieves information associated with that process.

The current implementation displays:

- Process ID
- Process name
- Executable path

This allows the user to select a running process and examine basic information about it.

### 5.3 Process Control

The process-control module uses the `kill()` system call to send signals to a selected process.

The following signals are supported:

```text
SIGSTOP  → Stop the process
SIGCONT  → Continue the process
SIGTERM  → Request process termination
SIGKILL  → Force process termination

## 6. Operating System Concepts

The project demonstrates several fundamental operating-system and system-programming concepts through direct interaction with processes.

### 6.1 Process Identification

Every running process is associated with a Process ID (PID). The application uses the PID to identify and operate on individual processes.

### 6.2 Process Creation

The `fork()` mechanism is used to create a new child process. This demonstrates the operating-system concept of creating a new execution context from an existing process.

### 6.3 Program Execution

After creating a child process, `exec()` is used to replace the child process image with the requested program. This demonstrates the separation between process creation and program execution.

### 6.4 Process Control Using Signals

Signals provide a mechanism for controlling processes. The project demonstrates:

- `SIGSTOP` for stopping a process.
- `SIGCONT` for continuing a stopped process.
- `SIGTERM` for requesting process termination.
- `SIGKILL` for forcefully terminating a process.

### 6.5 Process Monitoring

The project repeatedly checks the availability of a selected process during a specified monitoring period. This demonstrates how a user-space application can observe changes in process execution.

### 6.6 Parent-Child Process Relationship

Processes can form parent-child relationships. The project includes a process-tree interface intended to represent these relationships using PID and PPID information in the Linux implementation.

### 6.7 User-Space System Programming

The project operates as a user-space application and interacts with operating-system process-management mechanisms through system and POSIX-style interfaces rather than modifying the operating-system kernel.

## 7. Testing and Results

Testing was performed by executing each implemented feature individually and observing the resulting process behavior.

### 7.1 Process Dashboard Test

The application was launched and the Process Dashboard option was selected.

**Expected Result:**
The application should display the current process list and the total number of available processes.

**Observed Result:**
The dashboard successfully displayed the process list and process count.

**Status:** PASS

### 7.2 Process Inspector Test

A valid PID from the process dashboard was entered into the Process Inspector.

**Expected Result:**
The application should display information associated with the selected process.

**Observed Result:**
The application successfully displayed the PID, process name, and executable path.

**Status:** PASS

### 7.3 Process Control Test

A controlled `sleep` process was created and its PID was used for process-control testing.

The following sequence was tested:

```text
SIGSTOP → SIGCONT → SIGTERM

## 8. Performance and Behavior Analysis

The system was evaluated by observing the behavior of each implemented process-management operation during controlled testing.

### 8.1 Process Discovery Behavior

The Process Dashboard successfully retrieved and displayed the currently available processes. The total process count may change between executions because operating-system processes are continuously created and terminated.

### 8.2 Process Inspection Behavior

The Process Inspector successfully retrieved information for valid PIDs. When a process is no longer available, the application reports that the process cannot be found.

### 8.3 Process Control Behavior

Process-control operations were tested using a controlled `sleep` process. The process responded correctly to the tested signals.

The observed sequence was:

```text
Running
   ↓
SIGSTOP
   ↓
Stopped
   ↓
SIGCONT
   ↓
Running
   ↓
SIGTERM
   ↓
Terminated

## 9. Limitations

The current implementation has the following limitations:

1. The development environment is macOS, while the target environment for the project is Linux/Ubuntu.

2. The current process-information layer uses macOS process APIs for development and testing.

3. Linux `/proc`-based process information has not yet been integrated into the development build.

4. The complete parent-child process hierarchy is therefore not available in the current development implementation.

5. Process state information is platform-dependent in the current build.

6. The application currently focuses on core process-management operations and does not provide advanced CPU, memory, or graphical resource visualization.

These limitations identify the parts of the system that require Linux-specific implementation or future extension.

## 10. Conclusion

The Linux Process Monitoring and Control System demonstrates fundamental operating-system process-management concepts through a practical command-line application.

The implemented system successfully provides process discovery, process inspection, process creation and execution, live process monitoring, and signal-based process control. Testing with controlled processes demonstrated the ability to create, observe, stop, continue, and terminate processes.

The project provides practical experience with system-level programming concepts and demonstrates how user-space applications interact with operating-system process-management mechanisms.

The current implementation also establishes a foundation for Linux-specific extensions, particularly the use of the `/proc` filesystem for detailed process information and parent-child process hierarchy construction.

## 11. References

1. OSSP Project Implementation Guidelines, course-provided project guidelines.

2. Linux manual pages and system documentation for process-management interfaces including `fork()`, `exec()`, `kill()`, and process signals.

3. POSIX documentation for process management and signal handling.

4. Linux `/proc` filesystem documentation for process information and process hierarchy.