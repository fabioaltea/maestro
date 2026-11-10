/* Qualification-only sentinel. Never part of the production runtime. */
#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <spawn.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>
extern char **environ;

/* 0: denied by policy; 10: operation succeeded; 11: unrelated failure. */
static int denial(void) { return errno == EPERM || errno == EACCES ? 0 : 11; }

int main(int argc, char **argv) {
  if (argc < 2) return 11;
  if (!strcmp(argv[1], "child")) return 10;
  if (!strcmp(argv[1], "write") && argc == 3) {
    int fd = open(argv[2], O_CREAT | O_WRONLY | O_TRUNC, 0600);
    if (fd < 0) return denial();
    if (write(fd, "executed", 8) != 8) { close(fd); return 11; }
    close(fd);
    return 10;
  }
  if (!strcmp(argv[1], "fork")) {
    pid_t child = fork();
    if (child < 0) return denial();
    if (child == 0) _exit(0);
    int status;
    if (waitpid(child, &status, 0) != child) return 11;
    return 10;
  }
  if (!strcmp(argv[1], "spawn")) {
    pid_t child;
    char *arguments[] = { argv[0], "child", NULL };
    int result = posix_spawn(&child, argv[0], NULL, NULL, arguments, environ);
    if (result != 0) return result == EPERM || result == EACCES ? 0 : 11;
    int status;
    if (waitpid(child, &status, 0) != child) return 11;
    return 10;
  }
  if (!strcmp(argv[1], "network") && argc == 3) {
    int fd = socket(AF_INET, SOCK_STREAM, 0);
    if (fd < 0) return denial();
    struct sockaddr_in address;
    memset(&address, 0, sizeof(address));
    address.sin_family = AF_INET;
    address.sin_port = htons((unsigned short)strtoul(argv[2], NULL, 10));
    address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    if (connect(fd, (struct sockaddr *)&address, sizeof(address)) < 0) {
      int result = denial(); close(fd); return result;
    }
    close(fd);
    return 10;
  }
  return 11;
}
