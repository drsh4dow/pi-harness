import { expect, test } from "bun:test";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import type * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Str from "effect/String";

import { eventually } from "#src/primitives/eventually.ts";

const repo = Str.replace(/\/tools\/driver$/u, "")(import.meta.dirname);

const fakePi = `#!${process.execPath}
import fs from "node:fs";
const args = process.argv.slice(2);
if (args.includes("--version")) {
	console.log("9.9.9");
	process.exit(0);
}
const env = process.env;
const pid = String(process.pid);
const asked = args[args.indexOf("--model") + 1];
const [provider, id] = asked.split("/");
const sessionDir = args[args.indexOf("--session-dir") + 1];
const read = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {});
const agent = env.PI_CODING_AGENT_DIR;
const loaded = {
	type: "loaded",
	session: pid,
	version: "9.9.9",
	model: env.FAKE_MODEL ?? asked,
	contextWindow: read(agent + "/models.json").providers?.[provider]?.modelOverrides?.[id]?.contextWindow ?? 200000,
	extensions: [],
	settings: read(agent + "/settings.json"),
	socket: env.HC_TERMINAL_SOCKET,
};
fs.appendFileSync(env.FAKE_DIR + "/pids", pid + "\\n");
fs.appendFileSync(env.PI_DRIVER_PROBE + "/" + pid + ".jsonl", JSON.stringify(loaded) + "\\n");
for await (const line of console) {
	const command = JSON.parse(line);
	if (command.type === "get_state") {
		await new Promise((resolve) => setTimeout(resolve, Number(env.FAKE_STARTUP ?? 0)));
		fs.writeFileSync(env.FAKE_DIR + "/answered", "");
		if (env.FAKE_LIFE) setTimeout(() => process.exit(3), Number(env.FAKE_LIFE));
	}
	const data = command.type === "get_state" ? { sessionId: pid, sessionFile: sessionDir + "/" + pid + ".jsonl" } : {};
	console.log(JSON.stringify({ type: "response", id: command.id, command: command.type, success: true, data }));
}
`;

const fakeCore = `#!/bin/sh
echo $$ >>"$FAKE_DIR/pids"
mkdir -p "\${HC_SOCKET%/*}" && : >"$HC_SOCKET"
exec sleep 600
`;

interface Written {
	readonly name: string;
	readonly play: string;
	readonly keys?: string;
	readonly env?: Readonly<Record<string, string>>;
}

const sourceOf = (written: Written, fake: string) => `import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { scenario } from "${repo}/tools/driver/index.ts";

const fake = "${fake}";

scenario({ env: process.env, model: "fake/model", ${written.keys ?? ""} play: (run) => ${written.play} });
`;

const isAlive = (pid: number) => {
	try {
		process.kill(pid, 0);

		return true;
	} catch {
		return false;
	}
};

type Prepare = (fake: string) => Effect.Effect<void, PlatformError.PlatformError, FileSystem.FileSystem>;

const started = (written: Written, prepare: Prepare = () => Effect.void) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const fake = yield* fs.makeTempDirectoryScoped();
		const file = `${fake}/${written.name}.scenario.ts`;

		yield* Effect.forEach(["bin", "human", "runtime"], (folder) => fs.makeDirectory(`${fake}/${folder}`));
		yield* fs.writeFileString(`${fake}/pi.js`, fakePi, { mode: 0o755 });
		yield* fs.symlink(`${fake}/pi.js`, `${fake}/bin/pi`);
		yield* fs.writeFileString(`${fake}/bin/herdr-core`, fakeCore, { mode: 0o755 });
		yield* fs.symlink(`${repo}/node_modules`, `${fake}/node_modules`);
		yield* fs.writeFileString(file, sourceOf(written, fake));
		yield* prepare(fake);

		const env = {
			PATH: `${fake}/bin:/usr/bin:/bin`,
			HOME: `${fake}/human`,
			XDG_RUNTIME_DIR: `${fake}/runtime`,
			TMPDIR: fake,
			PI_DRIVER_SERVICE: "1",
			FAKE_DIR: fake,
			...written.env,
		};

		const driver = yield* Effect.acquireRelease(
			Effect.sync(() => Bun.spawn([process.execPath, file], { stdin: "pipe", stdout: "pipe", env })),
			(running) =>
				Effect.sync(() => {
					running.kill("SIGKILL");
				}),
		);

		return { fake, driver };
	});

