#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/types.h>
#include <signal.h>
#include <libproc.h>
#include <sys/sysctl.h>
#include <sys/resource.h>
#include <errno.h>
#include <time.h>

#define MAX_PROCESSES 4096
#define MAX_CREATED_PROCESSES 100

int created_pids[MAX_CREATED_PROCESSES];
int created_process_count = 0;


/* =========================================================
   UTILITY FUNCTIONS
   ========================================================= */

void clear_screen(void) {
    printf("\033[2J\033[H");
}


int get_process_list(int *pids) {
    int result = proc_listallpids(pids, sizeof(int) * MAX_PROCESSES);

    if (result <= 0) {
        return 0;
    }

    return result;
}


int process_exists(int pid) {
    char name[PROC_PIDPATHINFO_MAXSIZE];

    memset(name, 0, sizeof(name));

    if (proc_name(pid, name, sizeof(name)) > 0) {
        return 1;
    }

    return 0;
}


void cleanup_created_processes(void) {
    for (int i = 0; i < created_process_count; i++) {
        int pid = created_pids[i];

        if (process_exists(pid)) {
            kill(pid, SIGTERM);
        }
    }
}


/* =========================================================
   FEATURE 1
   PROCESS DASHBOARD
   ========================================================= */

void display_processes(void) {

    int pids[MAX_PROCESSES];

    int count = get_process_list(pids);

    if (count <= 0) {
        printf("\nUnable to retrieve process information.\n");
        return;
    }

    printf("\n");
    printf("================================================================\n");
    printf("                    PROCESS DASHBOARD\n");
    printf("================================================================\n\n");

    printf("%-10s %-35s %-15s %-10s\n",
           "PID",
           "PROCESS",
           "STATE",
           "PPID");

    printf("----------------------------------------------------------------\n");

    for (int i = 0; i < count; i++) {

        int pid = pids[i];

        if (pid <= 0)
            continue;

        char name[PROC_PIDPATHINFO_MAXSIZE];

        memset(name, 0, sizeof(name));

        if (proc_name(pid, name, sizeof(name)) <= 0) {
            strcpy(name, "Unknown");
        }

        printf("%-10d %-35s %-15s %-10s\n",
               pid,
               name,
               "Available",
               "-");
    }

    printf("----------------------------------------------------------------\n");

    printf("\nTotal processes: %d\n", count);

    printf("\n===============================================================\n");
    printf("              PROCESSES CREATED BY THIS SYSTEM\n");
    printf("===============================================================\n\n");

    if (created_process_count == 0) {

        printf("No processes created by this system.\n");

    } else {

        printf("%-10s %-35s\n", "PID", "STATUS");

        printf("-----------------------------------------------\n");

        for (int i = 0; i < created_process_count; i++) {

            int pid = created_pids[i];

            if (process_exists(pid)) {

                char name[PROC_PIDPATHINFO_MAXSIZE];

                memset(name, 0, sizeof(name));

                if (proc_name(pid, name, sizeof(name)) <= 0) {
                    strcpy(name, "Unknown");
                }

                printf("%-10d %-35s\n", pid, name);

            } else {

                printf("%-10d %-35s\n",
                       pid,
                       "Terminated");
            }
        }
    }

    printf("\n");
}


/* =========================================================
   FEATURE 2
   PROCESS INSPECTOR
   ========================================================= */

void process_inspector(void) {

    int pid;

    printf("\n===============================================================\n");
    printf("                     PROCESS INSPECTOR\n");
    printf("===============================================================\n");

    printf("\nEnter PID: ");
    scanf("%d", &pid);

    if (!process_exists(pid)) {

        printf("\nProcess not found.\n");
        return;
    }

    char name[PROC_PIDPATHINFO_MAXSIZE];
    char path[PROC_PIDPATHINFO_MAXSIZE];

    memset(name, 0, sizeof(name));
    memset(path, 0, sizeof(path));

    proc_name(pid, name, sizeof(name));

    if (proc_pidpath(pid, path, sizeof(path)) <= 0) {
        strcpy(path, "Path unavailable");
    }

    printf("\n---------------------------------------------------------------\n");

    printf("PID              : %d\n", pid);
    printf("Process Name     : %s\n", name);
    printf("Executable Path  : %s\n", path);

    printf("---------------------------------------------------------------\n");
}


/* =========================================================
   FEATURE 3
   PROCESS CONTROL
   ========================================================= */

