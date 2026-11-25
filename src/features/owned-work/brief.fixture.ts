import { beforeAll, expect } from "bun:test";

import type { Api, Model } from "@earendil-works/pi-ai";
import { getBuiltinModel } from "@earendil-works/pi-ai/providers/all";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Arr from "effect/Array";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Option from "effect/Option";
import * as Struct from "effect/Struct";
import type { Static } from "typebox";

import { briefSourcesLayer } from "#src/client/brief-sources/index.ts";
import { ClaudeUsage } from "#src/client/claude-usage/index.ts";
import { Gh, GhError } from "#src/client/gh/index.ts";
import { PhiRouter, PhiRouterError } from "#src/client/phi-router/index.ts";
import { type Design, piHost } from "#src/client/pi/index.ts";
import type { DelegateParams } from "./brief.ts";
import type { Brief, ChildRole } from "./child.ts";
import { continueMessage } from "./continuation.ts";
import { Ledger } from "./ledger.ts";
import { Tools } from "./tools.ts";
import { type ContinueRequest, type Handle, StartRequest, UnknownRef, WorkRef } from "./work.ts";

const luna = getBuiltinModel("openai", "gpt-6-luna");

const opus = getBuiltinModel("anthropic", "claude-opus-5-5");

export const proxied = { ...luna, provider: "proxy/openai" };

export const fixtures = `${Bun.env["TMPDIR"] ?? "/tmp"}/owned-work-tools-test-${String(process.pid)}`;

export const body = "Read it cold.";

const instructionFiles = {
	plain: body,
	profiled: `---\nmodel: deep\nthinking: low\nreadonly: true\nrole: leaf\n---\n${body}`,
	owned: `---\nrole: owner\n---\n${body}`,
	ruler: `---\nrole: root\n---\n${body}`,
	slow: `---\nthinking: low\n---\n${body}`,
	misspelt: `---\nread-only: true\n---\n${body}`,
	loud: `---\nthinking: loud\n---\n${body}`,
	unclosed: `---\nreadonly: true\n\n${body}`,
	late: `\n---\nreadonly: true\n---\n${body}`,
};

beforeAll(() =>
	Effect.runPromise(
		Effect.andThen(
			Effect.promise(() => Bun.$`mkdir -p ${fixtures}/work && ln -sfn work ${fixtures}/link`.quiet()),
			Effect.promise(() =>
				Promise.all(
					Arr.map(Struct.keys(instructionFiles), (name) =>
						Bun.write(`${fixtures}/${name}.md`, instructionFiles[name]),
					),
				),
			),
		),
	),
);

export const table = {
	aliases: {
		deep: { provider: "anthropic", id: "claude-opus-5-5", use: "work that needs taste" },
		quick: { provider: "openai", id: "gpt-6-luna", use: "mechanical scouting" },
		gone: { provider: "anthropic", id: "nope", use: "nothing" },
	},
	panel: ["deep", "proxy/openai/gpt-6-luna"],
};

interface Started {
	readonly brief: Brief;
	readonly cwd: string;
	readonly session: string;
}

export const started: Array<Started> = [];

export const continued: Array<ContinueRequest> = [];

const handle: Handle = {
	ref: WorkRef("delegate-1"),
	kind: "delegate",
	terminal: Option.none(),
	group: Option.none(),
	ready: Option.none(),
};

const settledOn = new Map([
	["delegate-1", "openai/gpt-6-luna"],
	["delegate-2", "ultra-a/claude-opus-5-5"],
	["delegate-3", "openai/gpt-6.1-sol"],
	["delegate-4", "opencode-go/glm-5.3-flash"],
]);

const ledger = Layer.mock(Ledger)({
	start: (request) =>
		Effect.sync(() => {
			if (StartRequest.$is("Delegate")(request)) {
				started.push({ brief: request.brief, cwd: request.childSession.cwd, session: request.childSession.id });
			}

			return handle;
		}),
	continuation: (request) =>
		Effect.mapBoth(Effect.fromNullishOr(settledOn.get(request.ref)), {
			onFailure: () => UnknownRef.make({ ref: request.ref }),
			onSuccess: (model) => {
				continued.push(request);

				return StartRequest.Delegate({
					brief: {
						name: "scout",
						role: "leaf",
						model,
						message: Option.getOrElse(request.message, () => continueMessage),
						goal: "Cap the retries.",
						readOnly: false,
						thinking: Option.none(),
						state: Option.none(),
						facts: Option.none(),
						destinationFile: Option.none(),
						sharedDocuments: [],
						instructions: Option.none(),
					},
					childSession: { id: request.ref, cwd: "/", dir: "/d" },
					group: request.group,
				});
			},
		}),
});

const home = ConfigProvider.layer(ConfigProvider.fromUnknown({ HOME: fixtures }));

export const pinned = { repo: "o/r", number: 7, head: "9c1e2a0aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", patchId: "6499691" };

