import * as Arr from "effect/Array";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Str from "effect/String";

import { type Commit, longestBodyLine, plant } from "#tools/driver/align/observe.ts";
import type { Run, ScenarioFailed } from "#tools/driver/index.ts";
import {
	type Ended,
	type GuideFile,
	type Marker,
	reportOf,
	type Timeline,
	timelineOf,
	type Window,
} from "./timeline.ts";

const markdown = (names: ReadonlyArray<string>) =>
	Arr.map(Arr.filter(names, Str.endsWith(".md")), Str.replace(/\.md$/u, ""));

const markersOf = (run: Run) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const skills = yield* fs.readDirectory(`${run.agentDir}/skills`);
		const playbooks = yield* fs.readDirectory(`${run.agentDir}/playbooks`);
		const principles = yield* fs.readDirectory(`${run.agentDir}/principles`);

		const named: ReadonlyArray<GuideFile> = [
			...Arr.map(skills, (name): GuideFile => `skills/${name}/SKILL.md`),
			...Arr.map(markdown(playbooks), (name): GuideFile => `playbooks/${name}.md`),
			...Arr.map(markdown(principles), (name): GuideFile => `principles/${name}.md`),
		];

		const files = yield* Effect.filter(named, (guide) => fs.exists(`${run.agentDir}/${guide}`));

		return yield* Effect.forEach(files, (guide) =>
			Effect.map(fs.readFileString(`${run.agentDir}/${guide}`), (text): Marker => ({
				guide,
				line: longestBodyLine(text),
			})),
		);
	});

/**
 * Stands in for GitHub as `acme/<project>`: logs every call to `gh.log` in the run folder, answers what filing an
 * issue or opening a PR needs, and fails the rest as an unreachable host would.
 */
const ghShim = ({ folder, project }: { readonly folder: string; readonly project: string }) => {
	const repo = `acme/${project}`;

	return `#!/bin/sh
printf '%s\\n' "$*" >>${folder}/gh.log
case "$1 $2" in
"auth status") echo "github.com: logged in to account acme-dev" ;;
"api user") echo '{"login":"acme-dev"}' ;;
"repo view") echo '{"nameWithOwner":"${repo}","name":"${project}","url":"https://github.com/${repo}","defaultBranchRef":{"name":"main"}}' ;;
"issue list" | "pr list") ;;
"issue create" | "issue edit") echo "https://github.com/${repo}/issues/41" ;;
"issue view") echo '{"number":41,"url":"https://github.com/${repo}/issues/41","state":"OPEN"}' ;;
"pr create" | "pr edit") echo "https://github.com/${repo}/pull/42" ;;
"pr view") echo '{"number":42,"url":"https://github.com/${repo}/pull/42","state":"OPEN","isDraft":false}' ;;
*) echo "error connecting to api.github.com" >&2; exit 1 ;;
esac
`;
};

/** Checks every guide the scenario measures exists, puts the `gh` stand-in first on the run's PATH, and plants. */
const stage = ({
	run,
	guides,
	history,
}: {
	readonly run: Run;
	readonly guides: ReadonlyArray<GuideFile>;
	readonly history: ReadonlyArray<Commit>;
}) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const folder = Str.replace(/\/home$/u, "")(run.home);
		const markers = yield* markersOf(run);
		const absent = Arr.filter(guides, (guide) => !Arr.some(markers, (marker) => marker.guide === guide));

		yield* run.check(
			!Arr.isReadonlyArrayNonEmpty(absent),
			`every guide the scenario measures exists (missing: ${Arr.join(absent, ", ")})`,
		);
		const project = Str.replace(/-\d{8}-\d{6}-\d+$/u, "")(path.basename(folder));

		yield* fs.writeFileString(`${folder}/bin/gh`, ghShim({ folder, project }), { mode: 0o755 });
		yield* plant({ run, history });

		return markers;
	});

/**
 * A scenario's whole `play`. Plants `history`, sends `request` as the human's one message, and stops at the first of:
 * `event` finds its window, the root gives its final reply, `within` runs out. Then it prints each read of `guides`,
 * the window, the principles the root read, and last `verdict <hit|miss|no-event> <model> <ended>`. Every verdict
 * passes; a run that breaks prints no verdict.
 */
export const measure = ({
	run,
	guides,
	history,
	request,
	within,
	event,
}: {
	readonly run: Run;
	readonly guides: Arr.NonEmptyReadonlyArray<GuideFile>;
	readonly history: ReadonlyArray<Commit>;
	readonly request: string;
	readonly within: Duration.Input;
	readonly event: (timeline: Timeline) => Option.Option<Window>;
}) =>
	Effect.gen(function* () {
		const markers = yield* stage({ run, guides, history });

		const seen = Effect.map(run.waitFor("the sessions", "1 minute", Option.some), (sessions) => ({
			sessions,
			timeline: timelineOf({ sessions, markers }),
		}));

		const look: Effect.Effect<Ended, ScenarioFailed> = Effect.flatMap(seen, ({ timeline }) => {
			if (Option.isSome(event(timeline))) {
				return Effect.succeed("event");
			}

			return Option.isSome(timeline.finalReply)
				? Effect.succeed("settled")
				: Effect.andThen(Effect.sleep("5 seconds"), look);
		});

		const budget = Duration.fromInputUnsafe(within);
		const prompting = run.root.prompt(request, Duration.sum(budget, Duration.minutes(1)));

		const ended = yield* Effect.raceFirst(
			Effect.andThen(prompting, Effect.never),
			Effect.timeoutOrElse(look, { duration: budget, orElse: () => Effect.succeed<Ended>("budget") }),
		);

		const last = yield* seen;

		yield* Effect.forEach(reportOf({ ...last, guides, event, ended }), (line) => run.say(line));
	});