void process_control(void) {

    int pid;
    int choice;

    printf("\n===============================================================\n");
    printf("                      PROCESS CONTROL\n");
    printf("===============================================================\n");

    printf("\nEnter PID: ");
    scanf("%d", &pid);

    if (!process_exists(pid)) {

        printf("\nProcess not found.\n");
        return;
    }

    printf("\n1. Stop Process (SIGSTOP)\n");
    printf("2. Continue Process (SIGCONT)\n");
    printf("3. Terminate Process (SIGTERM)\n");
    printf("4. Kill Process (SIGKILL)\n");
    printf("5. Cancel\n");

    printf("\nEnter choice: ");
    scanf("%d", &choice);

    int signal_number = 0;

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
            return;

        default:
            printf("\nInvalid choice.\n");
            return;
    }

    if (kill(pid, signal_number) == 0) {

        printf("\nSignal sent successfully to PID %d.\n", pid);

    } else {

        printf("\nUnable to send signal.\n");
        perror("Error");
    }
}


/* =========================================================
   FEATURE 4
   PROCESS CREATION & LAUNCH
   ========================================================= */

void process_creation(void) {

    int choice;

    printf("\n===============================================================\n");
    printf("                  PROCESS CREATION\n");
    printf("===============================================================\n");

    printf("\n1. Launch a command\n");
    printf("2. Create a file using a process\n");
    printf("3. Cancel\n");

    printf("\nEnter choice: ");
    scanf("%d", &choice);

    if (choice == 3) {
        return;
    }


    /* ---------------------------------------------------------
       OPTION 1: LAUNCH COMMAND
       --------------------------------------------------------- */

    if (choice == 1) {

        char command[256];

        printf("\nEnter command: ");

        scanf(" %[^\n]", command);

        pid_t pid = fork();

        if (pid < 0) {

            perror("fork");

            return;
        }

        if (pid == 0) {

            execl("/bin/sh",
                  "sh",
                  "-c",
                  command,
                  NULL);

            perror("exec");

            exit(1);

        } else {

            if (created_process_count < MAX_CREATED_PROCESSES) {

                created_pids[created_process_count] = pid;

                created_process_count++;
            }

            printf("\nProcess created successfully!\n");

            printf("\nPID: %d\n", pid);

            printf("Command: %s\n", command);

            printf("PID added to Created Processes list.\n");
        }

        return;
    }


    /* ---------------------------------------------------------
       OPTION 2: CREATE FILE USING PROCESS
       --------------------------------------------------------- */

    if (choice == 2) {

        char filename[256];

        printf("\nEnter file name: ");

        scanf(" %[^\n]", filename);

        pid_t pid = fork();

        if (pid < 0) {

            perror("fork");

            return;
        }

        if (pid == 0) {

            FILE *file = fopen(filename, "w");

            if (file == NULL) {

                perror("Unable to create file");

                exit(1);
            }

            fprintf(file,
                    "This file was created by a process.\n");

            fclose(file);

            printf("\nFile created successfully: %s\n",
                   filename);

            printf("File-creation process PID: %d\n",
                   getpid());

            while (1) {

                sleep(1);
            }

            exit(0);

        } else {

            if (created_process_count < MAX_CREATED_PROCESSES) {

                created_pids[created_process_count] = pid;

                created_process_count++;
            }

            printf("\nProcess created successfully!\n");

            printf("\nPID: %d\n", pid);

            printf("File: %s\n", filename);

            printf("PID added to Created Processes list.\n");
        }

        return;
    }


    printf("\nInvalid choice.\n");
}


/* =========================================================
   FEATURE 5
   LIVE PROCESS MONITORING
   ========================================================= */

void live_monitoring(void) {

    int pid;
    int duration;

    printf("\n===============================================================\n");
    printf("                 LIVE PROCESS MONITORING\n");
    printf("===============================================================\n");

    printf("\nEnter PID to monitor: ");
    scanf("%d", &pid);

    if (!process_exists(pid)) {

        printf("\nProcess not found.\n");

        return;
    }

    printf("Enter monitoring duration (seconds): ");
    scanf("%d", &duration);

    if (duration <= 0) {

        printf("\nInvalid duration.\n");

        return;
    }

    printf("\n---------------------------------------------------------------\n");

    for (int i = 1; i <= duration; i++) {

        char name[PROC_PIDPATHINFO_MAXSIZE];

        memset(name, 0, sizeof(name));

        if (!process_exists(pid)) {

            printf("\nProcess PID %d is no longer running.\n",
                   pid);

            return;
        }

        if (proc_name(pid, name, sizeof(name)) <= 0) {

            strcpy(name, "Unknown");
        }

        printf("[Monitor %d/%d] PID: %d | Name: %s | Status: Running\n",
               i,
               duration,
               pid,
               name);

        sleep(1);
    }

    printf("---------------------------------------------------------------\n");

    printf("\nLive monitoring complete.\n");
}


