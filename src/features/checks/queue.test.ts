import { afterAll, expect, test } from "bun:test";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Str from "effect/String";

import { eventually } from "#src/primitives/eventually.ts";

const scratch = `${Bun.env["TMPDIR"] ?? "/tmp"}/queue-bin-test-${String(process.pid)}`;

const run = <Value, Failure>(body: Effect.Effect<Value, Failure, FileSystem.FileSystem>) =>
	Effect.runPromise(Effect.provide(body, NodeServices.layer));

afterAll(() => run(Effect.flatMap(FileSystem.FileSystem, (fs) => fs.remove(scratch, { recursive: true }))));

const queued = (dir: string, script: string) =>
	Bun.spawn([`${import.meta.dirname}/../../../agent/bin/queue`, "lane", "--", "sh", "-c", script], {
		cwd: dir,
		env: { PATH: Bun.env["PATH"] ?? "", HOME: dir },
		stderr: "pipe",
	});

const tickets = (dir: string, count: number) =>
	Effect.flatMap(FileSystem.FileSystem, (fs) => {
		const names = Effect.orElseSucceed(fs.readDirectory(`${dir}/.local/state/pi-agent/queues/lane`), () => []);

		return Effect.map(names, (found) => Arr.filter(found, Str.endsWith(".json")).length === count);
	});

const twoInLine = (dir: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;

		yield* fs.makeDirectory(dir, { recursive: true });

		const first = queued(dir, "touch first-started; while [ ! -f release ]; do sleep 0.05; done");

		yield* eventually(fs.exists(`${dir}/first-started`), "30 seconds");

		const second = queued(dir, "touch second-ran; exit 4");

		yield* eventually(tickets(dir, 2), "30 seconds");

		return { first, second };
	});

test(
	"a second command waits, says it is queued, and runs once the first one ends",
	() =>
		run(
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const dir = `${scratch}/in-turn`;
				const { first, second } = yield* twoInLine(dir);
				const ranEarly = yield* fs.exists(`${dir}/second-ran`);

				yield* fs.writeFileString(`${dir}/release`, "");

				const codes = yield* Effect.promise(() => Promise.all([first.exited, second.exited]));
				const said = yield* Effect.promise(() => new Response(second.stderr).text());
				const ran = yield* fs.exists(`${dir}/second-ran`);

				expect({ ranEarly, codes, ran }).toEqual({ ranEarly: false, codes: [0, 4], ran: true });
				expect(said).toContain("queue lane: queued, 1 ahead of this one");
				expect(said).toMatch(/queue lane: got a place after \d+ s/u);
			}),
		),
	{ timeout: 60_000 },
);

test(
	"a holder that is killed frees its place for the next command in line",
	() =>
		run(
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const dir = `${scratch}/killed`;
				const { first, second } = yield* twoInLine(dir);

				first.kill("SIGKILL");

				const code = yield* Effect.promise(() => second.exited);

				yield* fs.writeFileString(`${dir}/release`, "");

				expect(code).toBe(4);
			}),
		),
	{ timeout: 60_000 },
);
