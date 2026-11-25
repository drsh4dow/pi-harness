import * as Arr from "effect/Array";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import type * as PlatformError from "effect/PlatformError";
import * as Random from "effect/Random";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Str from "effect/String";

export const queuesFolder = (home: string) => `${home}/.local/state/pi-agent/queues`;

export const Holder = Schema.Struct({ pid: Schema.Finite, command: Schema.String, cwd: Schema.String });

export type Holder = typeof Holder.Type;

const holderJson = Schema.fromJsonString(Holder);

export interface Wait {
	readonly holders: ReadonlyArray<Holder>;
	readonly ahead: number;
}

const isAlive = (pid: number) => {
	try {
		process.kill(pid, 0);

		return true;
	} catch (error) {
		return error instanceof Error && "code" in error && error.code === "EPERM";
	}
};

/**
 * The queue's folder holds a `choosing-<pid>-<nonce>` file for each caller taking a number, and a
 * `<number>-<pid>-<nonce>.json` ticket for each caller in line. Ticket names sort the line.
 */
const pidOf = (name: string) => Number(Str.split(name, "-")[1]);

const numberOf = (ticket: string) => Number(Str.split(ticket, "-")[0]);

const isChoosing = Str.startsWith("choosing-");

/** The callers' files. It removes those whose process is gone, so a killed holder frees its place. */
const liveIn = (folder: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const names = yield* fs.readDirectory(folder);
		const dead = Arr.filter(names, (name) => !isAlive(pidOf(name)));

		yield* Effect.forEach(dead, (name) => Effect.ignore(fs.remove(`${folder}/${name}`)));

		return Arr.difference(names, dead);
	});

const lineIn = (folder: string) =>
	Effect.map(liveIn(folder), (names) => Arr.sort(Arr.filter(names, Str.endsWith(".json")), Str.Order));

const holdersIn = (folder: string, tickets: ReadonlyArray<string>) =>
	Effect.flatMap(FileSystem.FileSystem, (fs) => {
		const holderIn = (ticket: string) =>
			Effect.option(
				Effect.flatMap(fs.readFileString(`${folder}/${ticket}`), Schema.decodeUnknownEffect(holderJson)),
			);

		return Effect.map(Effect.forEach(tickets, holderIn), Arr.getSomes);
	});

interface Place {
	readonly folder: string;
	readonly places: number;
	readonly onWait: (wait: Wait) => Effect.Effect<void>;
}

const reportChange = (
	{ folder, onWait }: Place,
	wait: { readonly holding: ReadonlyArray<string>; readonly ahead: number },
) => Effect.flatMap(holdersIn(folder, wait.holding), (holders) => onWait({ holders, ahead: wait.ahead }));

/**
 * Whether a caller is taking a number, then the line and how far down it the ticket is. It reads the choosing files
 * first, so a caller that finished taking a number before that read has its ticket in the line.
 */
const standingIn = (folder: string, ticket: string) =>
	Effect.gen(function* () {
		const names = yield* liveIn(folder);
		const line = yield* lineIn(folder);

		return { choosing: Arr.some(names, isChoosing), line, ahead: line.indexOf(ticket) };
	});

/**
 * Checks the line once a second until no caller is taking a number and the ticket is among the first `places`,
 * reporting each change in the line. A caller taking a number may get one below this ticket, so it waits them out.
 */
const waitTurn =
	(place: Place, ticket: string) =>
	(reported: string): Effect.Effect<void, PlatformError.PlatformError, FileSystem.FileSystem> =>
		Effect.gen(function* () {
			const { choosing, line, ahead } = yield* standingIn(place.folder, ticket);

			if (!choosing && ahead < place.places) {
				return;
			}

			const holding = Arr.take(line, place.places);
			const now = `${Arr.join(holding, ",")}:${String(ahead)}`;

			if (now !== reported) {
				yield* reportChange(place, { holding, ahead });
			}

			yield* Effect.sleep(Duration.seconds(1));
			yield* waitTurn(place, ticket)(now);
		});

/** Writes the file for the life of the scope. */
const kept = (path: string, text: string) =>
	Effect.flatMap(FileSystem.FileSystem, (fs) =>
		Effect.acquireRelease(fs.writeFileString(path, text), () => Effect.ignore(fs.remove(path))),
	);

const nextNumberIn = (folder: string) =>
	Effect.map(lineIn(folder), (line) => Math.max(0, ...Arr.map(line, numberOf)) + 1);

/** A ticket numbered past every ticket in line, taken while a choosing file tells waiters to hold off. */
const ticketIn = (folder: string, holder: Holder) =>
	Effect.gen(function* () {
		const nonce = yield* Random.nextInt;
		const id = `${String(holder.pid)}-${String(nonce)}`;
		const choosing = `${folder}/choosing-${id}`;
		const json = yield* Effect.orDie(Schema.encodeEffect(holderJson)(holder));

		yield* kept(choosing, "");

		const number = yield* nextNumberIn(folder);
		const ticket = `${Str.padStart(15, "0")(String(number))}-${id}.json`;

		yield* kept(`${folder}/${ticket}`, json);
		yield* Effect.flatMap(FileSystem.FileSystem, (fs) => fs.remove(choosing));

		return ticket;
	});

/**
 * Holds one of the queue's `places` for the life of the scope, first come first served. Until its turn it calls
 * `onWait` each time the line ahead of it changes.
 */
export const holdPlace = (
	place: Place & { readonly holder: Omit<Holder, "pid"> },
): Effect.Effect<void, PlatformError.PlatformError, FileSystem.FileSystem | Scope.Scope> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;

		yield* fs.makeDirectory(place.folder, { recursive: true });

		const ticket = yield* ticketIn(place.folder, { ...place.holder, pid: process.pid });

		yield* waitTurn(place, ticket)("");
	});
