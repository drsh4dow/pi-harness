import * as Arr from "effect/Array";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import type * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Str from "effect/String";

export const queuesFolder = (home: string) => `${home}/.local/state/pi-agent/queues`;

/** One process in a queue, waiting or holding a place. */
export const Holder = Schema.Struct({ pid: Schema.Finite, command: Schema.String, cwd: Schema.String });

export type Holder = typeof Holder.Type;

const holderJson = Schema.fromJsonString(Holder);

/** Who holds the places, and how many wait ahead of this process. */
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

/** A ticket is `<milliseconds>-<pid>.json`, so its name sorts the line and names the process that holds it. */
const pidOf = (ticket: string) => Number(Str.split(Str.split(ticket, ".")[0], "-")[1]);

/** The tickets in line order. It removes a ticket whose process is gone, so a killed holder frees its place. */
const lineIn = (folder: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const names = yield* fs.readDirectory(folder);
		const tickets = Arr.sort(Arr.filter(names, Str.endsWith(".json")), Str.Order);
		const live = Arr.filter(tickets, (ticket) => isAlive(pidOf(ticket)));
		const dead = Arr.difference(tickets, live);

		yield* Effect.forEach(dead, (ticket) => Effect.ignore(fs.remove(`${folder}/${ticket}`)));

		return live;
	});

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

/** Checks the line once a second until the ticket is among the first `places`, reporting each change in the line. */
const waitTurn =
	(place: Place, ticket: string) =>
	(reported: string): Effect.Effect<void, PlatformError.PlatformError, FileSystem.FileSystem> =>
		Effect.gen(function* () {
			const line = yield* lineIn(place.folder);
			const ahead = line.indexOf(ticket);

			if (ahead < place.places) {
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

/**
 * Holds one of the queue's `places` for the life of the scope, first come first served. Until its turn it calls
 * `onWait` each time the line ahead of it changes.
 */
export const holdPlace = (
	place: Place & { readonly holder: Omit<Holder, "pid"> },
): Effect.Effect<void, PlatformError.PlatformError, FileSystem.FileSystem | Scope.Scope> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const { pid } = process;
		const now = yield* Clock.currentTimeMillis;
		const ticket = `${Str.padStart(15, "0")(String(now))}-${String(pid)}.json`;
		const json = yield* Effect.orDie(Schema.encodeEffect(holderJson)({ ...place.holder, pid }));

		yield* fs.makeDirectory(place.folder, { recursive: true });
		yield* Effect.acquireRelease(fs.writeFileString(`${place.folder}/${ticket}`, json), () =>
			Effect.ignore(fs.remove(`${place.folder}/${ticket}`)),
		);
		yield* waitTurn(place, ticket)("");
	});
