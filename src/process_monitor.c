#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/types.h>
#include <signal.h>
#include <libproc.h>

#define MAX_PROCESSES 4096

/* =========================================================
   Utility Functions
   ========================================================= */

void clear_screen(void) {
    system("clear");
}

int get_process_list(int pids[]) {

    int count = proc_listallpids(
        pids,
        sizeof(int) * MAX_PROCESSES
    );

    if (count <= 0) {
        return 0;
    }

    return count / sizeof(int);
}

/* =========================================================
   FEATURE 1
   Process Dashboard / Discovery
   ========================================================= */

void display_processes(void) {

    int pids[MAX_PROCESSES];
    int count = get_process_list(pids);

    if (count <= 0) {
        printf("\nUnable to retrieve process list.\n");
        return;
    }

    printf("\n");
    printf("====================================================================\n");
    printf("             LINUX PROCESS MONITOR & CONTROL SYSTEM\n");
    printf("====================================================================\n\n");

    printf("Total Processes: %d\n\n", count);

    printf("%-8s %-8s %-30s %-12s\n",
           "PID",
           "PPID",
           "NAME",
           "STATE");

    printf("--------------------------------------------------------------------\n");

    for (int i = 0; i < count; i++) {

        int pid = pids[i];

        if (pid <= 0)
            continue;

        char name[PROC_PIDPATHINFO_MAXSIZE];

        memset(name, 0, sizeof(name));

        proc_name(pid, name, sizeof(name));

        if (name[0] == '\0') {
            strcpy(name, "Unknown");
        }

        /*
         * macOS does not expose Linux-style /proc process
         * states. The Linux implementation will provide
         * the actual process state.
         */

        printf("%-8d %-8s %-30s %-12s\n",
               pid,
               "-",
               name,
               "Available");
    }

    printf("--------------------------------------------------------------------\n");
}

/* =========================================================
   FEATURE 2
   Process Inspector
   ========================================================= */

void process_inspector(void) {

    int pid;

    printf("\n================ PROCESS INSPECTOR ================\n");

    printf("Enter PID: ");
    scanf("%d", &pid);

    char name[PROC_PIDPATHINFO_MAXSIZE];
    char path[PROC_PIDPATHINFO_MAXSIZE];

    memset(name, 0, sizeof(name));
    memset(path, 0, sizeof(path));

    if (proc_name(pid, name, sizeof(name)) <= 0) {

        printf("\nProcess not found.\n");
        return;
    }

    proc_pidpath(pid, path, sizeof(path));

    printf("\n---------------------------------------------------\n");
    printf("Process Information\n");
    printf("---------------------------------------------------\n");

    printf("PID          : %d\n", pid);
    printf("Name         : %s\n", name);

    if (path[0] != '\0') {
        printf("Executable   : %s\n", path);
    } else {
        printf("Executable   : Not available\n");
    }

    printf("---------------------------------------------------\n");
}

/* =========================================================
   FEATURE 3
   Process Control
   ========================================================= */

void process_control(void) {

    int pid;
    int choice;
    int signal_number = 0;

    printf("\n================ PROCESS CONTROL ==================\n");

    printf("Enter PID: ");
    scanf("%d", &pid);

    printf("\nSelect Action:\n");
    printf("1. Stop Process\n");
    printf("2. Continue Process\n");
    printf("3. Terminate Process\n");
    printf("4. Force Kill Process\n");
    printf("5. Cancel\n");

    printf("\nEnter choice: ");
    scanf("%d", &choice);

    switch (choice) {

        case 1:
            signal_number = SIGSTOP;
            break;

        case 2:
            signal_number = SIGCONT;
            break;

        case 3:
            signal_number = SIGTERM;
            break;

        case 4:
            signal_number = SIGKILL;
            break;

        case 5:
            printf("\nOperation cancelled.\n");
            return;

        default:
            printf("\nInvalid choice.\n");
            return;
    }

    if (kill(pid, signal_number) == 0) {

        printf("\nSignal sent successfully to PID %d.\n", pid);

    } else {

        perror("\nUnable to control process");
    }
}

/* =========================================================
   FEATURE 4
   Process Creation & Launch
   ========================================================= */

