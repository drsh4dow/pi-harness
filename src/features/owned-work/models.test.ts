import { expect, test } from "bun:test";

import { getBuiltinModel } from "@earendil-works/pi-ai/providers/all";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Rec from "effect/Record";

import { ClaudeUsage } from "#src/client/claude-usage/index.ts";
import { PhiRouter } from "#src/client/phi-router/index.ts";
import { piHost } from "#src/client/pi-host/index.ts";
import { modelNameOf, modelOf, modelTable } from "./models.ts";

const arena = Bun.file(new URL("../../../agent/skills/arena/SKILL.md", import.meta.url));

test("the extra runner the arena names is a table alias outside the panel", () =>
	Effect.runPromise(
		Effect.map(
			Effect.promise(() => arena.text()),
			(text) => {
				const extra = /plus one on `(?<alias>[^`]+)`/u.exec(text)?.groups?.["alias"];

				expect(extra).toBe("divergent");
				expect(Rec.keys(modelTable.aliases)).toContain("divergent");
				expect(modelTable.panel).not.toContain("divergent");
			},
		),
	));

const opus = getBuiltinModel("anthropic", "claude-opus-5-5");

const onAccount = (provider: string) => ({ ...opus, provider });

const weekly = (percent: number) => [{ name: "weekly", percent, resetsAt: Option.none() }];

const meters = Layer.mock(ClaudeUsage)({
	plan: () => Effect.succeed({ windows: weekly(90), spend: Option.none() }),
	probe: () => Effect.succeed(weekly(10)),
});

const host = piHost(Layer.merge(meters, Layer.mock(PhiRouter)({})));

const modelRegistry = {
	getAll: () => [onAccount("ultra-a"), onAccount("ultra-b"), onAccount("ent")],
	getApiKeyForProvider: (provider: string) => Promise.resolve(provider),
};

const startsOn = ({ parent, name, starts }: { parent: string; name: string; starts: string }) => {
	const caller = { model: onAccount(parent), cwd: "/", modelRegistry, sessionManager: { getSessionId: () => parent } };
	const placed = modelOf(caller, modelTable, modelNameOf(name));

	return host.run(
		Effect.map(placed, ({ model }) => {
			expect(model).toBe(starts);
		}),
	);
};

test.each([
	{ parent: "ultra-a", name: "judgment", starts: "ultra-b/claude-opus-5-5" },
	{ parent: "ultra-a", name: "ultra-a/claude-opus-5-5", starts: "ultra-a/claude-opus-5-5" },
	{ parent: "ent", name: "judgment", starts: "ent/claude-opus-5-5" },
])("a delegate of a $parent parent named $name starts on $starts", startsOn);
