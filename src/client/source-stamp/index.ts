import { uuidv7 } from "@earendil-works/pi-ai";
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Hash from "effect/Hash";
import * as Layer from "effect/Layer";

export class SourceStamp extends Context.Service<
	SourceStamp,
	{
		readonly of: (files: ReadonlyArray<string>) => Effect.Effect<number>;
	}
>()("pi-harness/client/source-stamp/SourceStamp") {}

export const sourceStampLayer: Layer.Layer<SourceStamp, never, FileSystem.FileSystem> = Layer.effect(
	SourceStamp,
	Effect.map(FileSystem.FileSystem, (fs) =>
		SourceStamp.of({
			of: (files) =>
				Effect.forEach(files, (file) => fs.readFileString(file)).pipe(
					Effect.map((texts) => Hash.string(Arr.join(texts, "\n"))),
					Effect.orElseSucceed(() => Hash.string(uuidv7())),
				),
		}),
	),
);
