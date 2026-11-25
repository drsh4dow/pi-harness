import { expect, test } from "bun:test";

import { createModels } from "@earendil-works/pi-ai/models";
import { getBuiltinModel } from "@earendil-works/pi-ai/providers/all";
import * as Effect from "effect/Effect";
import * as Function from "effect/Function";

import { accountProvider, accounts, anthropicOf } from "./accounts.ts";
import { switchAccount, targetOf } from "./index.ts";

const anthropic = anthropicOf();

const opus = getBuiltinModel("anthropic", "claude-opus-5-5");

const models = createModels();

for (const account of accounts) {
	models.setProvider(accountProvider({ anthropic, account, limited: Function.constVoid }));
}

const find = (provider: string, id: string) => models.getModel(provider, id);

test("/account keeps the model and moves it to the named account", () => {
	const target = targetOf({ chosenAccount: "ent", current: { ...opus, provider: "ultra-a" }, find });

	expect(target).toMatchObject({ kind: "switch", model: { provider: "ent", id: "claude-opus-5-5" } });
});

const refusals = [
	{ name: "an account that does not exist", request: { chosenAccount: "ultra-c", current: opus } },
	{ name: "no model yet", request: { chosenAccount: "ent", current: undefined } },
	{
		name: "a model no account offers",
		request: { chosenAccount: "ent", current: { ...opus, provider: "openai", id: "gpt-6.1-sol" } },
	},
];

test.each(refusals)("/account refuses $name", ({ request }) => {
	expect(targetOf({ ...request, find }).kind).toBe("refuse");
});

const switches = [
	{
		name: "with nothing typed, offers every account and moves to the one picked",
		typed: "",
		picked: "ent",
		offered: [["ultra-a", "ultra-b", "ent"]],
		moves: ["ent/claude-opus-5-5"],
	},
	{
		name: "with nothing typed and nothing picked, stays",
		typed: "",
		picked: undefined,
		offered: [["ultra-a", "ultra-b", "ent"]],
		moves: [],
	},
	{
		name: "with an account typed, asks nothing and moves there",
		typed: " ent ",
		picked: undefined,
		offered: [],
		moves: ["ent/claude-opus-5-5"],
	},
];

test.each(switches)("/account $name", ({ typed, picked, offered, moves }) => {
	const seen = { offered: new Array<ReadonlyArray<string>>(), moves: new Array<string>() };

	const pi = {
		getThinkingLevel: () => "high" as const,
		setThinkingLevel: Function.constVoid,
		setModel: ({ provider, id }: { readonly provider: string; readonly id: string }) => {
			seen.moves.push(`${provider}/${id}`);

			return Promise.resolve(true);
		},
	};

	const ui = {
		notify: Function.constVoid,
		select: (_title: string, options: ReadonlyArray<string>) => {
			seen.offered.push(options);

			return Promise.resolve(picked);
		},
	};

	const session = { model: { ...opus, provider: "ultra-a" }, ui, modelRegistry: { find } };

	return Effect.runPromise(
		Effect.map(switchAccount(pi)(typed, session), () => {
			expect(seen).toEqual({ offered, moves });
		}),
	);
});
