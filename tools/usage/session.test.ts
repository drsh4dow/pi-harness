import { expect, test } from "bun:test";

import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Schema from "effect/Schema";

import type { GuideEvent } from "./events.ts";
import { type GuideOnDisk, libraryOf } from "./guides.ts";
import { factsOf, startOf } from "./session.ts";

const linesOf = (name: string, count: number) =>
	Arr.makeBy(count, (line) => `Line ${String(line)} of the ${name} guide, long enough to mark it.`);

const file = (name: string, lines: ReadonlyArray<string>) => `---\nname: ${name}\n---\n\n${Arr.join(lines, "\n")}\n`;

const big = linesOf("big", 8);
const small = linesOf("small", 3);
const shared = linesOf("shared", 8);
const retired = linesOf("retired", 6);

const library = libraryOf({
	today: [
		{ kind: "skill", name: "big", text: file("big", big) },
		{ kind: "principle", name: "small", text: file("small", small) },
		{ kind: "playbook", name: "shared", text: file("shared", shared) },
	],
	past: [
		{ name: "small", text: file("small", Arr.take(shared, 5)) },
		{ name: "retired", text: file("retired", retired) },
	],
});

const prompt = {
	type: "message",
	message: {
		role: "system",
		content: "",
		timestamp: 0,
		sections: {
			preamble:
				'<role>\nYou are a leaf.\n</role>\n<principles dir="/p">\n- small: when it fits\n</principles>\n<playbooks dir="/b">\n- shared: when it fits\n</playbooks>',
			skills: "<available_skills>\n- big: when it fits\n</available_skills>",
		},
	},
};

const shown = (text: string) => ({
	type: "message",
	message: {
		role: "toolResult",
		toolCallId: "t",
		toolName: "read",
		content: [{ type: "text", text }],
		isError: false,
	},
});

type ToolUse = readonly [string, Readonly<Record<string, string>>];

const calls = (...uses: ReadonlyArray<ToolUse>) => ({
	type: "message",
	message: {
		role: "assistant",
		content: Arr.map(uses, ([name, args]) => ({ type: "toolCall", id: "t", name, arguments: args })),
	},
});

const codemodeResult = (...made: ReadonlyArray<ToolUse>) => ({
	type: "message",
	message: {
		role: "toolResult",
		toolCallId: "t",
		toolName: "codemode",
		content: [{ type: "text", text: "done" }],
		isError: false,
		nestedCalls: {
			complete: true,
			calls: Arr.map(made, ([name, args], at) => ({ id: `t/${String(at)}`, name, status: "ok", arguments: args })),
		},
	},
});

const reply = calls();
const header = { type: "session", id: "s", timestamp: "2026-11-10T09:00:00.000Z", cwd: "/home/u/app" };

type Entry =
	| typeof header
	| typeof prompt
	| ReturnType<typeof shown>
	| ReturnType<typeof calls>
	| ReturnType<typeof codemodeResult>;

const encodeJson = Schema.encodeUnknownOption(Schema.fromJsonString(Schema.Unknown));
const jsonLine = (value: Entry | { readonly text: string }) => Option.getOrElse(encodeJson(value), () => "");

const factsFor = (entries: ReadonlyArray<Entry>) => {
	const text = Arr.join(Arr.map([header, prompt, ...entries], jsonLine), "\n");

	return factsOf({ library, text });
};

const loadedIn = (entries: ReadonlyArray<Entry>) => {
	const loaded = Option.match(factsFor(entries), {
		onNone: () => new Map<GuideOnDisk, string>(),
		onSome: (facts) => facts.loaded,
	});

	return Arr.map([...loaded], ([guide, by]) => `${guide.name} by ${by}`);
};

const eventsIn = (entries: ReadonlyArray<Entry>) => {
	const events = Option.match(factsFor(entries), {
		onNone: () => new Set<GuideEvent>(),
		onSome: (facts) => facts.events,
	});

	return Arr.map([...events], ({ name }) => name);
};

const joined = (lines: ReadonlyArray<string>) => Arr.join(lines, "\n");
const first = (lines: ReadonlyArray<string>, count: number) => joined(Arr.take(lines, count));
const after = (lines: ReadonlyArray<string>, count: number) => joined(Arr.drop(lines, count));

const bigPath = "/home/u/.pi/agent/skills/big/SKILL.md";

