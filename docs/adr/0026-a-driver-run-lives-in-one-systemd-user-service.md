---
status: accepted
---

# A driver run lives in one systemd user service

A scenario run starts pi, its delegates and a terminal core, and none of them may outlive the run or write under the human's session and state folders. `bun <file>` starts the driver again as the main process of one transient `systemd-run --user` service, its stdin a pipe from the process the human started. However that process ends, the pipe closes and the driver ends the run as if interrupted. Once the driver in the service exits, systemd kills every process left in the service's cgroup. The service mounts the human's `~/.pi/agent/sessions/` and `~/.local/state/` read-only. The driver signals only its own children through Effect's spawner, before it has waited for them, so no other process can hold their pids.

## Considered options

- **A pid namespace.** It ties every process of the run to the driver more tightly, since the namespace dies with its first process. Rejected because owned-work starts every delegate with `systemd-run --user`, which refuses the user manager from inside a pid namespace, so no scenario with a delegate could run.

## Consequences

- The cleanup, the read-only mounts and the tripwire all rest on the service, so a move away from it redoes each of them.
- A run inside a network namespace the human made sets `PI_DRIVER_SERVICE=1` and plays in the process the human started, with no service and so no cgroup cleanup. `tools/driver/README.md` describes that path.
