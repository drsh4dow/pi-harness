import { expect, test } from "bun:test";

import { parseSessionEntries, type SessionEntry } from "@earendil-works/pi-coding-agent";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";

import { entryKind } from "#src/features/owned-work/index.ts";
import type { Session, Sessions } from "#tools/driver/index.ts";
import { longestBodyLine, settledReply, turnEnds, watch } from "./observe.ts";

const holding = (...requests: ReadonlyArray<string>): Sessions => ({
	root: { id: "root", file: "root.jsonl", entries: [], loaded: Option.none(), requests },
	delegates: [],
});

const json = Schema.encodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

const rootOf = (lines: ReadonlyArray<unknown>): Session => {
	const text = Arr.join(
		Arr.map([{ type: "session", id: "root" }, ...lines], (line) => Option.getOrElse(json(line), () => "")),
		"\n",
	);

	const entries = Arr.filter(parseSessionEntries(text), (entry): entry is SessionEntry => entry.type !== "session");

	return { id: "root", file: "root.jsonl", entries, loaded: Option.none(), requests: [] };
};

const said = (text: string, stopReason: "stop" | "toolUse") => ({
	type: "message",
	message: { role: "assistant", stopReason, content: [{ type: "text", text }] },
});

const work = (type: string, handle: string) => ({ type: "custom", customType: entryKind, data: { type, handle } });

const oneAtATime = <Value>(values: ReadonlyArray<Value>) => {
	let next = 0;

	return Effect.suspend(() => {
		const value = Arr.get(values, next);

		next += 1;

		return Effect.fromOption(value);
	});
};

test("the root's turn ends are the text of each message that did not stop for a tool, oldest first, one that waits on a delegate included", () => {
	const root = rootOf([
		said("Reading the code.", "toolUse"),
		said("Started the reviewer, waiting on it.", "stop"),
		work("delegate-started", "delegate-1"),
		said("The reviewer says ship it.", "stop"),
	]);

	expect(turnEnds(root)).toEqual(["Started the reviewer, waiting on it.", "The reviewer says ship it."]);
});

test("the root's reply counts only once every job it started has settled and no owned-work entry follows it", () => {
	const started = work("delegate-started", "delegate-1");
	const settled = work("job-settled", "delegate-1");

	const replies = [
		rootOf([started, said("Waiting on the reviewer.", "stop")]),
		rootOf([started, said("Waiting on the reviewer.", "stop"), settled]),
		rootOf([started, said("Waiting on the reviewer.", "stop"), settled, said("Ship it.", "stop")]),
	];

	expect(Arr.map(replies, settledReply)).toEqual([Option.none(), Option.none(), Option.some("Ship it.")]);
});

test("a guide's longest body line leaves its frontmatter out", () => {
	const guide = `---
name: a-name-longer-than-any-line-of-the-body-below-it
---
# Swarm
Fan out parallel workers.
Done.
`;

	expect(longestBodyLine(guide)).toBe("Fan out parallel workers.");
});

test("once a look finds a build file edited, the run is judged on the sessions read before that edit", () => {
	const beforeEdit = holding("read the request");
	const afterEdit = holding("read the request, edited cyclefare/pricing.py, then read the architect skill");

	const watching = watch({
		beforeRequest: holding("nothing yet"),
		sessions: oneAtATime([beforeEdit, afterEdit]),
		files: oneAtATime([["README.md"], ["README.md", "cyclefare/pricing.py"]]),
		stopAt: Str.startsWith("cyclefare/"),
	});

	return Effect.runPromise(
		Effect.map(watching, (watched) => {
			expect(watched).toEqual({ sessions: beforeEdit, editedFiles: ["README.md", "cyclefare/pricing.py"] });
		}),
	);
});

test("the sessions a run is judged on never show the edit that stopped it, however the agent's steps fall between reads", () => {
	const actions = [
		{ request: "read the request", edited: [] },
		{ request: "edited cyclefare/pricing.py", edited: ["cyclefare/pricing.py"] },
		{ request: "read the architect skill", edited: [] },
		{ request: "edited cyclefare/rates.py", edited: ["cyclefare/rates.py"] },
	];

	let taken = 0;

	const act = Effect.sync(() => {
		taken += 1;

		return Arr.take(actions, taken);
	});

	const watching = watch({
		beforeRequest: holding(),
		sessions: Effect.map(act, (done) => holding(...Arr.map(done, ({ request }) => request))),
		files: Effect.map(act, (done) => Arr.flatMap(done, ({ edited }) => edited)),
		stopAt: Str.startsWith("cyclefare/"),
	});

	return Effect.runPromise(
		Effect.map(watching, ({ sessions }) => {
			expect(Arr.filter(sessions.root.requests, Str.startsWith("edited"))).toEqual([]);
		}),
	);
});

test("a run whose root settles is judged on the sessions it settled in", () => {
	const working = { root: rootOf([said("Reading the code.", "toolUse")]), delegates: [] };
	const settled = { root: rootOf([said("Reading the code.", "toolUse"), said("Done.", "stop")]), delegates: [] };

	const watching = watch({
		beforeRequest: holding(),
		sessions: oneAtATime([working, settled]),
		files: oneAtATime([[], []]),
		stopAt: () => true,
	});

	return Effect.runPromise(
		Effect.map(watching, (watched) => {
			expect(watched).toEqual({ sessions: settled, editedFiles: [] });
		}),
	);
});
