import { afterAll, beforeAll, expect, test } from "bun:test";

import type { SlashCommandInfo } from "@earendil-works/pi-coding-agent";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { PhiRouter, phiRouterLayer, routerExtensionOf } from "./index.ts";

const root = `${Bun.env["TMPDIR"] ?? "/tmp"}/phi-router-${String(process.pid)}`;

const bin = `${root}/plugins/claude/bin`;

const launcher = `#!/bin/sh
echo "$@" > "$(dirname "$0")/$3.asked"
case "$3" in
	held) echo '{"pinned":true}' ;;
	ghost) echo "no session ghost" >&2; exit 1 ;;
	*) echo '{"pinned":false}' ;;
esac
`;

beforeAll(() =>
	Effect.runPromise(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;

			yield* fs.makeDirectory(`${root}/plugins/pi`, { recursive: true });
			yield* fs.makeDirectory(bin, { recursive: true });
			yield* fs.writeFileString(`${bin}/phi-router`, launcher);
			yield* fs.chmod(`${bin}/phi-router`, 0o755);
		}).pipe(Effect.provide(NodeServices.layer)),
	),
);

afterAll(() =>
	Effect.runPromise(
		Effect.flatMap(FileSystem.FileSystem, (fs) => fs.remove(root, { recursive: true })).pipe(
			Effect.provide(NodeServices.layer),
		),
	),
);

const routerAt = (extension: Option.Option<string>, env: Readonly<Record<string, string>>) =>
	Layer.merge(Layer.provide(phiRouterLayer({ extension, env }), NodeServices.layer), NodeServices.layer);

const extension = Option.some(`${root}/plugins/pi/extension.mjs`);

const router = routerAt(extension, {});

const ported = routerAt(extension, { PHI_ROUTER_PORT: "4111" });

const unloaded = routerAt(Option.none(), {});

const asked = (session: string) =>
	Effect.flatMap(FileSystem.FileSystem, (fs) => fs.readFileString(`${bin}/${session}.asked`));

test("pinned asks the package's phi-router launcher for the session's status", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const phi = yield* PhiRouter;
			const got = yield* Effect.all([phi.pinned("held"), phi.pinned("open")]);
			const args = yield* Effect.all([asked("held"), asked("open")]);

			expect({ got, args }).toEqual({
				got: [true, false],
				args: ["status --session held\n", "status --session open\n"],
			});
		}).pipe(Effect.provide(router)),
	));

test("pin succeeds once the launcher exits 0, and fails with its reason otherwise", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const phi = yield* PhiRouter;
			const refused = yield* Effect.flip(phi.pin("ghost"));

			yield* phi.pin("open");

			expect(refused.why).toBe("no session ghost");
		}).pipe(Effect.provide(router)),
	));

test("the launcher gets the port PHI_ROUTER_PORT names", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const phi = yield* PhiRouter;

			yield* phi.pin("ported");

			const args = yield* asked("ported");

			expect(args).toBe("pin --session ported --port 4111\n");
		}).pipe(Effect.provide(ported)),
	));

test("with no package loaded, every question fails", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const phi = yield* PhiRouter;
			const pinned = Effect.flip(phi.pinned("held"));
			const pin = Effect.flip(phi.pin("held"));
			const failed = yield* Effect.all([pinned, pin]);

			expect(Arr.map(failed, ({ _tag }) => _tag)).toEqual(["PhiRouterError", "PhiRouterError"]);
		}).pipe(Effect.provide(unloaded)),
	));

const command = (name: string, source: SlashCommandInfo["source"], path: string): SlashCommandInfo => ({
	name,
	source,
	sourceInfo: { path, source: "local", scope: "user", origin: "top-level" },
});

const extensionRows = [
	{
		name: "the extension that added /phi",
		commands: [
			command("loop", "extension", "/a/loop.ts"),
			command("phi", "extension", "/r/plugins/pi/extension.mjs"),
		],
		expected: Option.some("/r/plugins/pi/extension.mjs"),
	},
	{
		name: "nothing for a skill named phi",
		commands: [command("phi", "skill", "/s/phi/SKILL.md")],
		expected: Option.none(),
	},
	{ name: "nothing without /phi", commands: [command("loop", "extension", "/a/loop.ts")], expected: Option.none() },
];

test.each(extensionRows)("the router's extension is $name", ({ commands, expected }) => {
	expect(routerExtensionOf(commands)).toEqual(expected);
});