/* =========================================================
   FEATURE 6
   PROCESS TREE
   ========================================================= */

void process_tree(void) {

    int pids[MAX_PROCESSES];

    int count = get_process_list(pids);

    if (count <= 0) {

        printf("\nUnable to retrieve process information.\n");

        return;
    }

    printf("\n");
    printf("===============================================================\n");
    printf("              LIVE PARENT-CHILD PROCESS TREE\n");
    printf("===============================================================\n\n");

    printf("%-9s %-9s %-30s %s\n",
           "PID",
           "PPID",
           "PROCESS",
           "RELATIONSHIP");

    printf("-----------------------------------------------------------------------\n");

    int displayed = 0;

    for (int i = 0; i < count; i++) {

        int pid = pids[i];

        if (pid <= 0)
            continue;

        struct proc_bsdinfo process_info;

        memset(&process_info, 0, sizeof(process_info));

        int result = proc_pidinfo(
            pid,
            PROC_PIDTBSDINFO,
            0,
            &process_info,
            sizeof(process_info)
        );

        if (result <= 0)
            continue;

        int ppid = process_info.pbi_ppid;

        char name[PROC_PIDPATHINFO_MAXSIZE];

        memset(name, 0, sizeof(name));

        if (proc_name(pid, name, sizeof(name)) <= 0) {

            strcpy(name, "Unknown");
        }

        char relationship[64];

        if (ppid == 0) {

            strcpy(relationship, "System / Root");

        } else if (ppid == getpid()) {

            strcpy(relationship, "Child of Monitor");

        } else {

            strcpy(relationship, "Child Process");
        }

        printf("%-9d %-9d %-30s %s\n",
               pid,
               ppid,
               name,
               relationship);

        displayed++;
    }

    printf("-----------------------------------------------------------------------\n");

    printf("\nTotal processes displayed: %d\n",
           displayed);

    printf("\nPID  = Process ID\n");
    printf("PPID = Parent Process ID\n");

    printf("\nParent-child relationships are retrieved\n");
    printf("directly from the operating system.\n");

    printf("===============================================================\n");
}


/* =========================================================
   FEATURE 7
   RESOURCE MONITOR
   ========================================================= */

void resource_monitor(void) {

    int pid;

    printf("\n===============================================================\n");
    printf("                     RESOURCE MONITOR\n");
    printf("===============================================================\n");

    printf("\nEnter PID to monitor: ");
    scanf("%d", &pid);

    if (!process_exists(pid)) {

        printf("\nProcess not found.\n");

        return;
    }

    struct rusage_info_v4 usage;

    memset(&usage, 0, sizeof(usage));

    if (proc_pid_rusage(
            pid,
            RUSAGE_INFO_V4,
            (rusage_info_t *)&usage) != 0) {

        printf("\nUnable to retrieve resource information.\n");

        return;
    }

    sleep(1);

    struct rusage_info_v4 usage2;

    memset(&usage2, 0, sizeof(usage2));

    if (proc_pid_rusage(
            pid,
            RUSAGE_INFO_V4,
            (rusage_info_t *)&usage2) != 0) {

        printf("\nProcess ended during monitoring.\n");

        return;
    }

    unsigned long long cpu_before =
        usage.ri_user_time +
        usage.ri_system_time;

    unsigned long long cpu_after =
        usage2.ri_user_time +
        usage2.ri_system_time;

    unsigned long long cpu_delta =
        cpu_after - cpu_before;

    double cpu_usage =
        ((double)cpu_delta / 1000000000.0) * 100.0;

    double memory_mb =
        (double)usage2.ri_resident_size /
        (1024.0 * 1024.0);

    char name[PROC_PIDPATHINFO_MAXSIZE];

    memset(name, 0, sizeof(name));

    if (proc_name(pid, name, sizeof(name)) <= 0) {

        strcpy(name, "Unknown");
    }

    printf("\n---------------------------------------------------------------\n");

    printf("PID              : %d\n", pid);
    printf("NAME             : %s\n", name);
    printf("CPU USAGE        : %.2f %%\n", cpu_usage);
    printf("MEMORY           : %.2f MB\n", memory_mb);

    printf("USER CPU TIME    : %.2f ms\n",
           (double)usage2.ri_user_time / 1000000.0);

    printf("SYSTEM CPU TIME  : %.2f ms\n",
           (double)usage2.ri_system_time / 1000000.0);

    printf("---------------------------------------------------------------\n");
}


