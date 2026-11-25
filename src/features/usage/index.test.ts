import { expect, test } from "bun:test";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";

const fakePi = `
import { usage } from "${import.meta.dirname}/index.ts";

const seen = [];
const registered = {};

const feature = usage({
	appendEntry: (type, card) => seen.push({ entry: type, blocks: card.blocks }),
	registerCommand: (name, { handler }) => {
		registered[name] = handler;
	},
	registerEntryRenderer: (type, render) => {
		registered[type + " entry"] = render;
	},
});

await registered.usage("", {
	modelRegistry: { getApiKeyForProvider: () => Promise.resolve(undefined) },
	ui: { setWidget: (key, widget) => seen.push({ widget: key, shown: widget !== undefined }) },
});

const theme = { fg: (_color, text) => text, bold: (text) => text, bg: (_color, text) => text };
const drawn = registered["usage entry"]({ data: { readAt: "Nov 10, 16:40", blocks: "none" } }, {}, theme);
seen.push({ entry: "usage", drawn: drawn !== undefined });

await feature.shutdown();
console.log(JSON.stringify(seen));
`;

const decodeSeen = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(Schema.Json)));

const runUsage = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	const agentDir = yield* fs.makeTempDirectoryScoped();

	yield* fs.makeDirectory(`${agentDir}/sessions`);

	const pi = Bun.spawn([process.execPath, "-e", fakePi], {
		env: { HOME: Bun.env["HOME"] ?? "", PI_CODING_AGENT_DIR: agentDir },
		stdout: "pipe",
		stderr: "pipe",
	});

	const [stdout, stderr, code] = yield* Effect.promise(() =>
		Promise.all([new Response(pi.stdout).text(), new Response(pi.stderr).text(), pi.exited]),
	);

	return code === 0 ? yield* decodeSeen(stdout) : yield* Effect.die(stderr);
});

const unreadable = (why: string) => ({ kind: "unreadable", why });

test("/usage shows a card that fills in, then stores the finished card as one entry, which draws only as a card", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const seen = yield* runUsage;

			expect(seen).toEqual([
				{ widget: "usage", shown: true },
				{
					entry: "usage",
					blocks: [
						{
							account: "ultra-a",
							via: "usage page",
							body: unreadable("ultra-a has no login. Run /login ultra-a."),
						},
						{
							account: "ultra-b",
							via: "one-token probe",
							body: unreadable("ultra-b has no login. Run /login ultra-b."),
						},
						{ account: "ent", via: "usage page", body: unreadable("ent has no login. Run /login ent.") },
						{
							account: "opencode-go",
							via: "OpenCode Go usage API",
							body: unreadable("opencode-go has no login. Run /login opencode-go."),
						},
						{
							account: "openai",
							via: "estimate from pi's sessions at list prices",
							body: {
								kind: "read",
								rows: [{ kind: "note", name: "last 30 days", text: "$0.00 over 0 replies", quiet: false }],
							},
						},
					],
				},
				{ widget: "usage", shown: false },
				{ entry: "usage", drawn: false },
			]);
		}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
	));
