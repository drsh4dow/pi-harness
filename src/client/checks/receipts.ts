import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";

/** A check that passed on one tree: its command, where it ran, and the end of its output. */
export const Receipt = Schema.Struct({
	command: Schema.Array(Schema.String),
	root: Schema.String,
	prefix: Schema.String,
	tree: Schema.String,
	passedAt: Schema.String,
	seconds: Schema.Finite,
	tail: Schema.String,
});

export type Receipt = typeof Receipt.Type;

const receiptJson = Schema.fromJsonString(Receipt);

export const receiptsFolder = (home: string) => `${home}/.local/state/pi-agent/receipts`;

/** None when no receipt has that key, or its file does not read as one. */
export const receiptOf = (folder: string) => (key: string) =>
	Effect.flatMap(FileSystem.FileSystem, (fs) => {
		const read = fs.readFileString(`${folder}/${key}.json`);

		return Effect.option(Effect.flatMap(read, Schema.decodeUnknownEffect(receiptJson)));
	});

/** Written aside and renamed into place, so a reader never sees half a receipt. */
export const recordReceipt = (folder: string) => (key: string, receipt: Receipt) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const aside = `${folder}/${key}.${String(process.pid)}.tmp`;
		const json = yield* Schema.encodeEffect(receiptJson)(receipt);

		yield* fs.makeDirectory(folder, { recursive: true });
		yield* fs.writeFileString(aside, json);
		yield* fs.rename(aside, `${folder}/${key}.json`);
	});
