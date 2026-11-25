import { uuidv7 } from "@earendil-works/pi-ai";
import type {
	AgentBeforeSettleEvent,
	ExtensionAPI,
	ExtensionContext,
	InputEvent,
	SessionBeforeForkEvent,
	SessionBeforeSwitchEvent,
	SessionShutdownEvent,
	SessionStartEvent,
} from "@earendil-works/pi-coding-agent";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Arr from "effect/Array";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Str from "effect/String";

import {
	type PiCli,
	piCliLayer,
	type PiHost,
	piHost,
	type PiSessions,
	piSessionsLayer,
	unwrapMessage,
} from "#src/client/pi/index.ts";
import { phiRouterLayer, routerExtensionOf } from "#src/client/providers/index.ts";
import { sourceStampLayer } from "#src/client/source-stamp/index.ts";
import {
	type Hc,
	hcLayer,
	type HerdrApp,
	herdrAppLayer,
	type Slices,
	slicesLayer,
	TerminalAddress,
} from "#src/client/terminals/index.ts";
import { inheritedEnv, Self, selfFromEnv, withAgentBin } from "#src/features/owned-work/child.ts";
import { Ledger, ledgerLayer } from "#src/features/owned-work/ledger/index.ts";
import { firstRefAfter } from "#src/features/owned-work/recorded.ts";
import type { Settled } from "#src/features/owned-work/work.ts";
import { forkInTab, restoreDraft } from "./fork.ts";
import * as Handover from "./handover.ts";
import { hostLayer, messageOf, type Relay } from "./host.ts";
import { Tools, type ToolServices } from "./tools.ts";

type RuntimeServices = Ledger | ToolServices | Hc | Slices | PiCli | PiSessions | HerdrApp | NodeServices.NodeServices;

interface Session {
	readonly host: PiHost<RuntimeServices, never>;
	readonly lineage: Handover.Lineage;
	readonly relay: Relay;
	/** The hc terminal pi runs in, when it runs in one. */
	readonly terminal: Option.Option<TerminalAddress>;
	readonly passEnv: Readonly<Record<string, string>>;
}

type Env = Readonly<Record<string, string | undefined>>;

interface Parts {
	readonly agentKey: string;
	readonly parent: Option.Option<TerminalAddress>;
	readonly relay: Relay;
	readonly slices: ReturnType<typeof slicesLayer>;
}

/** What a session's work runs on. Each delegate loads phi-router's pi package when this session has it. */
const servicesOf = (pi: ExtensionAPI, parts: Pick<Start, "childExtensions" | "env"> & Parts) => {
	const router = routerExtensionOf(pi.getCommands());
	const cli = piCliLayer([...parts.childExtensions, ...Option.toArray(router)]);
	const tools = Layer.merge(Tools.layer, phiRouterLayer({ extension: router, env: parts.env }));
	const hc = hcLayer({ agentKey: parts.agentKey, parent: parts.parent });
	const host = hostLayer({ pi, relay: parts.relay });
	const own = Layer.mergeAll(hc, host, parts.slices, piSessionsLayer, cli, herdrAppLayer);

	return Layer.provideMerge(own, Layer.provideMerge(tools, NodeServices.layer));
};

const runtimeOf = (pi: ExtensionAPI, { ctx, env, childExtensions, inheritance, stamp, sliceOf }: Start, self: Self) => {
	const { agentKey } = inheritance;
	const parent = Option.map(Option.fromUndefinedOr(env["HC_TERMINAL_ID"]), TerminalAddress);
	const relay: Relay = { waiter: Option.none() };
	const firstRef = firstRefAfter(ctx.sessionManager.getEntries());
	const passEnv = inheritedEnv(env);
	const ledger = ledgerLayer({ self, cwd: ctx.cwd, passEnv, firstRef, carried: Handover.stateOf(inheritance) });

	const slices = Self.$is("Root")(self)
		? slicesLayer({ slice: sliceOf(agentKey), rootPid: Option.some(process.pid) })
		: slicesLayer({ slice: self.slice, rootPid: Option.none() });

	const services = servicesOf(pi, { agentKey, parent, relay, slices, childExtensions, env });
	const host = piHost(Layer.provideMerge(ledger, services));

	return { host, lineage: { agentKey, stamp }, relay, terminal: parent, passEnv };
};