/* =========================================================
   FEATURE 8
   PRIORITY & SCHEDULING CONTROL
   ========================================================= */

void process_priority(void) {

    int pid;
    int choice;

    printf("\n===============================================================\n");
    printf("              PRIORITY & SCHEDULING CONTROL\n");
    printf("===============================================================\n");

    printf("\nEnter PID: ");
    scanf("%d", &pid);

    if (!process_exists(pid)) {

        printf("\nProcess not found.\n");

        return;
    }

    errno = 0;

    int current_priority =
        getpriority(PRIO_PROCESS, pid);

    if (errno != 0) {

        perror("\nUnable to retrieve priority");

        return;
    }

    printf("\nCurrent priority (nice value): %d\n",
           current_priority);

    printf("\n1. Increase Priority\n");
    printf("2. Decrease Priority\n");
    printf("3. View Priority Again\n");
    printf("4. Cancel\n");

    printf("\nEnter choice: ");
    scanf("%d", &choice);

    if (choice == 3) {

        errno = 0;

        int priority =
            getpriority(PRIO_PROCESS, pid);

        if (errno != 0) {

            perror("\nUnable to retrieve priority");

            return;
        }

        printf("\nCurrent priority: %d\n",
               priority);

        return;
    }

    if (choice == 4) {

        return;
    }

    int new_priority = current_priority;

    if (choice == 1) {

        new_priority--;

    } else if (choice == 2) {

        new_priority++;

    } else {

        printf("\nInvalid choice.\n");

        return;
    }

    if (setpriority(
            PRIO_PROCESS,
            pid,
            new_priority) == 0) {

        printf("\nPriority updated successfully.\n");

        printf("New priority: %d\n",
               new_priority);

    } else {

        printf("\nUnable to change priority.\n");

        perror("Error");
    }
}


/* =========================================================
   FEATURE 9
   PROCESS WATCHDOG & ALERT SYSTEM
   ========================================================= */

void process_watchdog(void) {

    int pid;
    int duration;
    double threshold;

    printf("\n===============================================================\n");
    printf("             PROCESS WATCHDOG & ALERT SYSTEM\n");
    printf("===============================================================\n");

    printf("\nEnter PID to monitor: ");
    scanf("%d", &pid);

    if (!process_exists(pid)) {

        printf("\nProcess not found.\n");

        return;
    }

    printf("Enter CPU alert threshold (%%): ");
    scanf("%lf", &threshold);

    if (threshold < 0)
        threshold = 0;

    printf("Enter monitoring duration (seconds): ");
    scanf("%d", &duration);

    if (duration <= 0) {

        printf("\nInvalid monitoring duration.\n");

        return;
    }

    char name[PROC_PIDPATHINFO_MAXSIZE];

    memset(name, 0, sizeof(name));

    if (proc_name(pid, name, sizeof(name)) <= 0) {

        strcpy(name, "Unknown");
    }

    printf("\n---------------------------------------------------------------\n");

    printf("WATCHDOG ACTIVE\n");

    printf("PID              : %d\n", pid);

    printf("PROCESS          : %s\n", name);

    printf("CPU ALERT LEVEL  : %.2f %%\n", threshold);

    printf("DURATION         : %d seconds\n", duration);

    printf("---------------------------------------------------------------\n");

    struct rusage_info_v4 previous;

    memset(&previous, 0, sizeof(previous));

    if (proc_pid_rusage(
            pid,
            RUSAGE_INFO_V4,
            (rusage_info_t *)&previous) != 0) {

        printf("\nUnable to start watchdog for this process.\n");

        return;
    }

    for (int i = 1; i <= duration; i++) {

        sleep(1);

        struct rusage_info_v4 current;

        memset(&current, 0, sizeof(current));

        if (proc_pid_rusage(
                pid,
                RUSAGE_INFO_V4,
                (rusage_info_t *)&current) != 0) {

            printf("\n");

            printf("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n");
            printf("                    WATCHDOG ALERT\n");
            printf("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n");

            printf("PID %d is no longer running.\n",
                   pid);

            printf("Process terminated or became unavailable.\n");

            printf("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n");

            return;
        }

        unsigned long long previous_cpu =
            previous.ri_user_time +
            previous.ri_system_time;

        unsigned long long current_cpu =
            current.ri_user_time +
            current.ri_system_time;

        unsigned long long cpu_delta =
            current_cpu - previous_cpu;

        double cpu_usage =
            ((double)cpu_delta / 1000000000.0) * 100.0;

        double memory_mb =
            (double)current.ri_resident_size /
            (1024.0 * 1024.0);

        char current_name[PROC_PIDPATHINFO_MAXSIZE];

        memset(current_name, 0, sizeof(current_name));

        if (proc_name(
                pid,
                current_name,
                sizeof(current_name)) <= 0) {

            strcpy(current_name, "Unknown");
        }

        printf(
            "[Watchdog %d/%d] PID: %d | Name: %s | CPU: %.2f%% | Memory: %.2f MB",
            i,
            duration,
            pid,
            current_name,
            cpu_usage,
            memory_mb
        );

        if (cpu_usage >= threshold) {

            printf(" | ALERT: HIGH CPU USAGE");

        } else {

            printf(" | Status: Normal");
        }

        printf("\n");

        previous = current;
    }

    printf("\n---------------------------------------------------------------\n");

    printf("WATCHDOG MONITORING COMPLETE\n");

    printf("PID %d remained available for the monitoring period.\n",
           pid);

    printf("---------------------------------------------------------------\n");
}