type Started = Effect.Success<ReturnType<typeof started>>;

const linesOf = (text: string) => Arr.filter(Str.split(text, "\n"), Str.isNonEmpty);

const finished = ({ fake, driver }: Started) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const stdout = yield* Effect.promise(() => driver.stdout.text()).pipe(Effect.timeout("50 seconds"));
		const code = yield* Effect.promise(() => driver.exited);
		const lines = linesOf(stdout);
		const runLine = Arr.findFirst(lines, Str.startsWith("run "));

		const folder = runLine.pipe(
			Option.map(Str.slice(4)),
			Option.getOrElse(() => ""),
		);

		const pidText = (yield* fs.exists(`${fake}/pids`)) ? yield* fs.readFileString(`${fake}/pids`) : "";
		const pids = Arr.map(linesOf(pidText), Number);

		yield* Effect.ignore(
			eventually(
				Effect.sync(() => !Arr.some(pids, isAlive)),
				"2 seconds",
			),
		);

		return { fake, code, lines, folder, alive: Arr.filter(pids, isAlive) };
	});

type Finished = Effect.Success<ReturnType<typeof finished>>;

const played = (written: Written) => Effect.flatMap(started(written), finished);

const inWorld = <Value, Failure>(effect: Effect.Effect<Value, Failure, FileSystem.FileSystem | Scope.Scope>) =>
	Effect.runPromise(effect.pipe(Effect.scoped, Effect.provide(NodeServices.layer)));

const expectEnding = (run: Finished, ending: { readonly code: number; readonly verdict: RegExp }) => {
	const [verdict = "", evidence = ""] = Arr.takeRight(run.lines, 2);

	expect(verdict).toMatch(ending.verdict);
	expect([run.code, evidence, run.alive]).toEqual([ending.code, `evidence ${run.folder}`, []]);
};

const Said = Schema.Struct({
	answered: Schema.Boolean,
	pi: Schema.Struct({ version: Schema.String, path: Schema.String }),
	agentDir: Schema.String,
	home: Schema.String,
	shell: Schema.Struct({ code: Schema.Finite, output: Schema.String }),
	compaction: Schema.Json,
	window: Schema.Json,
	file: Schema.Json,
	found: Schema.String,
	second: Schema.String,
	secondStopped: Schema.Boolean,
});

const decodeSaid = Schema.decodeUnknownEffect(Schema.fromJsonString(Said));

const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Json));

const decodeProbed = Schema.decodeUnknownEffect(
	Schema.fromJsonString(Schema.Struct({ model: Schema.String, socket: Schema.String })),
);

const spawnLimit = { timeout: 60_000 };

const passingPlay = `Effect.gen(function* () {
	const answered = yield* run.exec(["test", "-e", \`\${fake}/answered\`]);
	const shell = yield* run.exec(["sh", "-c", 'pwd; echo "$HOME $FAKE_MARK"; readlink -f "$PI_CODING_AGENT_DIR/extensions"; exit 3']);
	const settings = yield* run.exec(["sh", "-c", 'cat "$PI_CODING_AGENT_DIR/settings.json"']);
	const models = yield* run.exec(["sh", "-c", 'cat "$PI_CODING_AGENT_DIR/models.json"']);
	const file = yield* run.exec(["sh", "-c", 'cat "$HOME/.config/fake/c.json"']);
	const found = yield* run.waitFor("the root's session", "10 seconds", (sessions) => Option.some(sessions.root.id));
	const second = yield* Effect.scoped(run.spawn({ name: "second", providers: { other: { baseUrl: "http://second" } } }));
	const lastStarted = yield* run.exec(["sh", "-c", 'kill -0 "$(tail -n 1 "$FAKE_DIR/pids")"']);
	yield* run.say({
		answered: answered.code === 0,
		pi: run.pi,
		agentDir: run.agentDir,
		home: run.home,
		shell,
		compaction: JSON.parse(settings.output).compaction,
		window: JSON.parse(models.output).providers.fake,
		file: JSON.parse(file.output),
		found,
		second: second.project,
		secondStopped: lastStarted.code !== 0,
	});
})`;

