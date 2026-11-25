import { expect, test } from "bun:test";

import { type SessionBeforeForkEvent, SessionManager } from "@earendil-works/pi-coding-agent";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import { piHost, PiSessions } from "#src/client/pi/index.ts";
import { Hc, herdrAppLayer, type RunSpec, TerminalAddress } from "#src/client/terminals/index.ts";
import { assistantReply } from "#src/primitives/assistant-reply.fixture.ts";
import { forkInTab, forkPlanOf, restoreDraft } from "./fork.ts";

const conversation = () => {
	const session = SessionManager.inMemory("/p");

	session.appendModelChange("anthropic", "claude-opus-5-5");

	const first = session.appendMessage({ role: "user", content: "Find the bug.", timestamp: 0 });

	const reply = session.appendMessage(assistantReply({ text: "It is in the parser." }));

	const second = session.appendMessage({ role: "user", content: [{ type: "text", text: "Fix it." }], timestamp: 0 });

	return { session, first, reply, second };
};

test("/clone keeps the whole path to the entry and puts nothing in the editor", () => {
	const { session, second } = conversation();

	expect(forkPlanOf(session)({ entryId: second, position: "at" })).toEqual(
		Option.some({ leaf: Option.some(second), draft: Option.none() }),
	);
});

test("/fork on a later prompt keeps the path before it and puts the prompt back in the editor", () => {
	const { session, reply, second } = conversation();

	expect(forkPlanOf(session)({ entryId: second, position: "before" })).toEqual(
		Option.some({ leaf: Option.some(reply), draft: Option.some("Fix it.") }),
	);
});

test("/fork on the first prompt starts a fresh session, since the path before it holds no message", () => {
	const { session, first } = conversation();

	expect(forkPlanOf(session)({ entryId: first, position: "before" })).toEqual(
		Option.some({ leaf: Option.none(), draft: Option.some("Find the bug.") }),
	);
});

test("/fork on an entry that is not a prompt leaves the fork to pi", () => {
	const { session, reply } = conversation();

	expect(forkPlanOf(session)({ entryId: reply, position: "before" })).toEqual(Option.none());
});

interface Tab {
	readonly mode: "tui" | "print";
	readonly ownTerminal: Option.Option<TerminalAddress>;
	readonly labels: Readonly<Record<string, string>>;
	readonly sessionFile: string | undefined;
	readonly focusesBeforeShown: number;
}

const herdrAppTab: Tab = {
	mode: "tui",
	ownTerminal: Option.some(TerminalAddress("t1")),
	labels: { "herdr.space": "s1" },
	sessionFile: "/s/source.jsonl",
	focusesBeforeShown: 0,
};

const forked = (tab: Tab) => {
	const { session, reply, second } = conversation();
	const opened: Array<Omit<RunSpec, "ref">> = [];
	const branchedAt: Array<string> = [];
	const notes: Array<string> = [];
	const focus = { tries: 0 };

	const hc = Layer.mock(Hc)({
		labelsOf: () => Effect.succeed(tab.labels),
		open: (spec) =>
			Effect.sync(() => {
				opened.push(spec);

				return TerminalAddress("t2");
			}),
	});

	const sessions = Layer.mock(PiSessions)({
		branch: ({ leaf }) =>
			Effect.sync(() => {
				branchedAt.push(leaf);

				return "/s/fork.jsonl";
			}),
	});

	const herdrAppCommands = Layer.effect(
		ChildProcessSpawner.ChildProcessSpawner,
		Effect.map(ChildProcessSpawner.ChildProcessSpawner, (real) =>
			ChildProcessSpawner.make(() =>
				Effect.suspend(() => {
					focus.tries += 1;

					const code = focus.tries > tab.focusesBeforeShown ? 0 : 1;

					return real.spawn(ChildProcess.make("sh", ["-c", `exit ${String(code)}`]));
				}),
			),
		),
	);

	const herdrApp = Layer.provide(herdrAppLayer, Layer.provideMerge(herdrAppCommands, NodeServices.layer));

	const ctx = {
		mode: tab.mode,
		cwd: "/w",
		ui: {
			notify: (text: string) => {
				notes.push(text);
			},
		},
		sessionManager: {
			getEntry: (id: string) => session.getEntry(id),
			getBranch: (id?: string) => session.getBranch(id),
			getSessionDir: () => "/s",
			getSessionFile: () => tab.sessionFile,
		},
	};

	const event: SessionBeforeForkEvent = { type: "session_before_fork", entryId: second, position: "before" };
	const fork = forkInTab({ event, ctx, ownTerminal: tab.ownTerminal, env: { HOME: "/h" } });

	const seen = Effect.map(fork, (inTab) => ({
		inTab,
		branchedAt: Arr.map(branchedAt, (leaf) => (leaf === reply ? "the reply before the prompt" : leaf)),
		opened: Arr.map(opened, ({ labels, argv, cwd }) => ({ labels, argv, cwd })),
		focusTries: focus.tries,
		notes,
	}));

	return Effect.promise(() =>
		piHost(Layer.mergeAll(hc, sessions, herdrApp)).run(Effect.zip(seen, Effect.succeed(opened))),
	);
};

test("/fork in a herdr-app tab opens pi on the branched session in a new tab of the same space, and focuses it", () =>
	Effect.runPromise(
		Effect.map(forked(herdrAppTab), ([seen]) => {
			expect(seen).toEqual({
				inTab: true,
				branchedAt: ["the reply before the prompt"],
				opened: [{ labels: { "herdr.space": "s1" }, argv: ["pi", "--session", "/s/fork.jsonl"], cwd: "/w" }],
				focusTries: 1,
				notes: ["Opened the fork in a new tab (t2)."],
			});
		}),
	));

test("a fork tab that herdr-app shows only after a few tries is still focused", () =>
	Effect.runPromise(
		Effect.map(forked({ ...herdrAppTab, focusesBeforeShown: 3 }), ([seen]) => {
			expect({ focusTries: seen.focusTries, notes: seen.notes }).toEqual({
				focusTries: 4,
				notes: ["Opened the fork in a new tab (t2)."],
			});
		}),
	));

test("the fork's pi puts the /fork prompt back in its editor when it starts, and not when it reloads", () =>
	Effect.runPromise(
		Effect.map(forked(herdrAppTab), ([, opened]) => {
			const drafts: Array<string> = [];

			const ctx = {
				hasUI: true,
				ui: {
					setEditorText: (text: string) => {
						drafts.push(text);
					},
				},
			};

			Arr.forEach(opened, ({ env }) => {
				restoreDraft({ event: { reason: "startup" }, ctx, env });
				restoreDraft({ event: { reason: "reload" }, ctx, env });
			});

			expect(drafts).toEqual(["Fix it."]);
		}),
	));

test.each([
	{ name: "a pi in no hc terminal", tab: { ...herdrAppTab, ownTerminal: Option.none() } },
	{ name: "a terminal in no herdr-app space", tab: { ...herdrAppTab, labels: {} } },
	{ name: "a session with no file", tab: { ...herdrAppTab, sessionFile: undefined } },
	{ name: "a pi with no tui", tab: { ...herdrAppTab, mode: "print" as const } },
])("$name leaves /fork to pi and opens no tab", ({ tab }) =>
	Effect.runPromise(
		Effect.map(forked(tab), ([seen]) => {
			expect({ inTab: seen.inTab, opened: seen.opened }).toEqual({ inTab: false, opened: [] });
		}),
	),
);