const noPullRequest = (pr: string) =>
	Effect.fail(GhError.make({ args: ["gh", "pr", "view", pr], why: "no pull requests found" }));

const gh = Layer.succeed(
	Gh,
	Gh.of({
		view: (pr) =>
			pr === "7"
				? Effect.succeed({
						...pinned,
						ref: "o/r#7",
						url: "https://github.com/o/r/pull/7",
						reviewDecision: Option.none(),
						reviews: [],
						checks: "none",
						state: "OPEN",
					})
				: noPullRequest(pr),
		patchId: (pr) => (pr === "7" ? Effect.succeed(pinned.patchId) : noPullRequest(pr)),
		stackOf: noPullRequest,
	}),
);

/**
 * The sessions the fake phi-router holds pinned, the one it cannot answer about, and each session a delegate start had
 * it pin, in order.
 */
export const router = { held: new Set(["held-parent"]), unanswered: "lost-parent", pinned: new Array<string>() };

const phiRouter = Layer.succeed(
	PhiRouter,
	PhiRouter.of({
		pinned: (session) =>
			session === router.unanswered
				? Effect.fail(PhiRouterError.make({ args: ["phi-router", "status"], why: "connection refused" }))
				: Effect.succeed(router.held.has(session)),
		pin: (session) =>
			Effect.sync(() => {
				router.pinned.push(session);
			}),
	}),
);

const noMeters = Layer.mock(ClaudeUsage)({});

const services = Layer.mergeAll(
	Layer.provideMerge(briefSourcesLayer, NodeServices.layer),
	ledger,
	home,
	gh,
	phiRouter,
	noMeters,
);

export const runtime = ManagedRuntime.make(services);

export const host = piHost(services);

const delegateStarting = (roles: ReadonlyArray<ChildRole>) =>
	Tools.delegate(host, roles, { cwd: "/", dir: "/d" }, table, Option.none());

export const delegate = delegateStarting(["owner", "leaf"]);

const logins = new Map<string, string>();

/**
 * A real caller carries its own thinking level, which a delegate must never take. It has no login on any account, so a
 * delegate reads no meter and stays on its parent's account.
 */
export const callerOf = (
	getAll: () => ReadonlyArray<Model<Api>> = () => [luna, opus, proxied],
): Parameters<typeof delegate.execute>[4] => {
	const caller = {
		cwd: `${fixtures}/work`,
		model: opus,
		thinkingLevel: "low",
		modelRegistry: {
			getAll: () => [...getAll()],
			getApiKeyForProvider: (provider: string) => Promise.resolve(logins.get(provider)),
		},
		sessionManager: { getBranch: () => [], getSessionId: () => "parent" },
	};

	return caller;
};

interface Shown {
	readonly name: string;
	readonly role: ChildRole;
	readonly model: string;
	readonly thinking: string | undefined;
	readonly readOnly: boolean;
	readonly instructions: { readonly file: string; readonly text: string } | undefined;
	readonly design: Design | undefined;
	readonly cwd: string;
}

/** What a call with a name, a message, the leaf role and the `quick` alias alone starts. */
const plainStart: Shown = {
	name: "m",
	role: "leaf",
	model: "openai/gpt-6-luna",
	thinking: "high",
	readOnly: false,
	instructions: undefined,
	design: undefined,
	cwd: "/",
};

export const handed = (start: Partial<Shown> = {}) => ({
	isError: false,
	details: { ref: "delegate-1", kind: "delegate", next: "call wait, or end your turn and delegate-1 wakes you" },
	started: [{ ...plainStart, ...start }],
});

export const refused = (message: string) => ({
	isError: true,
	details: { error: "BadDelegate", message },
	started: [],
});

export const goal = "Cap the retries.";

export interface BriefRow {
	readonly name: string;
	readonly call: Static<DelegateParams>;
	readonly caller?: Partial<ReturnType<typeof callerOf>>;
	readonly roles?: ReadonlyArray<ChildRole>;
	readonly expect: ReturnType<typeof handed> | ReturnType<typeof refused>;
}

export const runBriefRow = (row: BriefRow) =>
	runtime.runPromise(
		Effect.gen(function* () {
			const caller = { ...callerOf(), ...row.caller };
			const tool = delegateStarting(row.roles ?? ["owner", "leaf"]);

			const { isError, details } = yield* Effect.promise(() =>
				tool.execute("call", { goal, ...row.call }, undefined, undefined, caller),
			);

			const shown = Arr.map(started.splice(0), ({ brief, cwd }) => ({
				name: brief.name,
				role: brief.role,
				model: brief.model,
				thinking: Option.getOrUndefined(brief.thinking),
				readOnly: brief.readOnly,
				instructions: Option.getOrUndefined(brief.instructions),
				design: brief.role === "owner" ? brief.design : undefined,
				cwd,
			}));

			expect({ isError, details, started: shown }).toEqual(row.expect);
		}),
	);