const passingRun = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;

	const run = yield* played({
		name: "passing",
		env: { FAKE_MARK: "copied", FAKE_STARTUP: "1000" },
		keys: `contextWindow: 40_000, files: ({ home }) => ({ ".config/fake/c.json": { home } }),`,
		play: passingPlay,
	});

	const said = yield* Arr.findFirst(run.lines, Str.startsWith("{")).pipe(
		Effect.fromOption,
		Effect.flatMap(decodeSaid),
	);

	const secondModels = yield* fs
		.readFileString(`${run.folder}/pis/second/agent/models.json`)
		.pipe(Effect.flatMap(decodeJson));

	const probes = yield* fs.readDirectory(`${run.folder}/probe`);

	const probed = yield* Effect.forEach(probes, (probe) =>
		fs.readFileString(`${run.folder}/probe/${probe}`).pipe(Effect.flatMap(decodeProbed)),
	);

	const piPath = yield* fs.realPath(`${run.fake}/pi.js`);

	return { ...run, said, piPath, second: { models: secondModels, probed } };
});

const passing = passingRun.pipe(Effect.cached, Effect.runSync);

const outcomes = [
	{
		name: "a false check fails with its claim",
		play: `run.check(false, "the claim")`,
		code: 1,
		verdict: /^fail outcome: the claim$/u,
	},
	{
		name: "a play's own error fails with its message",
		play: `Effect.fail(new Error("boom"))`,
		code: 1,
		verdict: /^fail outcome: boom$/u,
	},
	{
		name: "a waitFor that never finds fails once its time is up",
		play: `run.waitFor("nothing", "1 second", () => Option.none())`,
		code: 1,
		verdict: /^fail outcome: timed out after 1 s waiting for nothing$/u,
	},
	{
		name: "a root that exits fails a waitFor at once",
		play: `run.waitFor("nothing", "1 minute", () => Option.none())`,
		env: { FAKE_LIFE: "500" },
		code: 1,
		verdict: /^fail outcome: the root pi exited 3/u,
	},
	{
		name: "a command that cannot start fails the play",
		play: `run.exec(["/nonexistent/command"])`,
		code: 1,
		verdict: /^fail outcome: \/nonexistent\/command did not start/u,
	},
	{
		name: "a root that runs another model breaks the run before play",
		play: `Effect.die("play ran")`,
		env: { FAKE_MODEL: "other/model" },
		code: 2,
		verdict: /^broken outcome: the root did not take its setup: it runs other\/model, not fake\/model$/u,
	},
	{
		name: "a run that wrote under the human's state folder breaks after it played",
		play: `run.exec(["mkdir", "-p", \`\${fake}/human/.local/state/\${run.home.split("/").at(-2)}\`])`,
		code: 2,
		verdict: /^broken outcome: the run wrote under your folders: /u,
	},
] as const;

test.concurrent(
	"a play that holds passes, prints the verdict and the evidence last, and leaves no process",
	() =>
		inWorld(
			Effect.map(passing, (run) => {
				expectEnding(run, { code: 0, verdict: /^pass passing in \d+ s$/u });
			}),
		),
	spawnLimit,
);

test.concurrent.each(outcomes)(
	"$name, prints the verdict and the evidence last, and leaves no process",
	(outcome) =>
		inWorld(
			Effect.map(played({ ...outcome, name: "outcome" }), (run) => {
				expectEnding(run, outcome);
			}),
		),
	spawnLimit,
);

test.concurrent(
	"closing the driver's stdin interrupts the play, exits 130 and leaves no process",
	() =>
		inWorld(
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;

				const start = yield* started({
					name: "interrupt",
					play: `Effect.andThen(run.exec(["touch", \`\${fake}/playing\`]), Effect.never)`,
				});

				yield* eventually(fs.exists(`${start.fake}/playing`), "25 seconds");
				yield* Effect.promise(() => Promise.resolve(start.driver.stdin.end()));

				const run = yield* finished(start);

				expectEnding(run, { code: 130, verdict: /^interrupted interrupt$/u });
			}),
		),
	spawnLimit,
);