/**
 * Under --no-session pi's session folder is "", so a root's delegates keep their sessions in a temp folder whose name
 * nobody can guess ahead of time. It is made, owner-only, when the first delegate starts.
 */
export const delegatesDirOf = ({ sessionDir, tmpDir }: { readonly sessionDir: string; readonly tmpDir: string }) =>
	sessionDir === "" ? `${tmpDir}/pi-delegates-${uuidv7()}` : `${sessionDir}/delegates`;

const placeOf = (self: Self, ctx: ExtensionContext, env: Env) => {
	const sessionDir = ctx.sessionManager.getSessionDir();
	const tmpDir = Option.getOrElse(Option.filter(Option.fromUndefinedOr(env["TMPDIR"]), Str.isNonEmpty), () => "/tmp");

	return { cwd: ctx.cwd, dir: Self.$is("Root")(self) ? delegatesDirOf({ sessionDir, tmpDir }) : sessionDir };
};

interface Start {
	readonly ctx: ExtensionContext;
	readonly env: Env;
	readonly childExtensions: ReadonlyArray<string>;
	readonly inheritance: Handover.Inheritance;
	readonly stamp: number;
	readonly sliceOf: (agentKey: string) => string;
}

const sessionOf = (pi: ExtensionAPI, start: Start) =>
	Effect.map(selfFromEnv(start.env), (self): Session => {
		const { ctx, env } = start;
		const session = runtimeOf(pi, start, self);

		Tools.register(pi, session.host, self, placeOf(self, ctx, env), ctx.sessionManager);

		return session;
	});

/** Both modes run pi's `print-mode.js`, which exits once the prompt resolves. */
export const exitsWhenPromptResolves = (mode: ExtensionContext["mode"]): boolean => mode === "print" || mode === "json";

const continued = (event: AgentBeforeSettleEvent, results: ReadonlyArray<Settled>) =>
	Effect.map(Effect.forEach(results, messageOf), (messages) => ({
		entries: [...event.entries, ...Arr.map(messages, (message) => ({ type: "custom_message" as const, ...message }))],
		continue: true,
	}));

const awaitResults = (ledger: (typeof Ledger)["Service"], relay: Relay) =>
	Effect.gen(function* () {
		const waiter = yield* Deferred.make<ReadonlyArray<Settled>>();

		relay.waiter = Option.some(waiter);
		yield* ledger.wentIdle;

		return yield* Deferred.await(waiter);
	});

const settle =
	(session: Session, event: AgentBeforeSettleEvent, ctx: ExtensionContext) => (ledger: (typeof Ledger)["Service"]) =>
		Effect.flatMap(ledger.turnEnded, (verdict) =>
			Match.valueTags(verdict, {
				Continue: ({ results }) => continued(event, results),
				Idle: ({ outstanding }) =>
					exitsWhenPromptResolves(ctx.mode) && Arr.isReadonlyArrayNonEmpty(outstanding)
						? Effect.flatMap(awaitResults(ledger, session.relay), (results) => continued(event, results))
						: Effect.void,
				Finish: () =>
					Effect.sync(() => {
						ctx.shutdown();
					}),
			}),
		);

/** True when nothing runs, or the person agrees to stop what does, since leaving this session stops its work. */
const mayStopRunning = (ledger: (typeof Ledger)["Service"], ctx: ExtensionContext) =>
	Effect.flatMap(ledger.running, (refs) =>
		Arr.isReadonlyArrayNonEmpty(refs) && ctx.hasUI
			? Effect.promise(() =>
					ctx.ui.confirm(
						"Stop running work?",
						`${Arr.join(refs, ", ")} still run. Leaving this session stops them.`,
					),
				)
			: Effect.succeed(true),
	);

const cancelUnless = (ledger: (typeof Ledger)["Service"], ctx: ExtensionContext) =>
	Effect.map(mayStopRunning(ledger, ctx), (agreed) => (agreed ? {} : { cancel: true }));

