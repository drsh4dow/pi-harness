import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import * as Arr from "effect/Array";
import * as Duration from "effect/Duration";
import * as Option from "effect/Option";
import * as Str from "effect/String";

const isMessage = (entry: SessionEntry) => entry.type === "message";

export const messageSpan = (entries: ReadonlyArray<SessionEntry>) =>
	Option.zipWith(Arr.findFirst(entries, isMessage), Arr.findLast(entries, isMessage), (first, last) =>
		Duration.millis(Date.parse(last.timestamp) - Date.parse(first.timestamp)),
	);

const twoDigits = (count: number) => Str.padStart(2, "0")(count.toString());

export const formatDuration = (span: Duration.Duration) => {
	const seconds = Math.floor(Duration.toSeconds(span));
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);

	if (hours > 0) {
		return `${hours.toString()}h${twoDigits(minutes % 60)}m`;
	}

	if (minutes > 0) {
		return `${minutes.toString()}m${twoDigits(seconds % 60)}s`;
	}

	return `${seconds.toString()}s`;
};