test.concurrent(
	"a run's folder, HOME, agent folder, pi and commands are the run's own",
	() =>
		inWorld(
			Effect.map(passing, (run) => {
				const id = Str.replace(/^.*\//u, "")(run.folder);
				const { pi, agentDir, home, shell } = run.said;

				expect(id).toMatch(/^passing-\d{8}-\d{6}-\d+$/u);
				expect({ pi, agentDir, home, shell }).toEqual({
					pi: { version: "9.9.9", path: run.piPath },
					agentDir: `${repo}/agent`,
					home: `${run.folder}/home`,
					shell: { code: 3, output: `${run.folder}/${id}\n${run.folder}/home copied\n${repo}/agent/extensions\n` },
				});
			}),
		),
	spawnLimit,
);

test.concurrent(
	"play starts only after the root answered",
	() =>
		inWorld(
			Effect.map(passing, (run) => {
				expect(run.said.answered).toBe(true);
			}),
		),
	spawnLimit,
);

test.concurrent(
	"a process started in the run's environment, as a delegate is, sees the scenario's setup",
	() =>
		inWorld(
			Effect.map(passing, (run) => {
				const { compaction, window, file } = run.said;

				expect({ compaction, window, file }).toEqual({
					compaction: { enabled: true, reserveTokens: 10_000, keepRecentTokens: 5000 },
					window: { modelOverrides: { model: { contextWindow: 40_000 } } },
					file: { home: `${run.folder}/home` },
				});
			}),
		),
	spawnLimit,
);

test.concurrent(
	"waitFor returns what find found and prints that it found it",
	() =>
		inWorld(
			Effect.map(passing, (run) => {
				expect([
					Arr.some(run.lines, (line) => /^ {2}\d+ s {2}found the root's session$/u.test(line)),
					/^\d+$/u.test(run.said.found),
				]).toEqual([true, true]);
			}),
		),
	spawnLimit,
);

test.concurrent(
	"run.spawn starts a pi on the scenario's model and core, in its own folders with its providers, until its scope closes",
	() =>
		inWorld(
			Effect.map(passing, (run) => {
				const models = Arr.map(run.second.probed, ({ model }) => model);
				const sockets = Arr.dedupe(Arr.map(run.second.probed, ({ socket }) => socket));

				expect([run.said.second, run.said.secondStopped, run.second.models, models, sockets.length]).toEqual([
					`${run.folder}/pis/second/project`,
					true,
					{
						providers: {
							fake: { modelOverrides: { model: { contextWindow: 40_000 } } },
							other: { baseUrl: "http://second" },
						},
					},
					["fake/model", "fake/model"],
					1,
				]);
			}),
		),
	spawnLimit,
);

test.concurrent(
	"the scenario's own compaction replaces what contextWindow sets",
	() =>
		inWorld(
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;

				const run = yield* played({
					name: "window",
					keys: "contextWindow: 40_000, settings: { compaction: { enabled: false } },",
					play: `run.check(true, "")`,
				});

				const settings = yield* fs
					.readFileString(`${run.folder}/home/.pi/agent/settings.json`)
					.pipe(Effect.flatMap(decodeJson));

				expect([run.code, settings]).toEqual([0, { compaction: { enabled: false } }]);
			}),
		),
	spawnLimit,
);

test.concurrent(
	"a run whose $TMPDIR/pi-driver is another user's breaks before it starts",
	() =>
		inWorld(
			Effect.gen(function* () {
				const start = yield* started({ name: "foreign", play: `Effect.die("play ran")` }, (fake) =>
					Effect.gen(function* () {
						const fs = yield* FileSystem.FileSystem;

						yield* fs.symlink("/", `${fake}/pi-driver`);
					}),
				);

				const run = yield* finished(start);

				expect([run.code, run.lines]).toEqual([
					2,
					[`broken foreign: ${run.fake}/pi-driver belongs to another user`],
				]);
			}),
		),
	spawnLimit,
);