const forkOrAsk =
	(session: Session, event: SessionBeforeForkEvent, ctx: ExtensionContext) => (ledger: (typeof Ledger)["Service"]) =>
		Effect.flatMap(forkInTab({ event, ctx, terminal: session.terminal, env: session.passEnv }), (opened) =>
			opened ? Effect.succeed({ cancel: true }) : cancelUnless(ledger, ctx),
		);

export const awaitOn =
	<Services>(host: PiHost<Services, never>) =>
	<Reply>(hook: Effect.Effect<Reply, never, Services>): Effect.Effect<Reply | undefined> =>
		Effect.suspend(() => Fiber.await(host.fork(hook))).pipe(
			Effect.flatMap((exit) =>
				Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause) ? Effect.undefined : exit,
			),
		);

interface Current {
	session: Option.Option<Session>;
}

const begin =
	(pi: ExtensionAPI, env: Env, childExtensions: ReadonlyArray<string>, current: Current) =>
	(event: SessionStartEvent, ctx: ExtensionContext) =>
		Effect.gen(function* () {
			const stamp = yield* Handover.ledgerStamp;
			const sliceOf = yield* Handover.rootSlices;
			const lineage = { stamp, agentKey: Handover.newAgentKey() };
			const inheritance = Handover.inheritanceOf(lineage)(event.reason, Handover.take());
			const session = yield* sessionOf(pi, { ctx, env, childExtensions, inheritance, stamp, sliceOf });

			current.session = Option.some(session);
			restoreDraft({ event, ctx, env });
			yield* awaitOn(session.host)(Handover.stopStale({ ui: ctx.ui, sliceOf })(inheritance));
		});

/** Forgets the session before it stops, so no hook reaches a ledger that froze for a reload. */
const end = (current: Current) => (event: SessionShutdownEvent) => {
	const ending = current.session;

	current.session = Option.none();

	return Option.match(ending, {
		onNone: () => Effect.void,
		onSome: (session) =>
			Effect.andThen(
				awaitOn(session.host)(Handover.leave(session.lineage)(event)),
				Effect.promise(() => session.host.dispose()),
			),
	});
};

/** `childExtensions` are the entrypoints each delegate loads: this feature's own, plus any the harness wants in every child. */
export const ownedWork =
	(childExtensions: ReadonlyArray<string>) => (agentDir: string, processEnv: Env) => (pi: ExtensionAPI) => {
		const env = withAgentBin(agentDir)(processEnv);
		const host = piHost(Layer.provideMerge(sourceStampLayer, NodeServices.layer));
		const current: Current = { session: Option.none() };

		const withLedger = <Reply>(
			use: (
				session: Session,
			) => (ledger: (typeof Ledger)["Service"]) => Effect.Effect<Reply, never, RuntimeServices>,
		) =>
			Option.match(current.session, {
				onNone: () => Promise.resolve(),
				onSome: (session) => {
					const hook = Effect.flatMap(Ledger, use(session));

					return host.run(awaitOn(session.host)(hook));
				},
			});

		return {
			sessionStart: (event: SessionStartEvent, ctx: ExtensionContext): Promise<void> =>
				host.run(begin(pi, env, childExtensions, current)(event, ctx)),
			input: ({ text }: InputEvent, ctx: ExtensionContext) => {
				const session = { dir: ctx.sessionManager.getSessionDir(), id: ctx.sessionManager.getSessionId() };

				return Option.match(unwrapMessage(session)(text), {
					onNone: () => ({ action: "continue" as const }),
					onSome: (message) => ({ action: "transform" as const, text: message }),
				});
			},
			agentStart: () => withLedger(() => (ledger) => ledger.runStarted),
			beforeSettle: (event: AgentBeforeSettleEvent, ctx: ExtensionContext) =>
				withLedger((session) => settle(session, event, ctx)),
			settled: () => withLedger(() => (ledger) => ledger.wentIdle),
			beforeSwitch: (_event: SessionBeforeSwitchEvent, ctx: ExtensionContext) =>
				withLedger(() => (ledger) => cancelUnless(ledger, ctx)),
			beforeFork: (event: SessionBeforeForkEvent, ctx: ExtensionContext) =>
				withLedger((session) => forkOrAsk(session, event, ctx)),
			shutdown: (event: SessionShutdownEvent): Promise<void> => host.run(end(current)(event)),
		};
	};
