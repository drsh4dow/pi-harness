import { expect, test } from "bun:test";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Arr from "effect/Array";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as Str from "effect/String";

import { eventually } from "#src/primitives/eventually.ts";
import { Hc, HcNotice, hcLayer, type RunSpec, TerminalAddress, terminalNameOf } from "./index.ts";

const hcAccepts = (name: string) => /^[a-z0-9][a-z0-9_.-]{0,31}$/u.test(name) && !/^t\d[0-9a-z]*$/u.test(name);

const rows = [
	{ text: "Review the retry cap, again!", name: "review-the-retry-cap-again" },
	{ text: "bun test --watch", name: "bun-test-watch" },
	{ text: "./scripts/check.sh", name: "scripts-check.sh" },
	{ text: "audit attack-the-premise principle file", name: "audit-attack-the-premise" },
	{ text: "classify the principles index on opus", name: "classify-the-principles-index-on" },
	{ text: "supercalifragilisticexpialidocious-extra", name: "supercalifragilisticexpialidocio" },
	{ text: "go supercalifragilisticexpialidocious", name: "go-supercalifragilisticexpialido" },
	{ text: "t7", name: "t7-1" },
	{ text: "_private", name: "private" },
	{ text: "!!!", name: "work" },
];

test.each(rows)('"$text" becomes the terminal name $name', (row) => {
	const name: string = terminalNameOf(row.text);

	expect({ name, hcAccepts: hcAccepts(name) }).toEqual({ name: row.name, hcAccepts: true });
});

const Request = Schema.fromJsonString(
	Schema.Struct({ method: Schema.String, params: Schema.Record(Schema.String, Schema.Json) }),
);

type Script = Readonly<Record<string, ReadonlyArray<string>>>;

const noTerminals = '{"result":{"terminals":[]}}';

const addressed = (terminal: string) => `{"result":{"address":"${terminal}"}}`;

const failed = (kind: string) => `{"error":{"message":"${kind}","data":{"kind":"${kind}"}}}`;

const finished = (terminal: string) =>
	`{"method":"event","params":{"type":"finished","terminal":"${terminal}","data":{"reason":null,"exit_code":0,"signal":null}}}`;

const lived = (terminal: string) =>
	`{"result":{"terminals":[{"address":"${terminal}","state":"live","labels":{},"reason":null,"exit_code":null,"signal":null}]}}`;

const ordinary = {
	"events.subscribe": [noTerminals],
	"terminal.list": [noTerminals],
	"terminal.run": [addressed("t1")],
} satisfies Script;

const methodOf = (line: string) => /"method":"(?<method>[^"]+)"/u.exec(line)?.groups?.["method"] ?? "";

const fakeHc = (path: string, script: Script) =>
	Effect.acquireRelease(
		Effect.sync(() => {
			const lines: Array<string> = [];
			const subscribers = new Set<Bun.Socket>();

			const replyTo = (line: string) => {
				const method = methodOf(line);
				const replies = script[method] ?? [];
				const asked = Arr.filter(lines, (seen) => methodOf(seen) === method).length;

				return replies[Math.min(asked, replies.length - 1)] ?? failed("no_reply");
			};

			const server = Bun.listen({
				unix: path,
				socket: {
					data: (socket, chunk) => {
						const line = Str.trimEnd(chunk.toString());

						socket.write(`${replyTo(line)}\n`);
						lines.push(line);

						if (methodOf(line) === "events.subscribe") {
							subscribers.add(socket);
						}
					},
					end: (socket) => {
						subscribers.delete(socket);
						socket.end();
					},
					close: (socket) => {
						subscribers.delete(socket);
					},
				},
			});

			return {
				server,
				lines,
				subscribers,
				emit: (event: string) => {
					for (const socket of subscribers) {
						socket.write(`${event}\n`);
					}
				},
			};
		}),
		({ server }) =>
			Effect.sync(() => {
				server.stop(true);
			}),
	);

type Fake = Effect.Success<ReturnType<typeof fakeHc>>;

const sent = (fake: Fake, method: string) =>
	Effect.map(
		Effect.forEach(fake.lines, (line) => Schema.decodeEffect(Request)(line)),
		(requests) =>
			Arr.filterMap(requests, (request) =>
				request.method === method ? Result.succeed(request.params) : Result.failVoid,
			),
	);

const agentKey = "k3y0f4g3";

const owned = { "ow.agent": agentKey, "ow.ref": "watch-1" };

const withHc = <Out, Failure>(
	script: Script,
	use: (hc: Hc["Service"], fake: Fake) => Effect.Effect<Out, Failure, Scope.Scope>,
) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = `${yield* fs.makeTempDirectoryScoped()}/hc.sock`;
		const fake = yield* fakeHc(path, { ...ordinary, ...script });
		const config = ConfigProvider.layer(ConfigProvider.fromUnknown({ HC_TERMINAL_SOCKET: path }));
		const parent = Option.some(TerminalAddress("t9"));
		const hc = Layer.provide(hcLayer({ agentKey, parent }), config);
		const built = yield* Layer.build(hc);

		return yield* use(Context.get(built, Hc), fake);
	}).pipe(Effect.scoped, Effect.provide(NodeServices.layer), Effect.runPromise);

const spec: RunSpec = {
	ref: "watch-1",
	name: terminalNameOf("bun test"),
	labels: { "herdr.space": "s1" },
	argv: ["bun", "test"],
	cwd: "/work",
	env: { CI: "1" },
};

const noticesOf = (hc: Hc["Service"], count: number) =>
	hc.notices.pipe(Stream.take(count), Stream.runCollect, Effect.timeout("5 seconds"), Effect.forkScoped);

