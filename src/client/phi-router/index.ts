import type { SlashCommandInfo } from "@earendil-works/pi-coding-agent";
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as Str from "effect/String";

export class PhiRouterError extends Schema.TaggedError<PhiRouterError, { readonly brand: unique symbol }>()(
	"PhiRouterError",
	{ args: Schema.Array(Schema.String), why: Schema.String },
) {}

/** The sessions phi-router holds, asked through its `phi-router` command. */
export class PhiRouter extends Context.Service<
	PhiRouter,
	{
		/** Whether the router keeps the session pinned, so every request of it goes to a BAA account. */
		readonly pinned: (session: string) => Effect.Effect<boolean, PhiRouterError>;
		/** Pins the session, and returns once the router stored the pin. */
		readonly pin: (session: string) => Effect.Effect<void, PhiRouterError>;
	}
>()("pi-harness/client/phi-router/PhiRouter") {}

/** The command phi-router's pi package adds. */
const phiCommand = "phi";

/**
 * The file of the extension that added `/phi`, which is phi-router's pi package: `plugins/pi/extension.mjs` of a
 * phi-router checkout. A delegate loads the same file.
 */
export const routerExtensionOf = (commands: ReadonlyArray<SlashCommandInfo>) =>
	Option.map(
		Arr.findFirst(commands, ({ name, source }) => name === phiCommand && source === "extension"),
		({ sourceInfo }) => sourceInfo.path,
	);

/** The package's launcher, `plugins/claude/bin/phi-router`, beside the extension's `plugins/pi/`. */
const launcherOf = (extension: string) => `${Str.replace(/\/[^/]*$/u, "")(extension)}/../claude/bin/phi-router`;

const text = <Failure>(stream: Stream.Stream<Uint8Array, Failure>) => stream.pipe(Stream.decodeText, Stream.mkString);

const Status = Schema.fromJsonString(Schema.Struct({ pinned: Schema.Boolean }));

const decodeStatus = Schema.decodeUnknownEffect(Status);

interface Located {
	readonly extension: Option.Option<string>;
	readonly env: Readonly<Record<string, string | undefined>>;
}

/**
 * The router of the package at `extension`, on the port its pi package uses: `PHI_ROUTER_PORT` when set, else the
 * router's own default. With no package loaded, every question fails.
 */
export const phiRouterLayer = ({ extension, env }: Located) =>
	Layer.effect(
		PhiRouter,
		Effect.map(ChildProcessSpawner.ChildProcessSpawner, (spawner) => {
			const port = Option.match(Option.fromUndefinedOr(env["PHI_ROUTER_PORT"]), {
				onNone: () => [],
				onSome: (given) => ["--port", given],
			});

			const output = (verb: string, session: string) => {
				const args = [verb, "--session", session, ...port];
				const failed = (why: string) => PhiRouterError.make({ args: ["phi-router", ...args], why });

				if (Option.isNone(extension)) {
					return Effect.fail(failed("phi-router's pi package is not loaded, so no extension added /phi"));
				}

				return spawner.spawn(ChildProcess.make(launcherOf(extension.value), args, { stdin: "ignore" })).pipe(
					Effect.flatMap((handle) =>
						Effect.all(
							{ code: handle.exitCode, stdout: text(handle.stdout), stderr: text(handle.stderr) },
							{ concurrency: 3 },
						),
					),
					Effect.scoped,
					Effect.mapError((error) => failed(error.message)),
					Effect.filterOrFail(
						({ code }) => code === 0,
						({ stderr }) => failed(Str.trim(stderr)),
					),
					Effect.map(({ stdout }) => stdout),
				);
			};

			return PhiRouter.of({
				pinned: (session) =>
					Effect.flatMap(output("status", session), (stdout) =>
						Effect.mapBoth(decodeStatus(Str.trim(stdout)), {
							onFailure: (error) => PhiRouterError.make({ args: ["phi-router", "status"], why: error.message }),
							onSuccess: ({ pinned }) => pinned,
						}),
					),
				pin: (session) => Effect.asVoid(output("pin", session)),
			});
		}),
	);