/* =========================================================
   FEATURE 10
   PROCESS LIFECYCLE / EVENT LOGGER
   ========================================================= */

typedef struct {

    int pid;
    char name[PROC_PIDPATHINFO_MAXSIZE];

} ProcessSnapshot;


int capture_process_snapshot(ProcessSnapshot *snapshot) {

    int pids[MAX_PROCESSES];

    int count = get_process_list(pids);

    if (count <= 0) {
        return 0;
    }

    int actual_count = 0;

    for (int i = 0;
         i < count && actual_count < MAX_PROCESSES;
         i++) {

        int pid = pids[i];

        if (pid <= 0)
            continue;

        snapshot[actual_count].pid = pid;

        memset(
            snapshot[actual_count].name,
            0,
            sizeof(snapshot[actual_count].name)
        );

        if (proc_name(
                pid,
                snapshot[actual_count].name,
                sizeof(snapshot[actual_count].name)) <= 0) {

            strcpy(
                snapshot[actual_count].name,
                "Unknown"
            );
        }

        actual_count++;
    }

    return actual_count;
}


int find_pid_in_snapshot(
    ProcessSnapshot *snapshot,
    int count,
    int pid
) {

    for (int i = 0; i < count; i++) {

        if (snapshot[i].pid == pid) {

            return i;
        }
    }

    return -1;
}


void get_timestamp(char *buffer, size_t size) {

    time_t now = time(NULL);

    struct tm *local_time =
        localtime(&now);

    if (local_time == NULL) {

        strcpy(buffer, "Unknown Time");

        return;
    }

    strftime(
        buffer,
        size,
        "%Y-%m-%d %H:%M:%S",
        local_time
    );
}


