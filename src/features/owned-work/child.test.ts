import { expect, test } from "bun:test";

import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { atLevel, type ChildRole, childExtensions, selfFromEnv, withAgentBin } from "./child.ts";

const binRows = [
	{
		name: "a PATH without the agent's bin folder gets it first",
		path: "/usr/bin:/bin",
		expect: "/a/agent/bin:/usr/bin:/bin",
	},
	{
		name: "a PATH that holds the agent's bin folder later gets it first, once",
		path: "/usr/bin:/a/agent/bin:/bin",
		expect: "/a/agent/bin:/usr/bin:/bin",
	},
	{ name: "no PATH becomes the agent's bin folder alone", path: undefined, expect: "/a/agent/bin" },
];

test.each(binRows)("$name", (row) => {
	const env: Readonly<Record<string, string | undefined>> = withAgentBin("/a/agent")({
		HOME: "/h",
		PATH: row.path,
	});

	expect(env).toEqual({ HOME: "/h", PATH: row.expect });
});

const envRows: ReadonlyArray<{
	name: string;
	env: Readonly<Record<string, string>>;
	reads: { role: ChildRole; level: number } | undefined;
}> = [
	{
		name: "an owner's env runs at its level as an owner",
		env: atLevel({ level: 2, role: "owner" }).env,
		reads: { role: "owner", level: 2 },
	},
	{
		name: "a leaf's env runs at its level as a leaf, down to level 4",
		env: atLevel({ level: 4, role: "leaf" }).env,
		reads: { role: "leaf", level: 4 },
	},
	{ name: "an env at level 1 is refused", env: atLevel({ level: 1, role: "owner" }).env, reads: undefined },
	{ name: "an owner's env at level 4 is refused", env: atLevel({ level: 4, role: "owner" }).env, reads: undefined },
	{ name: "a leaf's env at level 5 is refused", env: atLevel({ level: 5, role: "leaf" }).env, reads: undefined },
	{ name: "an env with a level and no role is refused", env: { PI_OWNED_WORK_LEVEL: "2" }, reads: undefined },
	{
		name: "an env with the root's role is refused",
		env: { PI_OWNED_WORK_LEVEL: "2", PI_OWNED_WORK_ROLE: "root" },
		reads: undefined,
	},
];

test.each(envRows)("$name", (row) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const self = yield* Effect.option(selfFromEnv({ ...row.env, PI_OWNED_WORK_SLICE: "s" }));

			expect(
				self.pipe(
					Option.map(({ role, level }) => ({ role, level })),
					Option.getOrUndefined,
				),
			).toEqual(row.reads);
		}),
	),
);

test("every child extension is an entrypoint pi can load", () => {
	for (const entry of childExtensions) {
		expect(Bun.file(entry).size).toBeGreaterThan(0);
	}
});
