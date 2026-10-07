#define _GNU_SOURCE

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/types.h>
#include <signal.h>
#include <sys/resource.h>
#include <sched.h>
#include <errno.h>
#include <time.h>
#include <dirent.h>
#include <limits.h>
#include <fcntl.h>
#include <pwd.h>
#include <sys/stat.h>
#include <math.h>

#define PROC_PIDPATHINFO_MAXSIZE 4096
#define PROC_PIDTBSDINFO 1
#define RUSAGE_INFO_V4 4

#define MAX_PROCESSES 4096
#define MAX_CREATED_PROCESSES 100

int created_pids[MAX_CREATED_PROCESSES];
int created_process_count = 0;

static int process_state(int pid, char *state);

struct proc_bsdinfo {
    int pbi_ppid;
};

struct rusage_info_v4 {
    unsigned long long ri_user_time;
    unsigned long long ri_system_time;
    unsigned long long ri_resident_size;
};

typedef struct rusage_info_v4 rusage_info_t;

int read_proc_stat(int pid, int *ppid, unsigned long long *user_time,
                   unsigned long long *system_time, long *resident_pages) {
    char path[64];
    char buffer[4096];
    char *fields[64];
    int field_count = 0;
    FILE *file;

    snprintf(path, sizeof(path), "/proc/%d/stat", pid);
    file = fopen(path, "r");
    if (file == NULL || fgets(buffer, sizeof(buffer), file) == NULL) {
        if (file != NULL) fclose(file);
        return -1;
    }
    fclose(file);

    char *close_name = strrchr(buffer, ')');
    if (close_name == NULL) return -1;
    char *field = close_name + 2;
    while (*field != '\0' && field_count < 64) {
        while (*field == ' ') field++;
        if (*field == '\0') break;
        fields[field_count++] = field;
        while (*field != '\0' && *field != ' ') field++;
        if (*field != '\0') *field++ = '\0';
    }

    if (field_count <= 21) return -1;
    long ticks = sysconf(_SC_CLK_TCK);
    if (ticks <= 0) return -1;
    if (ppid != NULL) *ppid = (int)strtol(fields[1], NULL, 10);
    if (user_time != NULL) *user_time = strtoull(fields[11], NULL, 10) * 1000000000ULL / (unsigned long long)ticks;
    if (system_time != NULL) *system_time = strtoull(fields[12], NULL, 10) * 1000000000ULL / (unsigned long long)ticks;
    if (resident_pages != NULL) *resident_pages = strtol(fields[21], NULL, 10);
    return 0;
}

int proc_name(int pid, char *name, size_t size) {
    char path[64];
    FILE *file;
    snprintf(path, sizeof(path), "/proc/%d/comm", pid);
    file = fopen(path, "r");
    if (file == NULL || fgets(name, (int)size, file) == NULL) {
        if (file != NULL) fclose(file);
        return 0;
    }
    fclose(file);
    name[strcspn(name, "\n")] = '\0';
    return (int)strlen(name);
}

int proc_pidpath(int pid, char *path, size_t size) {
    char link_path[64];
    snprintf(link_path, sizeof(link_path), "/proc/%d/exe", pid);
    ssize_t length = readlink(link_path, path, size - 1);
    if (length < 0) return -1;
    path[length] = '\0';
    return (int)length;
}

int proc_pidinfo(int pid, int flavor, int arg, struct proc_bsdinfo *info, size_t size) {
    (void)flavor;
    (void)arg;
    (void)size;
    return read_proc_stat(pid, &info->pbi_ppid, NULL, NULL, NULL) == 0 ? (int)sizeof(*info) : -1;
}

int proc_pid_rusage(int pid, int flavor, rusage_info_t *usage) {
    unsigned long long user_time;
    unsigned long long system_time;
    long resident_pages;
    (void)flavor;
    if (read_proc_stat(pid, NULL, &user_time, &system_time, &resident_pages) != 0) return -1;
    usage->ri_user_time = user_time;
    usage->ri_system_time = system_time;
    usage->ri_resident_size = (unsigned long long)resident_pages * (unsigned long long)sysconf(_SC_PAGESIZE);
    return 0;
}


/* =========================================================
   UTILITY FUNCTIONS
   ========================================================= */

static int read_int(int *value) {
    char buffer[128];
    char *end;
    if (fgets(buffer, sizeof(buffer), stdin) == NULL) return 0;
    errno = 0;
    long parsed = strtol(buffer, &end, 10);
    while (*end == ' ' || *end == '\t' || *end == '\r' || *end == '\n') end++;
    if (end == buffer || *end != '\0' || errno == ERANGE || parsed < INT_MIN || parsed > INT_MAX) return 0;
    *value = (int)parsed;
    return 1;
}

