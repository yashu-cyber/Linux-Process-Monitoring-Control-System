#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/types.h>
#include <signal.h>
#include <libproc.h>

#define MAX_PROCESSES 4096
#define MAX_CREATED_PROCESSES 100

/* Stores PIDs of processes created through our system */
int created_pids[MAX_CREATED_PROCESSES];
int created_process_count = 0;


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


/* Check whether a process currently exists */
int process_exists(int pid) {

    char name[PROC_PIDPATHINFO_MAXSIZE];

    memset(name, 0, sizeof(name));

    return proc_name(pid, name, sizeof(name)) > 0;
}


/* Remove created processes that are no longer running */
void cleanup_created_processes(void) {

    int write_index = 0;

    for (int i = 0; i < created_process_count; i++) {

        int pid = created_pids[i];

        if (process_exists(pid)) {

            created_pids[write_index] = pid;
            write_index++;
        }
    }

    created_process_count = write_index;
}


/* =========================================================
   FEATURE 1
   Process Dashboard / Discovery
   ========================================================= */

void display_processes(void) {

    cleanup_created_processes();

    int pids[MAX_PROCESSES];

    int count = get_process_list(pids);

    if (count <= 0) {

        printf("\nUnable to retrieve process list.\n");
        return;
    }


    printf("\n");

    printf("====================================================================\n");
    printf("              LINUX PROCESS MONITOR & CONTROL SYSTEM\n");
    printf("====================================================================\n\n");


    /* =====================================================
       ALL RUNNING PROCESSES
       ===================================================== */

    printf("====================================================================\n");
    printf("                    ALL RUNNING PROCESSES\n");
    printf("====================================================================\n");

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
         * macOS does not expose Linux-style /proc
         * process states.
         *
         * Linux implementation will provide
         * actual process state information.
         */

        printf("%-8d %-8s %-30s %-12s\n",
               pid,
               "-",
               name,
               "Available");
    }


    printf("--------------------------------------------------------------------\n");


    /* =====================================================
       PROCESSES CREATED BY THIS SYSTEM
       ===================================================== */

    printf("\n\n");

    printf("====================================================================\n");
    printf("              PROCESSES CREATED BY THIS SYSTEM\n");
    printf("====================================================================\n");


    if (created_process_count == 0) {

        printf("\nNo currently running processes were created through this system.\n");

    } else {

        printf("\n%-10s %-30s %-15s\n",
               "PID",
               "NAME",
               "STATUS");

        printf("--------------------------------------------------------------------\n");


        for (int i = 0; i < created_process_count; i++) {

            int pid = created_pids[i];

            char name[PROC_PIDPATHINFO_MAXSIZE];

            memset(name, 0, sizeof(name));


            if (proc_name(pid, name, sizeof(name)) > 0) {

                printf("%-10d %-30s %-15s\n",
                       pid,
                       name,
                       "Running");
            }
        }


        printf("--------------------------------------------------------------------\n");

        printf("Currently running created processes: %d\n",
               created_process_count);
    }


    printf("====================================================================\n");
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

    int choice;
    char command[256];
    char filename[256];


    printf("\n=============== PROCESS CREATION ==================\n");

    printf("1. Launch a command\n");
    printf("2. Create a file using a process\n");
    printf("3. Cancel\n");

    printf("\nEnter choice: ");
    scanf("%d", &choice);


    /* =====================================================
       OPTION 1 - LAUNCH A COMMAND
       ===================================================== */

    if (choice == 1) {

        printf("\nEnter command to launch: ");
        scanf(" %255[^\n]", command);

        printf("\nLaunching: %s\n", command);


        pid_t pid = fork();


        if (pid < 0) {

            perror("fork failed");
            return;
        }


        /* CHILD PROCESS */

        else if (pid == 0) {

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


        /* PARENT PROCESS */

        else {

            printf("\nCreated process with PID: %d\n", pid);

            printf("Process launched successfully.\n");


            if (created_process_count < MAX_CREATED_PROCESSES) {

                created_pids[created_process_count] = pid;

                created_process_count++;

                printf("PID added to Created Processes list.\n");

            } else {

                printf("Created process list is full.\n");
            }
        }
    }


    /* =====================================================
       OPTION 2 - CREATE A FILE USING A PROCESS
       ===================================================== */

    else if (choice == 2) {

        printf("\nEnter file name: ");
        scanf(" %255[^\n]", filename);


        pid_t pid = fork();


        if (pid < 0) {

            perror("fork failed");
            return;
        }


        /* CHILD PROCESS */

        else if (pid == 0) {

            FILE *file = fopen(filename, "w");


            if (file == NULL) {

                perror("Unable to create file");

                exit(EXIT_FAILURE);
            }


            fprintf(
                file,
                "This file was created by a process.\n"
            );


            fclose(file);


            printf("\nFile created successfully: %s\n",
                   filename);

            printf("File-creation process PID: %d\n",
                   getpid());


            /*
             * Keep the process alive so that its PID
             * can be inspected, monitored and controlled.
             */

            while (1) {

                sleep(1);
            }
        }


        /* PARENT PROCESS */

        else {

            printf("\nProcess created successfully!\n");

            printf("PID: %d\n", pid);

            printf("File: %s\n", filename);


            if (created_process_count < MAX_CREATED_PROCESSES) {

                created_pids[created_process_count] = pid;

                created_process_count++;

                printf("PID added to Created Processes list.\n");

            } else {

                printf("Created process list is full.\n");
            }
        }
    }


    /* =====================================================
       OPTION 3 - CANCEL
       ===================================================== */

    else if (choice == 3) {

        printf("\nOperation cancelled.\n");
    }


    else {

        printf("\nInvalid choice.\n");
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

        } else {

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
     * macOS does not provide the Linux
     * /proc/<PID>/status interface.
     *
     * Therefore PPID values are not invented here.
     *
     * The Linux implementation will read:
     *
     * /proc/<PID>/status
     *
     * and extract the PPid field.
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
