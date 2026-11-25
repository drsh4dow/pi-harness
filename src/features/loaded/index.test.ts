import { afterAll, expect, test } from "bun:test";

import { SessionManager } from "@earendil-works/pi-coding-agent";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";

import { ContextLabel, guideFilesIn, inContext, labelKey, type Loaded, loadGuides } from "./index.ts";

const scratch = `${Bun.env["TMPDIR"] ?? "/tmp"}/loaded-test-${String(process.pid)}`;

const lines = (name: string) =>
	Arr.join(
		Arr.makeBy(10, (line) => `Line ${String(line)} of the ${name} file, long enough to mark it.`),
		"\n",
	);

const playbook = `---\nwhen: Fixing a bug.\n---\n\n# Bug fix\n\n${lines("bug-fix")}\n`;
const notes = lines("notes");

const playbooksFolder = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	const dir = `${scratch}/playbooks`;

	yield* fs.makeDirectory(`${dir}/bug-fix`, { recursive: true });
	yield* fs.writeFileString(`${dir}/bug-fix.md`, playbook);
	yield* fs.writeFileString(`${dir}/bug-fix/notes.md`, notes);

	return dir;
});

const sessionReading = (texts: ReadonlyArray<string>) => {
	const session = SessionManager.inMemory();

	for (const text of texts) {
		session.appendMessage({
			role: "toolResult",
			toolCallId: "call",
			toolName: "read",
			content: [{ type: "text", text }],
			isError: false,
			timestamp: 0,
		});
	}

	return session;
};

test("a playbook read whole is in context as a playbook, and a reference file in its subfolder is no guide", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const dir = yield* playbooksFolder;
			const playbooks = yield* guideFilesIn("playbook", dir);
			const principles = yield* guideFilesIn("principle", `${scratch}/principles`);
			const index = yield* loadGuides([...principles, ...playbooks]);
			const { entries } = sessionReading([playbook, notes]).buildSessionProjection();
			const loaded = inContext({ index, entries });

			expect(Arr.map(loaded, ({ kind, name, state }) => ({ kind, name, state }))).toEqual([
				{ kind: "playbook", name: "bug-fix", state: "full" },
			]);
		}).pipe(Effect.provide(NodeServices.layer)),
	));

const fakePi = `
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { loaded } from "${import.meta.dirname}/index.ts";

const { commands, steps } = JSON.parse(process.argv[1]);
const labels = [];

const hc = Bun.listen({
	unix: process.env.HC_TERMINAL_SOCKET,
	socket: {
		data: (socket, chunk) => {
			const { params } = JSON.parse(chunk.toString());
			const label = params.labels["pi.context"];
			labels.push({ terminal: params.terminal, label: label === "" ? "" : JSON.parse(label) });
			socket.write('{"result":{"address":"t9"}}\\n');
		},
	},
});

const handlers = new Map();
loaded({ on: (event, handler) => handlers.set(event, handler), getCommands: () => commands });

const session = SessionManager.inMemory();
const asked = session.appendMessage({ role: "user", content: "fix the bug", timestamp: 0 });
const ctx = { sessionManager: session };

for (const step of steps) {
	if (step.event !== undefined) {
		await handlers.get(step.event)({}, ctx);
	} else if (step.read !== undefined) {
		const text = await Bun.file(step.read).text();
		session.appendMessage({ role: "toolResult", toolCallId: "call", toolName: "read", content: [{ type: "text", text }], isError: false, timestamp: 0 });
	} else {
		session.branch(asked);
	}
}

hc.stop(true);
console.log(JSON.stringify(labels));
process.exit(0);
`;

type Step = { readonly event: string } | { readonly read: string } | { readonly backTo: "the question" };

const Cleared = Schema.Literal("");

const Labelled = Schema.Array(Schema.Struct({ terminal: Schema.String, label: Schema.Union([Cleared, ContextLabel]) }));

const decodeLabelled = Schema.decodeUnknownEffect(Schema.fromJsonString(Labelled));

const encodeArgs = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

const agentDir = `${scratch}/agent`;