const tagOf = HcNotice.$match({ Ended: ({ terminal }) => `Ended ${terminal}`, Resynced: () => "Resynced" });

test("run sends hc the spec, with the ow labels added and the agent's terminal as parent", () =>
	withHc({}, (hc, fake) =>
		Effect.gen(function* () {
			yield* hc.run(spec);

			const runs = yield* sent(fake, "terminal.run");

			expect(runs).toEqual([
				{
					argv: ["bun", "test"],
					cwd: "/work",
					env: { CI: "1" },
					parent: "t9",
					name: "bun-test",
					labels: { "herdr.space": "s1", ...owned },
					no_notify: true,
				},
			]);
		}),
	));

test("run takes the next free name when a live terminal holds the one asked for", () =>
	withHc({ "terminal.run": [failed("name_taken"), addressed("t1")] }, (hc, fake) =>
		Effect.gen(function* () {
			yield* hc.run(spec);

			const runs = yield* sent(fake, "terminal.run");

			expect(Arr.map(runs, (params) => params["name"])).toEqual(["bun-test", "bun-test-2"]);
		}),
	));

test("a run retried after spawn_failed finds the terminal hc made by its labels and starts no second one", () =>
	withHc(
		{ "terminal.list": [noTerminals, lived("t1")], "terminal.run": [failed("spawn_failed"), addressed("t2")] },
		(hc, fake) =>
			Effect.gen(function* () {
				const terminal = yield* hc.run(spec);
				const runs = yield* sent(fake, "terminal.run");
				const lists = yield* sent(fake, "terminal.list");

				expect({ terminal, runs: runs.length, lists }).toEqual({
					terminal: TerminalAddress("t1"),
					runs: 1,
					lists: [
						{ all: true, labels: owned },
						{ all: true, labels: owned },
					],
				});
			}),
	));

test("open sends hc the spec with no parent and none of the ow labels", () =>
	withHc({}, (hc, fake) =>
		Effect.gen(function* () {
			const { ref: _ref, ...unowned } = spec;

			yield* hc.open(unowned);

			const runs = yield* sent(fake, "terminal.run");

			expect(runs).toEqual([
				{
					argv: ["bun", "test"],
					cwd: "/work",
					env: { CI: "1" },
					no_parent: true,
					name: "bun-test",
					labels: { "herdr.space": "s1" },
					no_notify: true,
				},
			]);
		}),
	));

test("follow subscribes before any run, and the subscription keeps delivering ends", () =>
	withHc({}, (hc, fake) =>
		Effect.gen(function* () {
			const notices = yield* noticesOf(hc, 2);

			yield* hc.follow;
			yield* eventually(
				Effect.sync(() => fake.subscribers.size === 1),
				"2 seconds",
			);
			fake.emit(finished("t4"));

			const seen = yield* Fiber.join(notices);

			expect(Arr.map(seen, tagOf)).toEqual(["Resynced", "Ended t4"]);
		}),
	));

test("one subscription by the agent key sees the end of every terminal run starts", () =>
	withHc({ "terminal.run": [addressed("t1"), addressed("t2")] }, (hc, fake) =>
		Effect.gen(function* () {
			const notices = yield* noticesOf(hc, 3);

			yield* hc.run(spec);
			yield* hc.run({ ...spec, ref: "watch-2" });
			fake.emit(finished("t1"));
			fake.emit(finished("t2"));

			const seen = yield* Fiber.join(notices);
			const subscriptions = yield* sent(fake, "events.subscribe");

			expect({ notices: Arr.map(seen, tagOf), subscriptions }).toEqual({
				notices: ["Resynced", "Ended t1", "Ended t2"],
				subscriptions: [{ labels: { "ow.agent": agentKey } }],
			});
		}),
	));

test.each([
	{ reason: "output", printed: true },
	{ reason: "timeout", printed: false },
	{ reason: "exit", printed: false },
])("waitForOutput is $printed when hc's wait ends with $reason", ({ reason, printed }) =>
	withHc({ "terminal.wait": [`{"result":{"reason":"${reason}"}}`] }, (hc) =>
		Effect.map(hc.waitForOutput(TerminalAddress("t1"), "ready", Duration.seconds(1)), (got) => {
			expect(got).toBe(printed);
		}),
	),
);

const wide = Str.repeat(300)("0");

test("read asks hc for the screen and `history` lines, and keeps a line wider than the screen whole", () =>
	withHc({ "terminal.read": [`{"result":{"text":"${wide}\\n\\n"}}`] }, (hc, fake) =>
		Effect.gen(function* () {
			const text = yield* hc.read(TerminalAddress("t1"), 40);

			expect({ text, asked: yield* sent(fake, "terminal.read") }).toEqual({
				text: wide,
				asked: [{ terminal: "t1", lines: 40 }],
			});
		}),
	));

test("killing a terminal that is already gone succeeds without a warning", () => {
	const logged = { count: 0 };

	const counting = Logger.make(() => {
		logged.count += 1;
	});

	return withHc({ "terminal.kill": [failed("not_found")] }, (hc) =>
		Effect.gen(function* () {
			yield* Effect.provideService(hc.kill(TerminalAddress("t1")), Logger.CurrentLoggers, new Set([counting]));

			expect(logged.count).toBe(0);
		}),
	);
});

test("hc starts with none of HC_TERMINAL_SOCKET, XDG_RUNTIME_DIR and HC_SESSION set", () => {
	const unset = ConfigProvider.layer(ConfigProvider.fromUnknown({}));
	const hc = Layer.provide(hcLayer({ agentKey, parent: Option.none() }), unset);

	return Effect.gen(function* () {
		const built = yield* Layer.build(hc);

		expect(Context.get(built, Hc)).toBeDefined();
	}).pipe(Effect.scoped, Effect.runPromise);
});
