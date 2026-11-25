import { type JsonValue, uuidv7 } from "@earendil-works/pi-ai";
import {
	defineTool,
	type ExtensionAPI,
	type ExtensionContext,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type * as NodeServices from "@effect/platform-node/NodeServices";
import * as Arr from "effect/Array";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type { Static } from "typebox";

import { type BriefSources, briefSourcesLayer } from "#src/client/brief-sources/index.ts";
import { type Gh, ghLayer } from "#src/client/github/index.ts";
import { makeSessionFolder, type PiHost, readStagedBrief, type SessionAddress } from "#src/client/pi/index.ts";
import { type ClaudeUsage, claudeUsageFetchLayer, PhiRouter } from "#src/client/providers/index.ts";
import { type Caller, type DelegateParams, delegateParams, parseCall } from "./brief.ts";
import { type ChildRole, type ChildSession, childRoles, Self } from "./child.ts";
import { freshCall, parseContinuation } from "./continuation.ts";
import { Ledger, type LedgerFailure } from "./ledger.ts";
import { modelNameOf, modelOf, type ModelTable, modelTable } from "./models.ts";
import { HandleOut, Out, ResultsOut } from "./out.ts";
import {
	delegateGuidelines,
	GroupParams,
	type HandleRef,
	lastLevelGuideline,
	ownerGuidelines,
	promptGuidelines,
	RefsParams,
	ServeParams,
	WaitParams,
	WatchParams,
	waitTimeout,
} from "./params.ts";
import { stdoutRedirectOf } from "./redirect.ts";
import { withReview } from "./review/index.ts";
import { Waiting } from "./waiting.ts";
import { BadDelegate, StartRequest, WorkRef } from "./work.ts";

const resultOf = (json: JsonValue, isError: boolean) =>
	Effect.map(Out.text(json), (text) => ({
		content: [{ type: "text" as const, text }],
		details: json,
		structuredContent: json,
		isError,
	}));

type CallServices = ToolServices | NodeServices.NodeServices;

type Runtime = PiHost<Ledger | CallServices, never>;

type Call<Reply> = (
	ledger: (typeof Ledger)["Service"],
) => Effect.Effect<Reply, LedgerFailure | BadDelegate, CallServices>;

const runTool =
	(runtime: Runtime, signal: AbortSignal | undefined) =>
	<Reply>(call: Call<Reply>, render: (reply: Reply) => JsonValue) => {
		const tool = Effect.matchEffect(Effect.flatMap(Ledger, call), {
			onFailure: (error) => resultOf(Out.error(error), true),
			onSuccess: (reply) => resultOf(render(reply), false),
		});

		return runtime.run(tool, { signal });
	};

const refsOf = (of: ReadonlyArray<Static<typeof HandleRef>>) => Arr.map(of, ({ ref }) => WorkRef(ref));

type OwnSession = Pick<SessionAddress, "dir" | "id">;

const ownBrief = (ownSession: Option.Option<OwnSession>) =>
	Effect.transposeOption(
		Option.map(ownSession, (session) =>
			Effect.mapError(readStagedBrief(session), ({ file, why }) =>
				BadDelegate.make({ why: `cannot read your own brief ${file}: ${why}` }),
			),
		),
	);

/** When its parent is held, the delegate's session is pinned in phi-router before its first request. */
const pinnedFirst = (pin: boolean, session: string) =>
	pin
		? Effect.flatMap(PhiRouter, (router) =>
				Effect.mapError(router.pin(session), ({ why }) =>
					BadDelegate.make({ why: `phi-router did not pin the delegate's session: ${why}` }),
				),
			)
		: Effect.void;

/** Runs a settled delegate again in its own session, on the model the PHI gate allows for its brief's model now. */
const relaunched = Effect.fn("relaunched")(function* ({
	ledger,
	ctx,
	table,
	ref,
	call,
}: {
	readonly ledger: (typeof Ledger)["Service"];
	readonly ctx: Caller;
	readonly table: ModelTable;
	readonly ref: string;
	readonly call: Static<DelegateParams>;
}) {
	const request = yield* parseContinuation(ref, call);
	const continuation = yield* ledger.continuation(request);
	const { model, substitution, pin } = yield* modelOf(ctx, table, modelNameOf(continuation.brief.model));

	yield* pinnedFirst(pin, continuation.childSession.id);

	const handle = yield* ledger.start({ ...continuation, brief: { ...continuation.brief, model } });

	return { handle, substitution };
});

const delegateTool = (
	runtime: Runtime,
	roles: ReadonlyArray<ChildRole>,
	place: Omit<ChildSession, "id">,
	table: ModelTable,
	ownSession: Option.Option<OwnSession>,
) => {
	const parameters = delegateParams({ table, roles });

	return {
		name: "delegate",
		label: "delegate",
		description: "Start a delegate on one task. It wakes you with its answer.",
		promptGuidelines: [
			...delegateGuidelines,
			...(Arr.contains(roles, "owner") ? ownerGuidelines : [lastLevelGuideline]),
		],
		parameters,
		outputSchema: HandleOut,
		execute: (_id, call, signal, _update, ctx: Caller) =>
			runTool(runtime, signal)(
				(ledger) =>
					Effect.gen(function* () {
						if (call.continues !== undefined) {
							return yield* relaunched({ ledger, ctx, table, ref: call.continues, call });
						}

						const fresh = yield* freshCall(call);
						const inherited = yield* ownBrief(ownSession);
						const { brief, cwd, substitution, pin } = yield* parseCall(ctx, table, roles, inherited, fresh);
						const reviewed = yield* withReview(fresh.reviews)(brief);
						const childSession = { ...place, cwd: Option.getOrElse(cwd, () => place.cwd), id: uuidv7() };

						yield* pinnedFirst(pin, childSession.id);

						const handle = yield* ledger.start(
							StartRequest.Delegate({
								brief: reviewed,
								childSession,
								group: Option.fromUndefinedOr(call.group),
							}),
						);

						return { handle, substitution };
					}),
				Out.delegated,
			),
	} satisfies ToolDefinition<DelegateParams, JsonValue>;
};

const serveTool = (runtime: Runtime) =>
	({
		name: "serve",
		label: "serve",
		description:
			"Start a long-running command, such as a dev server. It runs until you cancel it, or until the group holding it settles. Its pane is the human's live view of the command.",
		promptGuidelines,
		parameters: ServeParams,
		outputSchema: HandleOut,
		execute: (_id, { name, command, ready }, signal) =>
			runTool(runtime, signal)(
				(ledger) => ledger.start(StartRequest.Serve({ name, command, ready: Option.fromUndefinedOr(ready) })),
				(handle) => Out.command({ handle, redirect: stdoutRedirectOf(command) }),
			),
	}) satisfies ToolDefinition<typeof ServeParams, JsonValue>;

/** A watch's log sits beside the delegate sessions of the session that started it, and stays as long as they do. */
const watchTool = (runtime: Runtime, place: Omit<ChildSession, "id">) =>
	({
		name: "watch",
		label: "watch",
		description:
			"Start a command that wakes you once it exits, with its exit code, last lines, and log path. Copy the log after the wake when you need it as evidence. Its pane is the human's live view of the command.",
		parameters: WatchParams,
		outputSchema: HandleOut,
		execute: (_id, { name, command, deadline }, signal) => {
			const after = Option.map(Option.fromUndefinedOr(deadline), Duration.seconds);
			const request = StartRequest.Watch({ name, command, deadline: after, log: `${place.dir}/${uuidv7()}.log` });

			return runTool(runtime, signal)(
				(ledger) => Effect.andThen(makeSessionFolder(place.dir), ledger.start(request)),
				(handle) => Out.command({ handle, redirect: stdoutRedirectOf(command) }),
			);
		},
	}) satisfies ToolDefinition<typeof WatchParams, JsonValue>;

const groupTool = (runtime: Runtime) =>
	defineTool({
		name: "group",
		label: "group",
		description: "Move work you hold into one group, which wakes you instead of its members.",
		parameters: GroupParams,
		outputSchema: HandleOut,
		execute: (_id, { name, of }, signal) =>
			runTool(runtime, signal)((ledger) => ledger.group({ name, members: refsOf(of) }), Out.handle),
	});

const cancelTool = (runtime: Runtime) =>
	defineTool({
		name: "cancel",
		label: "cancel",
		description:
			"Cancel work and everything a group holds, killing its processes. Returns results not yet woken to you.",
		parameters: RefsParams,
		outputSchema: ResultsOut,
		execute: (_id, { of }, signal) =>
			runTool(runtime, signal)(
				(ledger) => ledger.cancel(refsOf(of)),
				(results) => ({ results: Arr.map(results, Out.result) }),
			),
	});

const waitTool = (runtime: Runtime) =>
	({
		name: "wait",
		label: "wait",
		description:
			"Wait in this turn for jobs you hold to settle. Each result comes back in the reply as its wake would bring it, and does not wake you again. It returns at once when a result already waits or nothing you hold runs, early when the human sends a message or presses Escape, and on timeout with the jobs that still run.",
		exposure: "model-only",
		parameters: WaitParams,
		execute: (_id, { of, timeout }, signal, _update, ctx: Pick<ExtensionContext, "hasPendingMessages">) => {
			const scope = Option.map(Option.fromUndefinedOr(of), refsOf);
			const stop = Waiting.stop({ after: Duration.seconds(timeout ?? waitTimeout.default), signal, ctx });

			const tool = Effect.flatMap(Ledger, (ledger) => ledger.wait(scope, stop)).pipe(
				Effect.matchEffect({
					onFailure: (error) => resultOf(Out.error(error), true),
					onSuccess: (waited) => Waiting.reply(waited, ctx.hasPendingMessages()),
				}),
			);

			return runtime.run(tool);
		},
	}) satisfies ToolDefinition<typeof WaitParams, JsonValue>;

const register = (
	pi: Pick<ExtensionAPI, "registerTool">,
	runtime: Runtime,
	self: Self,
	place: Omit<ChildSession, "id">,
	session: Pick<ExtensionContext["sessionManager"], "getSessionDir" | "getSessionId">,
) => {
	pi.registerTool(serveTool(runtime));
	pi.registerTool(watchTool(runtime, place));
	pi.registerTool(groupTool(runtime));
	pi.registerTool(cancelTool(runtime));
	pi.registerTool(waitTool(runtime));

	const roles = childRoles(self);

	if (Arr.isReadonlyArrayNonEmpty(roles)) {
		const ownSession = Self.$is("Delegate")(self)
			? Option.some({ dir: session.getSessionDir(), id: session.getSessionId() })
			: Option.none();

		pi.registerTool(delegateTool(runtime, roles, place, modelTable, ownSession));
	}
};

export type ToolServices = Gh | BriefSources | PhiRouter | ClaudeUsage;

export const Tools = {
	register,
	delegate: delegateTool,
	serve: serveTool,
	watch: watchTool,
	wait: waitTool,
	layer: Layer.mergeAll(ghLayer, briefSourcesLayer, claudeUsageFetchLayer),
};
