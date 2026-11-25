import { expect, test } from "bun:test";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Rec from "effect/Record";
import * as Str from "effect/String";

import { levels, selfFromEnv } from "#src/features/owned-work/child.ts";
import { aliases } from "#src/features/owned-work/models.ts";
import { stagedLaunches, type StagedLaunch } from "./preview.ts";

const instructionsFolder = `${import.meta.dirname}/../../../../agent/instructions`;

const message = "Say which tools you have.";

const messageFileOf = ({ argv }: StagedLaunch) => Effect.map(Effect.fromOption(Arr.last(argv)), Str.slice(1));

const staged = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	const state = yield* fs.makeTempDirectoryScoped();

	yield* fs.writeFileString(`${state}/sketch.md`, "## Synthesis decision\n");

	const whileStaged = Effect.gen(function* () {
		const launches = yield* stagedLaunches({ cwd: state, dir: `${state}/delegates`, message, state, env: {} });

		const messages = yield* Effect.forEach(launches, (launch) =>
			Effect.flatMap(messageFileOf(launch), fs.readFileString),
		);

		return { launches, messages };
	});

	const shown = yield* Effect.scoped(whileStaged);

	const leftAfterScope = yield* Effect.filter(shown.launches, (launch) =>
		Effect.flatMap(messageFileOf(launch), fs.exists),
	);

	const instructionFiles = yield* fs.readDirectory(instructionsFolder);

	return { ...shown, leftAfterScope, instructionFiles };
});

const stagedOnce = Effect.runPromise(staged.pipe(Effect.scoped, Effect.provide(NodeServices.layer)));

const shown = Effect.promise(() => stagedOnce);

const byName = Order.mapInput(Order.String, ({ name }: { readonly name: string }) => name);

test("one level-2 delegate per harness instructions file is staged, beside an owner at level 2 and at the last level and a leaf at level 2", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const { launches, instructionFiles } = yield* shown;
			const fromFiles = Arr.map(instructionFiles, (file) => ({ name: Str.replace(/\.md$/u, "")(file), level: 2 }));

			const bare = [
				{ name: "owner", level: 2 },
				{ name: "owner-last-level", level: levels },
				{ name: "leaf", level: 2 },
			];

			expect(
				Arr.sort(
					Arr.map(launches, ({ name, level }) => ({ name, level })),
					byName,
				),
			).toEqual(Arr.sort([...fromFiles, ...bare], byName));
		}),
	));

test("each staged launch's environment starts a child that knows its role and level", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const { launches } = yield* shown;

			const selves = yield* Effect.forEach(launches, ({ env }) =>
				Effect.map(
					Effect.option(selfFromEnv(env)),
					Option.map(({ role, level }) => ({ role, level })),
				),
			);

			expect(selves).toEqual(Arr.map(launches, ({ role, level }) => Option.some({ role, level })));
		}),
	));

test("every staged delegate runs a model the table gives, on that model's own provider", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const { launches } = yield* shown;
			const tableModels = Arr.map(Rec.values(aliases), ({ provider, id }) => `${provider}/${id}`);

			const models = Arr.map(launches, ({ argv }) =>
				Option.flatMap(
					Arr.findFirstIndex(argv, (word) => word === "--model"),
					(at) => Arr.get(argv, at + 1),
				),
			);

			expect(Arr.filter(models, (model) => !Option.exists(model, (key) => Arr.contains(tableModels, key)))).toEqual(
				[],
			);
		}),
	));

test("each staged delegate's message file holds the message until the caller's scope closes", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const { launches, messages, leftAfterScope } = yield* shown;

			expect({ messages, leftAfterScope }).toEqual({
				messages: Arr.map(launches, () => message),
				leftAfterScope: [],
			});
		}),
	));