static int read_double(double *value) {
    char buffer[128];
    char *end;
    if (fgets(buffer, sizeof(buffer), stdin) == NULL) return 0;
    errno = 0;
    double parsed = strtod(buffer, &end);
    while (*end == ' ' || *end == '\t' || *end == '\r' || *end == '\n') end++;
    if (end == buffer || *end != '\0' || errno == ERANGE || !isfinite(parsed)) return 0;
    *value = parsed;
    return 1;
}

static int read_pid(int *pid) {
    if (!read_int(pid) || *pid <= 0) {
        printf("\nInvalid PID. Enter a positive integer.\n");
        return 0;
    }
    return 1;
}

static int read_text(char *buffer, size_t size) {
    int character;
    size_t length = 0;

    if (size == 0) return 0;

    do {
        character = getchar();
    } while (character == ' ' || character == '\t' || character == '\n' ||
             character == '\r' || character == '\v' || character == '\f');

    if (character == EOF) return 0;

    do {
        if (length < size - 1) buffer[length++] = (char)character;
        character = getchar();
    } while (character != '\n' && character != EOF);

    buffer[length] = '\0';
    return length > 0;
}

void clear_screen(void) {
    printf("\033[2J\033[H");
}


int get_process_list(int *pids) {
    DIR *directory = opendir("/proc");
    struct dirent *entry;
    int count = 0;

    if (directory == NULL) return 0;
    while ((entry = readdir(directory)) != NULL && count < MAX_PROCESSES) {
        char *end;
        long pid = strtol(entry->d_name, &end, 10);
        if (*entry->d_name != '\0' && *end == '\0' && pid > 0) {
            pids[count++] = (int)pid;
        }
    }
    closedir(directory);
    return count;
}


int process_exists(int pid) {
    char state;
    return pid > 0 && process_state(pid, &state) && state != 'Z' && state != 'X';
}

static const char *process_state_label(char state) {
    switch (state) {
        case 'R': return "Running";
        case 'S': return "Sleeping";
        case 'D': return "Disk sleep";
        case 'T': return "Stopped";
        case 't': return "Tracing";
        case 'Z': return "Zombie";
        case 'X': return "Exited";
        case 'I': return "Idle";
        default: return "Unknown";
    }
}

static int send_signal_and_verify(int pid, int signal_number, char *state) {
    if (pid <= 0 || !process_state(pid, state) || *state == 'Z' || *state == 'X') {
        errno = ESRCH;
        return -1;
    }
    if (kill(pid, signal_number) != 0) return -1;

    const struct timespec pause = { .tv_sec = 0, .tv_nsec = 10000000L };
    for (int attempt = 0; attempt < 50; attempt++) {
        if (!process_state(pid, state) || *state == 'Z' || *state == 'X') {
            if (signal_number == SIGSTOP || signal_number == SIGCONT) {
                errno = ESRCH;
                return -1;
            }
            *state = 'X';
            return 0;
        }
        if ((signal_number == SIGSTOP && (*state == 'T' || *state == 't')) ||
            (signal_number == SIGCONT && *state != 'T' && *state != 't')) return 0;
        if (signal_number == SIGTERM || signal_number == SIGKILL) {
            if (*state == 'Z' || *state == 'X') return 0;
        }
        nanosleep(&pause, NULL);
    }
    errno = ETIMEDOUT;
    return -1;
}


