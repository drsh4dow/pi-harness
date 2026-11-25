import * as Arr from "effect/Array";
import * as Str from "effect/String";

export const harnessEntries = (gitignore: string): ReadonlyArray<string> =>
	Arr.flatMap(Str.split(gitignore, "\n"), (line) => {
		const shipped = /^!\/agent\/(?<entry>[^/]+)\/?$/u.exec(line)?.groups?.["entry"];

		return shipped === undefined ? [] : [shipped];
	});

const isPackageBin = (folder: string) => /\/node_modules\/\.bin\/?$/u.test(folder);

export const withoutPackageBins = (env: Readonly<Record<string, string>>) => ({
	...env,
	PATH: Arr.join(
		Arr.filter(Str.split(env["PATH"] ?? "", ":"), (folder) => !isPackageBin(folder)),
		":",
	),
});
