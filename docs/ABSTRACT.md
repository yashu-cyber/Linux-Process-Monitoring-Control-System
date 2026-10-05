# ABSTRACT

The Linux Process Monitoring and Control System is a terminal-based system programming application designed to demonstrate practical operating system concepts related to process management. The system provides a centralized interface for discovering and monitoring running processes and performing basic process-management operations.

The application is implemented in C using POSIX-style process management mechanisms. It provides a process dashboard for discovering active processes, a process inspector for viewing process information, process creation and execution using `fork()` and `exec()`, live process monitoring, and signal-based process control using `SIGSTOP`, `SIGCONT`, `SIGTERM`, and `SIGKILL`.

The system is designed as a user-space application and focuses on demonstrating how operating systems create, execute, monitor, and control processes. A process-tree interface is also included as a foundation for Linux-specific parent-child process hierarchy implementation using the `/proc` filesystem.

The project provides a practical demonstration of process identification, process creation, program execution, signals, process monitoring, and process control through a simple command-line interface. Testing is performed using controlled processes such as `sleep`, allowing process creation, monitoring, stopping, continuation, and termination to be demonstrated safely.

The project serves as an educational implementation of operating system and Linux system-programming concepts while providing a foundation that can be extended with additional Linux process and resource-monitoring capabilities.