void lifecycle_logger(void) {

    int duration;

    printf("\n===============================================================\n");
    printf("             PROCESS LIFECYCLE / EVENT LOGGER\n");
    printf("===============================================================\n");

    printf("\nThis feature detects newly started and terminated processes.\n");

    printf("\nEnter logging duration (seconds): ");
    scanf("%d", &duration);

    if (duration <= 0) {

        printf("\nInvalid logging duration.\n");

        return;
    }

    FILE *log_file =
        fopen("process_events.log", "a");

    if (log_file == NULL) {

        perror("\nUnable to open process_events.log");

        return;
    }

    ProcessSnapshot previous[MAX_PROCESSES];
    ProcessSnapshot current[MAX_PROCESSES];

    int previous_count =
        capture_process_snapshot(previous);

    if (previous_count <= 0) {

        printf("\nUnable to capture initial process snapshot.\n");

        fclose(log_file);

        return;
    }

    char timestamp[64];

    get_timestamp(timestamp, sizeof(timestamp));

    fprintf(
        log_file,
        "\n===============================================================\n"
    );

    fprintf(
        log_file,
        "Lifecycle Logger Started: %s\n",
        timestamp
    );

    fprintf(
        log_file,
        "Monitoring Duration: %d seconds\n",
        duration
    );

    fprintf(
        log_file,
        "===============================================================\n"
    );

    fflush(log_file);

    printf("\n---------------------------------------------------------------\n");

    printf("LIFECYCLE LOGGER ACTIVE\n");

    printf("Initial processes detected: %d\n",
           previous_count);

    printf("Duration: %d seconds\n",
           duration);

    printf("Log file: process_events.log\n");

    printf("---------------------------------------------------------------\n\n");


    for (int second = 1;
         second <= duration;
         second++) {

        sleep(1);

        int current_count =
            capture_process_snapshot(current);

        if (current_count <= 0) {

            printf(
                "[Logger %d/%d] Unable to capture process list.\n",
                second,
                duration
            );

            continue;
        }


        /* -----------------------------------------------------
           DETECT NEW PROCESSES
           ----------------------------------------------------- */

        for (int i = 0; i < current_count; i++) {

            int pid =
                current[i].pid;

            int found =
                find_pid_in_snapshot(
                    previous,
                    previous_count,
                    pid
                );

            if (found == -1) {

                get_timestamp(
                    timestamp,
                    sizeof(timestamp)
                );

                printf(
                    "[%s] STARTED     PID: %-8d Process: %s\n",
                    timestamp,
                    pid,
                    current[i].name
                );

                fprintf(
                    log_file,
                    "[%s] STARTED     PID: %-8d Process: %s\n",
                    timestamp,
                    pid,
                    current[i].name
                );

                fflush(log_file);
            }
        }


        /* -----------------------------------------------------
           DETECT TERMINATED PROCESSES
           ----------------------------------------------------- */

        for (int i = 0; i < previous_count; i++) {

            int pid =
                previous[i].pid;

            int found =
                find_pid_in_snapshot(
                    current,
                    current_count,
                    pid
                );

            if (found == -1) {

                get_timestamp(
                    timestamp,
                    sizeof(timestamp)
                );

                printf(
                    "[%s] TERMINATED  PID: %-8d Process: %s\n",
                    timestamp,
                    pid,
                    previous[i].name
                );

                fprintf(
                    log_file,
                    "[%s] TERMINATED  PID: %-8d Process: %s\n",
                    timestamp,
                    pid,
                    previous[i].name
                );

                fflush(log_file);
            }
        }


        /* -----------------------------------------------------
           UPDATE SNAPSHOT
           ----------------------------------------------------- */

        memcpy(
            previous,
            current,
            sizeof(ProcessSnapshot) * current_count
        );

        previous_count =
            current_count;
    }


    get_timestamp(
        timestamp,
        sizeof(timestamp)
    );

    fprintf(
        log_file,
        "Lifecycle Logger Completed: %s\n",
        timestamp
    );

    fprintf(
        log_file,
        "===============================================================\n"
    );

    fflush(log_file);

    fclose(log_file);


    printf("\n---------------------------------------------------------------\n");

    printf("LIFECYCLE LOGGING COMPLETE\n");

    printf("Events have been saved to:\n");
    printf("process_events.log\n");

    printf("---------------------------------------------------------------\n");
}


/* =========================================================
   MAIN MENU
   ========================================================= */

int main(void) {

    int choice;

    while (1) {

        printf("\n\n");

        printf("================================================================\n");
        printf("        LINUX PROCESS MONITOR & CONTROL SYSTEM\n");
        printf("================================================================\n\n");

        printf("[1]  Process Dashboard\n");
        printf("[2]  Process Inspector\n");
        printf("[3]  Process Control\n");
        printf("[4]  Process Creation & Launch\n");
        printf("[5]  Live Process Monitoring\n");
        printf("[6]  Process Tree\n");
        printf("[7]  Resource Monitor\n");
        printf("[8]  Priority & Scheduling Control\n");
        printf("[9]  Process Watchdog & Alerts\n");
        printf("[10] Process Lifecycle / Event Logger\n");
        printf("[11] Refresh Dashboard\n");
        printf("[12] Exit\n");

        printf("\nEnter your choice: ");

        scanf("%d", &choice);


        switch (choice) {

            case 1:

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

                resource_monitor();

                break;


            case 8:

                process_priority();

                break;


            case 9:

                process_watchdog();

                break;


            case 10:

                lifecycle_logger();

                break;


            case 11:

                clear_screen();

                break;


            case 12:

                cleanup_created_processes();

                printf("\nExiting Process Monitor.\n");

                return 0;


            default:

                printf("\nInvalid choice. Please try again.\n");
        }
    }

    return 0;
}
