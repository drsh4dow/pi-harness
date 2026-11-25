import type { SlashCommandInfo } from "@earendil-works/pi-coding-agent";
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";

import { stdoutOf } from "#src/client/child-process/index.ts";

export class PhiRouterError extends Schema.TaggedError<PhiRouterError, { readonly brand: unique symbol }>()(
	"PhiRouterError",
	{ args: Schema.Array(Schema.String), why: Schema.String },
) {}

export class PhiRouter extends Context.Service<
	PhiRouter,
	{
		readonly pinned: (session: string) => Effect.Effect<boolean, PhiRouterError>;
		readonly pin: (session: string) => Effect.Effect<void, PhiRouterError>;
	}
>()("pi-harness/client/providers/phi-router/PhiRouter") {}

const routerPackageCommand = "phi";

export const routerExtensionOf = (commands: ReadonlyArray<SlashCommandInfo>) =>
	Option.map(
		Arr.findFirst(commands, ({ name, source }) => name === routerPackageCommand && source === "extension"),
		({ sourceInfo }) => sourceInfo.path,
	);

const launcherOf = (extension: string) => `${Str.replace(/\/[^/]*$/u, "")(extension)}/../claude/bin/phi-router`;

const Status = Schema.fromJsonString(Schema.Struct({ pinned: Schema.Boolean }));

const decodeStatus = Schema.decodeUnknownEffect(Status);

interface Located {
	readonly extension: Option.Option<string>;
	readonly env: Readonly<Record<string, string | undefined>>;
}

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

				return stdoutOf({
					command: ChildProcess.make(launcherOf(extension.value), args, { stdin: "ignore" }),
					failed,
				}).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner));
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