void process_creation(void) {

    char command[256];

    printf("\n=============== PROCESS CREATION ==================\n");

    printf("Enter command to launch: ");

    scanf(" %255[^\n]", command);

    printf("\nLaunching: %s\n", command);

    pid_t pid = fork();

    if (pid < 0) {

        perror("fork failed");
        return;

    }

    else if (pid == 0) {

        /*
         * Child process replaces itself with the requested
         * command.
         */

        execl(
            "/bin/sh",
            "sh",
            "-c",
            command,
            (char *)NULL
        );

        perror("exec failed");
        exit(EXIT_FAILURE);
    }

    else {

        printf("Created process with PID: %d\n", pid);
        printf("Process launched successfully.\n");
    }
}

/* =========================================================
   FEATURE 5
   Live Process Monitoring
   ========================================================= */

void live_monitoring(void) {

    int pid;
    int seconds;

    printf("\n=============== LIVE MONITORING ==================\n");

    printf("Enter PID to monitor: ");
    scanf("%d", &pid);

    printf("Enter monitoring duration (seconds): ");
    scanf("%d", &seconds);

    printf("\nMonitoring PID %d...\n", pid);

    for (int i = 0; i < seconds; i++) {

        char name[PROC_PIDPATHINFO_MAXSIZE];

        memset(name, 0, sizeof(name));

        if (proc_name(pid, name, sizeof(name)) > 0) {

            printf(
                "[Monitor %d/%d] PID: %d | Name: %s | Status: Running/Available\n",
                i + 1,
                seconds,
                pid,
                name
            );

        }

        else {

            printf(
                "[Monitor %d/%d] PID %d is no longer available.\n",
                i + 1,
                seconds,
                pid
            );

            break;
        }

        sleep(1);
    }

    printf("\nMonitoring complete.\n");
}

/* =========================================================
   FEATURE 6
   Process Tree
   ========================================================= */

void process_tree(void) {

    int pids[MAX_PROCESSES];
    int count = get_process_list(pids);

    if (count <= 0) {

        printf("\nUnable to retrieve process information.\n");
        return;
    }

    printf("\n");
    printf("=============== PROCESS TREE =====================\n\n");

    printf("%-9s %-9s %s\n",
           "PID",
           "PPID",
           "PROCESS");

    printf("-----------------------------------------------\n");

    /*
     * macOS development implementation.
     *
     * macOS does not provide the Linux /proc/<PID>/status
     * interface used by the final Linux implementation.
     *
     * Therefore we do not invent PPID values here.
     *
     * The Linux implementation will read:
     *
     * /proc/<PID>/status
     *
     * and extract the PPid field to construct the actual
     * parent-child hierarchy.
     */

    for (int i = 0; i < count; i++) {

        int pid = pids[i];

        if (pid <= 0)
            continue;

        char name[PROC_PIDPATHINFO_MAXSIZE];

        memset(name, 0, sizeof(name));

        proc_name(pid, name, sizeof(name));

        if (name[0] == '\0') {
            strcpy(name, "Unknown");
        }

        printf(
            "%-9d %-9s %s\n",
            pid,
            "-",
            name
        );
    }

    printf("-----------------------------------------------\n");

    printf("\n");
    printf("Linux implementation will construct the complete\n");
    printf("parent-child hierarchy using PID and PPID.\n");
}

/* =========================================================
   MAIN MENU
   ========================================================= */

void menu(void) {

    int choice;

    while (1) {

        printf("\n");
        printf("===============================================================\n");
        printf("        LINUX PROCESS MONITOR & CONTROL SYSTEM\n");
        printf("===============================================================\n");

        printf("\n");

        printf("[1] Process Dashboard\n");
        printf("[2] Process Inspector\n");
        printf("[3] Process Control\n");
        printf("[4] Process Creation & Launch\n");
        printf("[5] Live Process Monitoring\n");
        printf("[6] Process Tree\n");
        printf("[7] Refresh Dashboard\n");
        printf("[8] Exit\n");

        printf("\nEnter your choice: ");

        scanf("%d", &choice);

        switch (choice) {

            case 1:

                clear_screen();
                display_processes();
                break;

            case 2:

                process_inspector();
                break;

            case 3:

                process_control();
                break;

            case 4:

                process_creation();
                break;

            case 5:

                live_monitoring();
                break;

            case 6:

                process_tree();
                break;

            case 7:

                clear_screen();
                display_processes();
                break;

            case 8:

                printf("\nExiting Process Monitor.\n");
                return;

            default:

                printf("\nInvalid choice. Please try again.\n");
        }
    }
}

/* =========================================================
   PROGRAM ENTRY POINT
   ========================================================= */

int main(void) {

    menu();

    return 0;
}