void cleanup_created_processes(void) {
    for (int i = 0; i < created_process_count; i++) {
        int pid = created_pids[i];

        if (process_exists(pid)) {
            if (kill(-pid, SIGTERM) != 0) kill(pid, SIGTERM);
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

        int ppid = 0;
        char state = '?';
        if (read_proc_stat(pid, &ppid, NULL, NULL, NULL) != 0 ||
            !process_state(pid, &state)) {
            continue;
        }

        char name[PROC_PIDPATHINFO_MAXSIZE];

        memset(name, 0, sizeof(name));

        if (proc_name(pid, name, sizeof(name)) <= 0) {
            strcpy(name, "Unknown");
        }

         printf("%-10d %-35s %-15c %-10d\n",
               pid,
               name,
             state,
             ppid);
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
    if (!read_pid(&pid)) return;

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
    if (!read_pid(&pid)) return;

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
    if (!read_int(&choice)) {
        printf("\nInvalid choice.\n");
        return;
    }

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

    char state = '?';
    if (send_signal_and_verify(pid, signal_number, &state) == 0) {
        printf("\nSignal delivered and verified for PID %d: %s (state %c).\n",
               pid, process_state_label(state), state);
    } else {
        printf("\nUnable to complete process control for PID %d.\n", pid);
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
    if (!read_int(&choice)) {
        printf("\nInvalid choice.\n");
        return;
    }

    if (choice == 3) {
        return;
    }


    /* ---------------------------------------------------------
       OPTION 1: LAUNCH COMMAND
       --------------------------------------------------------- */

    if (choice == 1) {

        char command[256];

        printf("\nEnter command: ");

        if (!read_text(command, sizeof(command))) {
            printf("\nInvalid command input.\n");
            return;
        }

        pid_t pid = fork();

        if (pid < 0) {

            perror("fork");

            return;
        }

        if (pid == 0) {

            setpgid(0, 0);

            execl("/bin/sh",
                  "sh",
                  "-c",
                  command,
                  NULL);

            perror("exec");

            exit(1);

        } else {

            setpgid(pid, pid);

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

        if (!read_text(filename, sizeof(filename))) {
            printf("\nInvalid file name input.\n");
            return;
        }

        pid_t pid = fork();

        if (pid < 0) {

            perror("fork");

            return;
        }

        if (pid == 0) {

            setpgid(0, 0);

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

            setpgid(pid, pid);

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
    if (!read_pid(&pid)) return;

    if (!process_exists(pid)) {

        printf("\nProcess not found.\n");

        return;
    }

    printf("Enter monitoring duration (seconds): ");
    if (!read_int(&duration)) {
        printf("\nInvalid duration input.\n");
        return;
    }

    if (duration <= 0) {

        printf("\nInvalid duration.\n");

        return;
    }

    printf("\n---------------------------------------------------------------\n");

    for (int i = 1; i <= duration; i++) {

        char name[PROC_PIDPATHINFO_MAXSIZE];
        char state = '?';

        memset(name, 0, sizeof(name));

        if (!process_exists(pid) || !process_state(pid, &state)) {

            printf("\nProcess PID %d is no longer running.\n",
                   pid);

            return;
        }

        if (proc_name(pid, name, sizeof(name)) <= 0) {

            strcpy(name, "Unknown");
        }

         printf("[Monitor %d/%d] PID: %d | Name: %s | Status: %s\n",
               i,
               duration,
               pid,
             name,
             process_state_label(state));

        sleep(1);
    }

    printf("---------------------------------------------------------------\n");

    printf("\nLive monitoring complete.\n");
}


/* =========================================================
   FEATURE 6
   PROCESS TREE
   ========================================================= */

typedef struct {
    int pid;
    int ppid;
    char name[PROC_PIDPATHINFO_MAXSIZE];
} ProcessTreeEntry;

typedef struct {
    int entry_index;
    int next_child_index;
    int depth;
    int printed;
} ProcessTreeFrame;

static int process_tree_find(ProcessTreeEntry *entries, int count, int pid) {
    for (int index = 0; index < count; index++) {
        if (entries[index].pid == pid) return index;
    }
    return -1;
}

static void print_process_tree_branch(ProcessTreeEntry *entries, int count,
                                      int root_index, unsigned char *visited,
                                      ProcessTreeFrame *frames) {
    int top = 0;
    visited[root_index] = 1;
    frames[top++] = (ProcessTreeFrame){root_index, 0, 0, 0};

    while (top > 0) {
        ProcessTreeFrame *frame = &frames[top - 1];
        ProcessTreeEntry *entry = &entries[frame->entry_index];

        if (!frame->printed) {
            printf("%-9d %-9d %*s%s\n", entry->pid, entry->ppid,
                   frame->depth * 3, "", entry->name);
            frame->printed = 1;
        }

        int child_index = -1;
        while (frame->next_child_index < count) {
            int candidate = frame->next_child_index++;
            if (!visited[candidate] && entries[candidate].ppid == entry->pid) {
                child_index = candidate;
                break;
            }
        }

        if (child_index >= 0) {
            visited[child_index] = 1;
            frames[top++] = (ProcessTreeFrame){child_index, 0, frame->depth + 1, 0};
        } else {
            top--;
        }
    }
}

void process_tree(void) {
    int pids[MAX_PROCESSES];
    int pid_count = get_process_list(pids);
    if (pid_count <= 0) {
        printf("\nUnable to retrieve process information.\n");
        return;
    }

    ProcessTreeEntry *entries = calloc((size_t)pid_count, sizeof(*entries));
    unsigned char *visited = calloc((size_t)pid_count, sizeof(*visited));
    ProcessTreeFrame *frames = calloc((size_t)pid_count, sizeof(*frames));
    if (entries == NULL || visited == NULL || frames == NULL) {
        printf("\nUnable to allocate process tree data.\n");
        free(entries);
        free(visited);
        free(frames);
        return;
    }

    int count = 0;
    for (int index = 0; index < pid_count; index++) {
        int pid = pids[index];
        if (read_proc_stat(pid, &entries[count].ppid, NULL, NULL, NULL) != 0) continue;
        entries[count].pid = pid;
        if (proc_name(pid, entries[count].name, sizeof(entries[count].name)) <= 0)
            strcpy(entries[count].name, "Unknown");
        count++;
    }

    printf("\n");
    printf("===============================================================\n");
    printf("              LIVE PARENT-CHILD PROCESS TREE\n");
    printf("===============================================================\n\n");
    printf("%-9s %-9s %s\n", "PID", "PPID", "PROCESS (indented by parent)");
    printf("-----------------------------------------------------------------------\n");
    for (int i = 0; i < count; i++) {
        if (entries[i].ppid == 0 || process_tree_find(entries, count, entries[i].ppid) < 0)
            print_process_tree_branch(entries, count, i, visited, frames);
    }
    for (int i = 0; i < count; i++) {
        if (!visited[i]) print_process_tree_branch(entries, count, i, visited, frames);
    }
    printf("-----------------------------------------------------------------------\n");
    printf("\nTotal processes displayed: %d\n", count);
    printf("PID and PPID are read from the current /proc snapshot.\n");
    printf("===============================================================\n");

    free(entries);
    free(visited);
    free(frames);
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
    if (!read_pid(&pid)) return;

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
    if (!read_pid(&pid)) return;

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
    if (!read_int(&choice)) {
        printf("\nInvalid choice.\n");
        return;
    }

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
    if (!read_pid(&pid)) return;

    if (!process_exists(pid)) {

        printf("\nProcess not found.\n");

        return;
    }

    printf("Enter CPU alert threshold (%%): ");
    if (!read_double(&threshold)) {
        printf("\nInvalid threshold input.\n");
        return;
    }

    if (threshold < 0 || threshold > 100) {
        printf("\nCPU threshold must be between 0 and 100 percent.\n");
        return;
    }

    printf("Enter monitoring duration (seconds): ");
    if (!read_int(&duration)) {
        printf("\nInvalid duration input.\n");
        return;
    }

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
    if (!read_int(&duration)) {
        printf("\nInvalid duration input.\n");
        return;
    }

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

    ProcessSnapshot *previous = calloc(MAX_PROCESSES, sizeof(*previous));
    ProcessSnapshot *current = calloc(MAX_PROCESSES, sizeof(*current));
    if (previous == NULL || current == NULL) {
        printf("\nUnable to allocate process snapshots.\n");
        free(previous);
        free(current);
        fclose(log_file);
        return;
    }

    int previous_count =
        capture_process_snapshot(previous);

    if (previous_count <= 0) {

        printf("\nUnable to capture initial process snapshot.\n");

        fclose(log_file);
        free(previous);
        free(current);

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
    free(previous);
    free(current);


    printf("\n---------------------------------------------------------------\n");

    printf("LIFECYCLE LOGGING COMPLETE\n");

    printf("Events have been saved to:\n");
    printf("process_events.log\n");

    printf("---------------------------------------------------------------\n");
}

/* =========================================================
   MACHINE-READABLE API MODE
   The interactive menu remains the default entry point.
   ========================================================= */

static void json_string(const char *value) {
    putchar('"');
    for (const unsigned char *character = (const unsigned char *)value;
         *character != '\0'; character++) {
        switch (*character) {
            case '"': printf("\\\""); break;
            case '\\': printf("\\\\"); break;
            case '\n': printf("\\n"); break;
            case '\r': printf("\\r"); break;
            case '\t': printf("\\t"); break;
            default:
                if (*character < 0x20) printf("\\u%04x", *character);
                else putchar(*character);
        }
    }
    putchar('"');
}

static int process_state(int pid, char *state) {
    char path[64];
    char buffer[4096];
    snprintf(path, sizeof(path), "/proc/%d/stat", pid);
    FILE *file = fopen(path, "r");
    if (file == NULL || fgets(buffer, sizeof(buffer), file) == NULL) {
        if (file != NULL) fclose(file);
        return 0;
    }
    fclose(file);
    char *close_name = strrchr(buffer, ')');
    if (close_name == NULL || close_name[1] != ' ') return 0;
    *state = close_name[2];
    return 1;
}

static unsigned long long linux_boot_time(void) {
    static unsigned long long cached = 0;
    if (cached != 0) return cached;
    FILE *file = fopen("/proc/stat", "r");
    if (file == NULL) return 0;
    char line[256];
    while (fgets(line, sizeof(line), file) != NULL) {
        if (sscanf(line, "btime %llu", &cached) == 1) break;
    }
    fclose(file);
    return cached;
}

static unsigned long long process_start_ticks(int pid) {
    char path[64];
    char buffer[4096];
    snprintf(path, sizeof(path), "/proc/%d/stat", pid);
    FILE *file = fopen(path, "r");
    if (file == NULL || fgets(buffer, sizeof(buffer), file) == NULL) {
        if (file != NULL) fclose(file);
        return 0;
    }
    fclose(file);
    char *field = strrchr(buffer, ')');
    if (field == NULL || field[1] != ' ') return 0;
    field += 2;
    char *save = NULL;
    char *token = strtok_r(field, " ", &save);
    unsigned long long start_ticks = 0;
    for (int index = 0; token != NULL && index <= 19; index++) {
        if (index == 19) start_ticks = strtoull(token, NULL, 10);
        token = strtok_r(NULL, " ", &save);
    }
    return start_ticks;
}

static unsigned long long process_start_epoch(int pid) {
    unsigned long long start_ticks = process_start_ticks(pid);
    long ticks_per_second = sysconf(_SC_CLK_TCK);
    unsigned long long boot_time = linux_boot_time();
    if (start_ticks == 0 || ticks_per_second <= 0 || boot_time == 0) return 0;
    return boot_time + start_ticks / (unsigned long long)ticks_per_second;
}

static unsigned int process_uid(int pid) {
    char path[64];
    struct stat information;
    snprintf(path, sizeof(path), "/proc/%d", pid);
    return stat(path, &information) == 0 ? (unsigned int)information.st_uid : 0;
}

static int write_process_json(int pid, int include_path) {
    int ppid = 0;
    unsigned long long user_time = 0;
    unsigned long long system_time = 0;
    long resident_pages = 0;
    char name[PROC_PIDPATHINFO_MAXSIZE] = "Unknown";
    char state = '?';
    char path[PROC_PIDPATHINFO_MAXSIZE] = "";
    if (read_proc_stat(pid, &ppid, &user_time, &system_time, &resident_pages) != 0 ||
        !process_state(pid, &state)) return 0;
    if (proc_name(pid, name, sizeof(name)) <= 0) strcpy(name, "Unknown");
    if (include_path && proc_pidpath(pid, path, sizeof(path)) < 0) {
        strcpy(path, "Path unavailable");
    }
    struct passwd *account = getpwuid((uid_t)process_uid(pid));
    unsigned long long page_size = (unsigned long long)sysconf(_SC_PAGESIZE);
    printf("{\"pid\":%d,\"ppid\":%d,\"name\":", pid, ppid);
    json_string(name);
            printf(",\"state\":\"%c\",\"startTimeTicks\":%llu,\"startTimeUnix\":%llu,\"cpuTimeNs\":%llu,\"userTimeNs\":%llu,\"systemTimeNs\":%llu,\"memoryBytes\":%llu,\"uid\":%u,\"user\":",
                state, process_start_ticks(pid), process_start_epoch(pid), user_time + system_time, user_time, system_time,
           (unsigned long long)(resident_pages > 0 ? resident_pages : 0) * page_size,
           process_uid(pid));
    json_string(account != NULL ? account->pw_name : "unknown");
    if (include_path) {
        printf(",\"executablePath\":");
        json_string(path);
    }
    putchar('}');
    return 1;
}

static int api_process_list(void) {
    int pids[MAX_PROCESSES];
    int count = get_process_list(pids);
    int written = 0;
    printf("{\"processes\":[");
    for (int index = 0; index < count; index++) {
        if (pids[index] <= 0) continue;
        int ppid = 0;
        if (read_proc_stat(pids[index], &ppid, NULL, NULL, NULL) != 0) continue;
        if (written > 0) putchar(',');
        if (write_process_json(pids[index], 0)) written++;
    }
    printf("],\"count\":%d}\n", written);
    return 0;
}

static int api_system_metrics(void) {
    unsigned long long cpu_values[10] = {0};
    unsigned long long cpu_total = 0;
    unsigned long long cpu_idle = 0;
    unsigned long long memory_total = 0;
    unsigned long long memory_available = 0;
    FILE *file = fopen("/proc/stat", "r");
    if (file != NULL) {
        char line[512];
        if (fgets(line, sizeof(line), file) != NULL) {
            sscanf(line, "cpu %llu %llu %llu %llu %llu %llu %llu %llu %llu %llu",
                   &cpu_values[0], &cpu_values[1], &cpu_values[2], &cpu_values[3],
                   &cpu_values[4], &cpu_values[5], &cpu_values[6], &cpu_values[7],
                   &cpu_values[8], &cpu_values[9]);
            for (int index = 0; index < 10; index++) cpu_total += cpu_values[index];
            cpu_idle = cpu_values[3] + cpu_values[4];
        }
        fclose(file);
    }
    file = fopen("/proc/meminfo", "r");
    if (file != NULL) {
        char key[64];
        unsigned long long value;
        char unit[16];
        while (fscanf(file, "%63s %llu %15s", key, &value, unit) == 3) {
            if (strcmp(key, "MemTotal:") == 0) memory_total = value * 1024ULL;
            if (strcmp(key, "MemAvailable:") == 0) memory_available = value * 1024ULL;
        }
        fclose(file);
    }
    int pids[MAX_PROCESSES];
    int count = get_process_list(pids);
    printf("{\"processCount\":%d,\"cpuTotalTicks\":%llu,\"cpuIdleTicks\":%llu,\"memoryTotalBytes\":%llu,\"memoryAvailableBytes\":%llu}\n",
           count, cpu_total, cpu_idle, memory_total, memory_available);
    return 0;
}

static int api_lifecycle_events(void) {
    FILE *file = fopen("process_events.log", "r");
    if (file == NULL) {
        printf("{\"events\":[]}\n");
        return 0;
    }
    char line[8192];
    int first = 1;
    printf("{\"events\":[");
    while (fgets(line, sizeof(line), file) != NULL) {
        char *close_timestamp = strchr(line, ']');
        char event[32];
        char name[PROC_PIDPATHINFO_MAXSIZE];
        int pid;
        if (line[0] != '[' || close_timestamp == NULL ||
            sscanf(close_timestamp + 1, "%31s PID: %d Process: %4095[^\n]", event, &pid, name) != 3) continue;
        if (!first) putchar(',');
        printf("{\"timestamp\":");
        *close_timestamp = '\0';
        json_string(line + 1);
        printf(",\"event\":");
        json_string(event);
        printf(",\"pid\":%d,\"name\":", pid);
        json_string(name);
        putchar('}');
        first = 0;
    }
    fclose(file);
    printf("]}\n");
    return 0;
}

static void emit_lifecycle_event(FILE *log_file, const char *event, int pid, const char *name) {
    char timestamp[64];
    get_timestamp(timestamp, sizeof(timestamp));
    printf("{\"timestamp\":");
    json_string(timestamp);
    printf(",\"event\":");
    json_string(event);
    printf(",\"pid\":%d,\"name\":", pid);
    json_string(name);
    printf("}\n");
    fflush(stdout);
    fprintf(log_file, "[%s] %-11s PID: %-8d Process: %s\n", timestamp, event, pid, name);
    fflush(log_file);
}

static int api_lifecycle_start(int duration) {
    if (duration < 1 || duration > 3600) return 2;
    ProcessSnapshot *previous = calloc(MAX_PROCESSES, sizeof(*previous));
    ProcessSnapshot *current = calloc(MAX_PROCESSES, sizeof(*current));
    FILE *log_file = fopen("process_events.log", "a");
    if (previous == NULL || current == NULL || log_file == NULL) {
        free(previous);
        free(current);
        if (log_file != NULL) fclose(log_file);
        return 1;
    }
    int previous_count = capture_process_snapshot(previous);
    for (int second = 0; second < duration && previous_count > 0; second++) {
        sleep(1);
        int current_count = capture_process_snapshot(current);
        if (current_count <= 0) continue;
        for (int index = 0; index < current_count; index++) {
            if (find_pid_in_snapshot(previous, previous_count, current[index].pid) < 0)
                emit_lifecycle_event(log_file, "STARTED", current[index].pid, current[index].name);
        }
        for (int index = 0; index < previous_count; index++) {
            if (find_pid_in_snapshot(current, current_count, previous[index].pid) < 0)
                emit_lifecycle_event(log_file, "TERMINATED", previous[index].pid, previous[index].name);
        }
        memcpy(previous, current, sizeof(*previous) * (size_t)current_count);
        previous_count = current_count;
    }
    fclose(log_file);
    free(previous);
    free(current);
    printf("{\"done\":true}\n");
    fflush(stdout);
    return 0;
}

static int api_error(const char *message) {
    printf("{\"error\":");
    json_string(message);
    printf("}\n");
    return 1;
}

static int api_dispatch(int argc, char **argv) {
    if (argc < 3) return api_error("An API operation is required.");
    const char *operation = argv[2];
    if (strcmp(operation, "list") == 0) return api_process_list();
    if (strcmp(operation, "metrics") == 0) return api_system_metrics();
    if (strcmp(operation, "events") == 0) return api_lifecycle_events();
    if (strcmp(operation, "lifecycle") == 0 && argc == 4) {
        char *end = NULL;
        long duration = strtol(argv[3], &end, 10);
        if (end == argv[3] || *end != '\0') return api_error("Invalid logging duration.");
        return api_lifecycle_start((int)duration);
    }
    if ((strcmp(operation, "inspect") == 0 || strcmp(operation, "priority") == 0 ||
         strcmp(operation, "scheduling") == 0 || strcmp(operation, "control") == 0) && argc >= 4) {
        char *end = NULL;
        long parsed_pid = strtol(argv[3], &end, 10);
        if (end == argv[3] || *end != '\0' || parsed_pid < 1 || parsed_pid > INT_MAX)
            return api_error("Invalid PID.");
        int pid = (int)parsed_pid;
        if (!process_exists(pid)) return api_error("Process does not exist.");
        if (strcmp(operation, "inspect") == 0 && argc == 4) {
            if (!write_process_json(pid, 1)) return api_error("Process does not exist.");
            putchar('\n');
            return 0;
        }
        if (strcmp(operation, "control") == 0 && argc == 5) {
            int signal_number;
            if (strcmp(argv[4], "stop") == 0) signal_number = SIGSTOP;
            else if (strcmp(argv[4], "continue") == 0) signal_number = SIGCONT;
            else if (strcmp(argv[4], "terminate") == 0) signal_number = SIGTERM;
            else if (strcmp(argv[4], "kill") == 0) signal_number = SIGKILL;
            else return api_error("Unsupported process action.");
            char state = '?';
            if (send_signal_and_verify(pid, signal_number, &state) != 0) {
                if (errno == EPERM || errno == EACCES) return api_error("Permission denied.");
                if (errno == ESRCH) return api_error("Process does not exist.");
                if (errno == ETIMEDOUT) return api_error("Timed out waiting for the process state to change.");
                return api_error(strerror(errno));
            }
            printf("{\"success\":true,\"pid\":%d,\"action\":", pid);
            json_string(argv[4]);
            printf(",\"state\":\"%c\",\"stateLabel\":", state);
            json_string(process_state_label(state));
            printf("}\n");
            return 0;
        }
        if (strcmp(operation, "priority") == 0 && (argc == 4 || argc == 5)) {
            errno = 0;
            int priority = getpriority(PRIO_PROCESS, pid);
            if (errno != 0) return api_error(errno == EACCES || errno == EPERM ? "Permission denied reading process priority." : "Unable to read process priority.");
            if (argc == 5) {
                char *delta_end = NULL;
                long delta = strtol(argv[4], &delta_end, 10);
                if (delta_end == argv[4] || *delta_end != '\0' || delta < -1 || delta > 1 || delta == 0)
                    return api_error("Priority adjustment must be -1 or 1.");
                int adjusted = priority + (int)delta;
                if (adjusted < -20 || adjusted > 19)
                    return api_error(adjusted < -20
                        ? "Nice value is already at the minimum of -20."
                        : "Nice value is already at the maximum of 19.");
                if (setpriority(PRIO_PROCESS, pid, adjusted) != 0)
                    return api_error(errno == EACCES || errno == EPERM
                        ? "Permission denied changing process priority. Linux requires CAP_SYS_NICE or an applicable RLIMIT_NICE to lower a nice value."
                        : "Unable to change process priority.");
                errno = 0;
                priority = getpriority(PRIO_PROCESS, pid);
                if (errno != 0) return api_error("Priority changed but could not be read back.");
            }
            printf("{\"pid\":%d,\"priority\":%d}\n", pid, priority);
            return 0;
        }
        if (strcmp(operation, "scheduling") == 0 && (argc == 4 || argc == 5)) {
            int policy = sched_getscheduler(pid);
            if (policy < 0)
                return api_error(errno == EACCES || errno == EPERM
                    ? "Permission denied reading process scheduling policy."
                    : "Unable to read process scheduling policy.");

            if (argc == 5) {
                int requested_policy;
                if (strcmp(argv[4], "normal") == 0) requested_policy = SCHED_OTHER;
                else if (strcmp(argv[4], "batch") == 0) requested_policy = SCHED_BATCH;
                else return api_error("Choose the normal or batch scheduling policy.");

                struct sched_param parameters = { .sched_priority = 0 };
                if (policy == SCHED_IDLE)
                    return api_error("Permission denied: leaving SCHED_IDLE requires CAP_SYS_NICE. Restart the process or use an administrator-authorized monitor.");
                if (sched_setscheduler(pid, requested_policy, &parameters) != 0)
                    return api_error(errno == EACCES || errno == EPERM
                        ? "Permission denied changing process scheduling policy."
                        : "Unable to change process scheduling policy.");
                policy = sched_getscheduler(pid);
                if (policy < 0) return api_error("Scheduling policy changed but could not be read back.");
            }

            const char *policy_name = policy == SCHED_BATCH ? "batch"
                : policy == SCHED_IDLE ? "idle"
                : policy == SCHED_OTHER ? "normal" : "other";
            const char *policy_label = policy == SCHED_BATCH ? "Batch"
                : policy == SCHED_IDLE ? "Idle"
                : policy == SCHED_OTHER ? "Normal" : "Other";
            printf("{\"pid\":%d,\"policy\":", pid);
            json_string(policy_name);
            printf(",\"policyLabel\":");
            json_string(policy_label);
            printf("}\n");
            return 0;
        }
    }
    if (strcmp(operation, "launch") == 0 && argc >= 4) {
        int safe_sleep = strcmp(argv[3], "sleep") == 0 && argc == 5;
        int safe_yes = strcmp(argv[3], "yes") == 0 && argc == 4;
        if (!safe_sleep && !safe_yes) return api_error("Only the allowlisted sleep and yes commands may be launched.");
        if (safe_sleep) {
            char *end = NULL;
            long seconds = strtol(argv[4], &end, 10);
            if (end == argv[4] || *end != '\0' || seconds < 1 || seconds > 3600)
                return api_error("sleep duration must be between 1 and 3600 seconds.");
        }
        pid_t child = fork();
        if (child < 0) return api_error("Unable to create process.");
        if (child == 0) {
            int null_descriptor = open("/dev/null", O_RDWR);
            if (null_descriptor >= 0) {
                dup2(null_descriptor, STDIN_FILENO);
                dup2(null_descriptor, STDOUT_FILENO);
                dup2(null_descriptor, STDERR_FILENO);
                close(null_descriptor);
            }
            if (safe_sleep) execl("/usr/bin/sleep", "sleep", argv[4], (char *)NULL);
            else execl("/usr/bin/yes", "yes", (char *)NULL);
            _exit(127);
        }
        printf("{\"pid\":%d,\"command\":", child);
        if (safe_sleep) {
            char command[64];
            snprintf(command, sizeof(command), "sleep %s", argv[4]);
            json_string(command);
        } else json_string("yes");
        printf("}\n");
        return 0;
    }
    if (strcmp(operation, "create-file") == 0 && argc == 4) {
        const char *filename = argv[3];
        if (filename[0] == '\0' || strlen(filename) > 64 || strchr(filename, '/') != NULL ||
            strcmp(filename, ".") == 0 || strcmp(filename, "..") == 0)
            return api_error("Invalid file name.");
        for (const unsigned char *character = (const unsigned char *)filename; *character; character++)
            if (!( (*character >= 'a' && *character <= 'z') || (*character >= 'A' && *character <= 'Z') ||
                   (*character >= '0' && *character <= '9') || *character == '.' || *character == '_' || *character == '-'))
                return api_error("File names may contain only letters, numbers, dots, underscores, and hyphens.");
        pid_t child = fork();
        if (child < 0) return api_error("Unable to create file process.");
        if (child == 0) {
            int null_descriptor = open("/dev/null", O_RDWR);
            if (null_descriptor >= 0) {
                dup2(null_descriptor, STDIN_FILENO);
                dup2(null_descriptor, STDOUT_FILENO);
                dup2(null_descriptor, STDERR_FILENO);
                close(null_descriptor);
            }
            int descriptor = open(filename, O_WRONLY | O_CREAT | O_EXCL, 0644);
            if (descriptor < 0) _exit(1);
            FILE *created = fdopen(descriptor, "w");
            if (created == NULL) { close(descriptor); _exit(1); }
            fprintf(created, "This file was created by a process.\n");
            fclose(created);
            while (1) sleep(1);
        }
        printf("{\"pid\":%d,\"file\":", child);
        json_string(filename);
        printf("}\n");
        return 0;
    }
    return api_error("Unsupported API operation or invalid arguments.");
}


/* =========================================================
   MAIN MENU
   ========================================================= */

int main(int argc, char **argv) {

    if (argc >= 2 && strcmp(argv[1], "--api") == 0) {
        return api_dispatch(argc, argv);
    }

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

        if (!read_int(&choice)) {
            if (feof(stdin)) return 0;
            printf("\nInvalid choice. Please try again.\n");
            continue;
        }


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
                display_processes();

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
