import { expect, test } from "bun:test";

import { createModels } from "@earendil-works/pi-ai/models";
import { getBuiltinModel } from "@earendil-works/pi-ai/providers/all";
import * as Function from "effect/Function";

import { accountProvider, accounts, anthropicOf } from "./accounts.ts";
import { targetOf } from "./index.ts";

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
