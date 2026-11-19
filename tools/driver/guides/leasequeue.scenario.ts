import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Str from "effect/String";

import { type Commit, offGitHub, rootModel } from "#tools/driver/align/observe.ts";
import { scenario } from "#tools/driver/index.ts";
import { measure } from "./measure.ts";
import type { Timeline, Window } from "./timeline.ts";

const history: ReadonlyArray<Commit> = [
	{
		subject: "First version of leasequeue",
		files: {
			"README.md": `# leasequeue

An in-memory job queue. A worker leases a job, runs it, and acks it. A lease that runs out frees the job.
`,
			"leasequeue/__init__.py": "",
			"leasequeue/queue.py": `import time


class Queue:
    def __init__(self, lease_seconds: float = 30.0) -> None:
        self.lease_seconds = lease_seconds
        self.jobs: dict[str, dict] = {}

    def put(self, job_id: str) -> None:
        self.jobs[job_id] = {"state": "ready", "holder": None, "until": 0.0}

    def lease(self, worker: str, now: float | None = None) -> str | None:
        now = time.time() if now is None else now
        for job_id, job in self.jobs.items():
            expired = job["state"] == "leased" and job["until"] <= now
            if job["state"] == "ready" or expired:
                job.update(state="leased", holder=worker, until=now + self.lease_seconds)
                return job_id
        return None

    def ack(self, job_id: str, worker: str) -> bool:
        self.jobs[job_id]["state"] = "done"
        return True
`,
		},
	},
];

const request =
	"leasequeue marks a job done when a worker whose lease already ran out acks it, even though another worker has taken the job since. Make ack return False and change nothing unless the caller is the job's current holder and the lease has not run out. Then give me a statechart of one job's life with two workers, covering lease, expiry and ack, checked by a tool rather than drawn by hand, with the shortest path to a job acked by a worker that doesn't hold it. Put the chart in docs/lifecycle.md.";

const statechart = "skills/statechart/SKILL.md";

/**
 * Opens when the statechart skill is read, once its command checked a model after that read, and closes at the root's
 * final reply. Without the read, the check or the reply there is no event.
 */
const handoff = ({ reads, steps, finalReply }: Timeline): Option.Option<Window> =>
	Option.flatMap(
		Arr.findFirst(reads, ({ guide }) => guide === statechart),
		(chart) => {
			const checked = Arr.some(
				steps,
				(step) =>
					step.at > chart.at && Arr.some(step.calls, ({ text }) => Str.includes("scripts/statechart")(text)),
			);

			return Option.map(
				Option.filter(finalReply, () => checked),
				({ at }) => ({ opens: Option.some(chart.at), closes: at }),
			);
		},
	);

scenario({
	env: { ...process.env, GH_HOST: offGitHub },
	model: rootModel,
	play: (run) =>
		measure({
			run,
			guides: ["skills/create-formal-verification-skill/SKILL.md"],
			history,
			request,
			within: "45 minutes",
			event: handoff,
		}),
});
