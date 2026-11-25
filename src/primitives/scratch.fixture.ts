import { afterAll, beforeAll } from "bun:test";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

export const scratchFolder = (name: string): string => {
	const scratch = `${Bun.env["TMPDIR"] ?? "/tmp"}/${name}-${String(process.pid)}`;

	beforeAll(() =>
		Effect.runPromise(
			Effect.flatMap(FileSystem.FileSystem, (fs) =>
				Effect.andThen(
					fs.remove(scratch, { recursive: true, force: true }),
					fs.makeDirectory(scratch, { recursive: true }),
				),
			).pipe(Effect.provide(NodeServices.layer)),
		),
	);

	afterAll(() =>
		Effect.runPromise(
			Effect.flatMap(FileSystem.FileSystem, (fs) => fs.remove(scratch, { recursive: true })).pipe(
				Effect.provide(NodeServices.layer),
			),
		),
	);

	return scratch;
};