const skillPath = `${agentDir}/skills/tdd/SKILL.md`;

const extensionPath = `${agentDir}/extensions/model.ts`;

const agentFolder = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;

	yield* fs.makeDirectory(`${agentDir}/skills/tdd`, { recursive: true });
	yield* fs.makeDirectory(`${agentDir}/principles`, { recursive: true });
	yield* fs.makeDirectory(`${agentDir}/playbooks`, { recursive: true });
	yield* fs.makeDirectory(`${agentDir}/extensions`, { recursive: true });
	yield* fs.writeFileString(skillPath, `---\nname: tdd\n---\n\n# TDD\n\n${lines("tdd")}\n`);
	yield* fs.writeFileString(`${agentDir}/principles/build-the-lever.md`, `# Lever\n\n${lines("lever")}\n`);
	yield* fs.writeFileString(`${agentDir}/playbooks/bug-fix.md`, playbook);
	yield* fs.writeFileString(extensionPath, lines("model"));
});

const commands = [
	{ name: "skill:tdd", source: "skill", sourceInfo: { path: skillPath } },
	{ name: "skill:gone", source: "skill", sourceInfo: { path: `${agentDir}/skills/gone/SKILL.md` } },
	{ name: "model", source: "extension", sourceInfo: { path: extensionPath } },
];

const steps: ReadonlyArray<Step> = [
	{ event: "session_start" },
	{ event: "turn_end" },
	{ read: skillPath },
	{ event: "turn_end" },
	{ event: "agent_end" },
	{ backTo: "the question" },
	{ event: "session_tree" },
	{ read: skillPath },
	{ event: "session_compact" },
	{ event: "session_shutdown" },
];

const runLoaded = (env: Readonly<Record<string, string>>) =>
	Effect.gen(function* () {
		yield* agentFolder;

		const args = yield* encodeArgs({ commands, steps });

		const pi = Bun.spawn([process.execPath, "-e", fakePi, args], {
			env: {
				HOME: Bun.env["HOME"] ?? "",
				PI_CODING_AGENT_DIR: agentDir,
				...env,
			},
			stdout: "pipe",
			stderr: "pipe",
		});

		const [stdout, stderr, code] = yield* Effect.promise(() =>
			Promise.all([new Response(pi.stdout).text(), new Response(pi.stderr).text(), pi.exited]),
		);

		return code === 0 ? yield* decodeLabelled(stdout) : yield* Effect.die(stderr);
	});

const available = { skill: 1, principle: 1, playbook: 1 };

const tddRead: Loaded = { kind: "skill", name: "tdd", path: skillPath, state: "full", by: "agent" };

test("the context label follows turns, /tree moves and compactions, sends only changes, and clears when the session ends", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const sent = yield* runLoaded({ HC_TERMINAL_SOCKET: `${scratch}/in-core.sock`, HC_TERMINAL_ID: "t9" });

			expect(sent).toEqual([
				{ terminal: "t9", label: { loaded: [], available } },
				{ terminal: "t9", label: { loaded: [tddRead], available } },
				{ terminal: "t9", label: { loaded: [], available } },
				{ terminal: "t9", label: { loaded: [tddRead], available } },
				{ terminal: "t9", label: "" },
			]);
		}).pipe(Effect.provide(NodeServices.layer)),
	));

test("outside herdr-core the context label is never sent", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const sent = yield* runLoaded({ HC_TERMINAL_SOCKET: `${scratch}/outside.sock` });

			expect(sent).toEqual([]);
		}).pipe(Effect.provide(NodeServices.layer)),
	));

test("herdr-app's Skills panel reads the label the loaded feature sends", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const panel = yield* fs.readFileString(`${import.meta.dirname}/../../../herdr/mods/ow-skills/context.js`);

			expect(panel).toContain(`const LABEL = "${labelKey}";`);
		}).pipe(Effect.provide(NodeServices.layer)),
	));

afterAll(() => Effect.runPromise(Effect.promise(() => Bun.$`rm -rf ${scratch}`.quiet())));
