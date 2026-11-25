import * as Arr from "effect/Array";
import * as Config from "effect/Config";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { checkSlotsFor, runCheck, runQueued } from "./run.ts";

const split = (args: ReadonlyArray<string>) => {
	const dashes = args.indexOf("--");
	const command = args.slice(dashes + 1);

	if (dashes === -1 || !Arr.isReadonlyArrayNonEmpty(command)) {
		return Option.none();
	}

	return Option.some({ options: args.slice(0, dashes), command });
};

const usage = (text: string) => Effect.as(Console.error(`usage: ${text}`), 2);

const reported =
	(what: string) =>
	<Failure extends { readonly message: string }, Services>(run: Effect.Effect<number, Failure, Services>) =>
		Effect.matchEffect(run, {
			onFailure: (error) => Effect.as(Console.error(`${what}: ${error.message}`), 1),
			onSuccess: Effect.succeed,
		});

const home = Config.String("HOME");

const checkSlots = Config.withDefault(Config.Int("PI_CHECK_SLOTS"), checkSlotsFor(navigator.hardwareConcurrency));

const checkOptions = new Set(["--nice", "--fresh"]);

export const checkCli = ({ args, cwd }: { readonly args: ReadonlyArray<string>; readonly cwd: string }) =>
	Effect.gen(function* () {
		const parsed = Option.filter(split(args), ({ options }) =>
			Arr.every(options, (option) => checkOptions.has(option)),
		);

		if (Option.isNone(parsed)) {
			return yield* usage("check [--nice] [--fresh] -- <command>...");
		}

		const { options, command } = parsed.value;
		const slots = yield* checkSlots;
		const homeFolder = yield* home;

		return yield* reported("check")(
			runCheck({
				command,
				cwd,
				home: homeFolder,
				slots,
				nice: options.includes("--nice"),
				fresh: options.includes("--fresh"),
			}),
		);
	});

const placesOf = (options: ReadonlyArray<string>) => {
	if (options.length === 0) {
		return Option.some(1);
	}

	const [flag, count] = options;
	const places = Number(count);

	return flag === "--places" && options.length === 2 && Number.isInteger(places) && places > 0
		? Option.some(places)
		: Option.none();
};

export const queueCli = ({ args, cwd }: { readonly args: ReadonlyArray<string>; readonly cwd: string }) =>
	Effect.gen(function* () {
		const [name = "", ...rest] = args;

		const parsed = Option.flatMap(split(rest), ({ options, command }) =>
			Option.map(placesOf(options), (places) => ({ places, command })),
		);

		if (Option.isNone(parsed) || !/^[\w.-]+$/u.test(name)) {
			return yield* usage("queue <name> [--places <n>] -- <command>...");
		}

		const homeFolder = yield* home;

		return yield* reported(`queue ${name}`)(runQueued({ ...parsed.value, name, cwd, home: homeFolder }));
	});