const cases = [
	{ name: "five of a guide's own lines load it", entries: [shown(first(big, 5)), reply], loaded: ["big by lines"] },
	{ name: "four of eight lines do not", entries: [shown(first(big, 4)), reply], loaded: [] },
	{
		name: "all three lines of a small guide load it",
		entries: [shown(joined(small)), reply],
		loaded: ["small by lines"],
	},
	{ name: "two of three lines do not", entries: [shown(first(small, 2)), reply], loaded: [] },
	{
		name: "lines spread over several results add up",
		entries: [shown(first(big, 3)), shown(after(big, 3)), reply],
		loaded: ["big by lines"],
	},
	{
		name: "a read that names the file loads it",
		entries: [calls(["read", { path: bigPath }])],
		loaded: ["big by path"],
	},
	{
		name: "a bash call that names the file does not",
		entries: [calls(["bash", { command: `wc -l ${bigPath}` }])],
		loaded: [],
	},
	{
		name: "lines a script returned inside JSON load it",
		entries: [shown(jsonLine({ text: first(big, 7) })), reply],
		loaded: ["big by lines"],
	},
	{
		name: "another session's log loads nothing",
		entries: [shown(`{"parentId":"a"}\n${joined(big)}`), reply],
		loaded: [],
	},
	{
		name: "a session that edited the guide's file does not count it",
		entries: [shown(joined(big)), calls(["edit", { path: bigPath, oldText: "a", newText: "b" }])],
		loaded: [],
	},
	{
		name: "a codemode script that writes the guide's file is an edit of it",
		entries: [
			shown(joined(big)),
			calls(["codemode", { code: `await tools.write({ path: "${bigPath}", content: "new" })` }]),
		],
		loaded: [],
	},
	{
		name: "a codemode script that writes the guide's file at a computed path is an edit of it",
		entries: [
			shown(joined(big)),
			calls(["codemode", { code: "await tools.write({ path: target, content })" }]),
			codemodeResult(["write", { path: bigPath, content: "new" }]),
		],
		loaded: [],
	},
	{ name: "a line another guide once held marks neither", entries: [shown(first(shared, 5)), reply], loaded: [] },
	{
		name: "the lines only it ever held still mark it",
		entries: [shown(after(shared, 5)), reply],
		loaded: ["shared by lines"],
	},
	{ name: "a guide gone from disk is left out", entries: [shown(joined(retired)), reply], loaded: [] },
];

test.each(cases)("$name", ({ entries, loaded }) => {
	expect(loadedIn(entries)).toEqual(loaded);
});

test("a session the model never answered has no facts", () => {
	const unanswered = shown(joined(big));

	expect(factsFor([unanswered])).toEqual(Option.none());
});

test("a session lists the principles, playbooks and skills its system prompt names, under its role", () => {
	const facts = Option.getOrThrow(factsFor([reply]));

	expect([Arr.sort([...facts.listed], Order.String), facts.role, facts.scope]).toEqual([
		["big", "shared", "small"],
		"leaf",
		"product",
	]);
});

const started: ToolUse = ["delegate", { group: "audit", message: "m" }];
const continued: ToolUse = ["delegate", { group: "audit", continues: "delegate-1" }];

test("three new delegates in one group fire the swarm event", () => {
	expect(eventsIn([calls(started, started, started)])).toEqual(["group of 3+ delegates"]);
});

test("a continuation is not a new delegate", () => {
	expect(eventsIn([calls(started, started, continued)])).toEqual([]);
});

test("delegates a codemode script started count as delegate calls and fire the swarm event", () => {
	const facts = Option.getOrThrow(
		factsFor([calls(["codemode", { code: "fan out" }]), codemodeResult(started, started, started)]),
	);

	expect([facts.delegateCalls.length, Arr.map([...facts.events], ({ name }) => name)]).toEqual([
		3,
		["group of 3+ delegates"],
	]);
});

test("a session file's name, as pi writes it, gives the time the session started", () => {
	expect(startOf("--home-u-app--/2026-11-08T13-53-21-192Z_0f3c9a.jsonl")).toBe(Date.parse("2026-11-08T13:53:21.192Z"));
});

test("a later system message changes neither the listed guides nor the role", () => {
	const later = {
		...prompt,
		message: {
			...prompt.message,
			sections: {
				preamble:
					'<role>\nYou work for the user.\n</role>\n<principles dir="/p">\n- small: when it fits\n</principles>',
				skills: "",
			},
		},
	};

	const facts = Option.getOrThrow(factsFor([later, reply]));

	expect([Arr.sort([...facts.listed], Order.String), facts.role]).toEqual([["big", "shared", "small"], "leaf"]);
});

const scopeIn = (cwd: string) => {
	const text = Arr.join(Arr.map([{ ...header, cwd }, prompt, reply], jsonLine), "\n");

	return Option.map(factsOf({ library, text }), ({ scope }) => scope);
};

test.each([
	{ cwd: "/tmp/trial-7", scope: "trial" },
	{ cwd: "/home/u/.pi/.worktrees/pi-harness/fix", scope: "harness" },
	{ cwd: "/home/u/.local/state/pi-agent/pi-harness/run-1", scope: "harness" },
	{ cwd: "/home/u/code/phi-router", scope: "harness" },
	{ cwd: "/home/u/app", scope: "product" },
])("a session run in $cwd is $scope work", ({ cwd, scope }) => {
	expect(scopeIn(cwd)).toEqual(Option.some(scope));
});

test("a session's facts hold none of the text its messages carry", () => {
	const secret = "the private launch plan for next quarter";

	const delegated = calls(["delegate", { group: "audit", message: secret }], ["bash", { command: `echo ${secret}` }]);
	const read = shown(`${secret}\n${joined(big)}`);
	const facts = Option.getOrThrow(factsFor([read, delegated]));

	expect(Bun.inspect(facts, { depth: 10 })).not.toContain(secret);
});
