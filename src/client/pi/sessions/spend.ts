import * as Arr from "effect/Array";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";

export interface SpendRequest {
	readonly root: string;
	readonly provider: string;
	readonly since: DateTime.Utc;
}

export interface Estimate {
	readonly usd: number;
	readonly replies: number;
}

export class SessionsUnreadable extends Schema.TaggedError<SessionsUnreadable, { readonly brand: unique symbol }>()(
	"SessionsUnreadable",
	{
		path: Schema.String,
		why: Schema.String,
	},
) {}

const Usage = Schema.Struct({ cost: Schema.Struct({ total: Schema.Finite }) });

const PricedReply = Schema.Struct({
	type: Schema.Literal("message"),
	message: Schema.Struct({
		role: Schema.Literal("assistant"),
		provider: Schema.String,
		timestamp: Schema.Finite,
		usage: Usage,
	}),
});

const decodeReply = Schema.decodeOption(Schema.fromJsonString(PricedReply));

const unreadable = (path: string) => (cause: unknown) => SessionsUnreadable.make({ path, why: String(cause) });

const isOnOrAfter = (since: DateTime.Utc) => (mtime: Option.Option<Date>) =>
	Option.exists(mtime, (modified) => modified.getTime() >= DateTime.toEpochMillis(since));

const sessionFiles = ({ root, since }: SpendRequest) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const names = yield* Effect.mapError(fs.readDirectory(root, { recursive: true }), unreadable(root));
		const files = Arr.map(Arr.filter(names, Str.endsWith(".jsonl")), (name) => `${root}/${name}`);
		const touched = isOnOrAfter(since);

		return yield* Effect.filter(files, (file) =>
			Effect.mapBoth(fs.stat(file), { onFailure: unreadable(file), onSuccess: ({ mtime }) => touched(mtime) }),
		);
	});

const costOf =
	({ provider, since }: SpendRequest) =>
	(line: string): Option.Option<number> => {
		const priced = Str.includes(`"provider":"${provider}"`)(line) ? decodeReply(line) : Option.none();

		const counted = Option.filter(
			priced,
			({ message }) => message.provider === provider && message.timestamp >= DateTime.toEpochMillis(since),
		);

		return Option.map(counted, ({ message }) => message.usage.cost.total);
	};

const spendIn = (text: string, request: SpendRequest): Estimate => {
	const costs = Arr.getSomes(Arr.map(Str.split("\n")(text), costOf(request)));

	return { usd: Arr.reduce(costs, 0, (sum, cost) => sum + cost), replies: costs.length };
};

const total = (spends: ReadonlyArray<Estimate>): Estimate => ({
	usd: Arr.reduce(spends, 0, (sum, { usd }) => sum + usd),
	replies: Arr.reduce(spends, 0, (sum, { replies }) => sum + replies),
});

export const spendSince = (request: SpendRequest) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const files = yield* sessionFiles(request);

		const read = (file: string) =>
			Effect.mapBoth(fs.readFileString(file), {
				onFailure: unreadable(file),
				onSuccess: (text) => spendIn(text, request),
			});

		const spends = yield* Effect.forEach(files, read, { concurrency: 8 });

		return total(spends);
	});
