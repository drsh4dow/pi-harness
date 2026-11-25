import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Str from "effect/String";

import type { GuideKind } from "#src/features/loaded/index.ts";
import { guideEvents } from "./events.ts";
import type { GuideOnDisk, Library } from "./guides.ts";
import type { Role } from "./offer.ts";
import type { Scope, SessionFacts } from "./session.ts";

const kinds: ReadonlyArray<GuideKind> = ["principle", "playbook", "skill"];
const roles: ReadonlyArray<Role> = ["root", "owner", "leaf", "delegate", "none"];

const percent = (part: number, whole: number) => (whole === 0 ? "n/a" : `${((100 * part) / whole).toFixed(0)}%`);

const row = (cells: ReadonlyArray<string | number>) => `| ${Arr.join(Arr.map(cells, String), " | ")} |`;

const table = (header: ReadonlyArray<string>, align: ReadonlyArray<string>, rows: ReadonlyArray<string>) =>
	Arr.join([row(header), row(align), ...rows], "\n");

const section = (parts: ReadonlyArray<string>) => Arr.join(parts, "\n\n");

const count = <Item>(items: ReadonlyArray<Item>, keep: (item: Item) => boolean) => Arr.length(Arr.filter(items, keep));

interface Usage {
	readonly listed: number;
	readonly loaded: number;
	readonly loadedWhereListed: number;
	readonly byScope: Readonly<Record<Scope, number>>;
	readonly pathOnly: number;
}

const usageOf = (guide: GuideOnDisk, real: ReadonlyArray<SessionFacts>, trials: ReadonlyArray<SessionFacts>): Usage => {
	const loading = Arr.filter(real, (session) => session.loaded.has(guide));

	return {
		listed: count(real, (session) => session.listed.has(guide.name)),
		loaded: loading.length,
		loadedWhereListed: count(loading, (session) => session.listed.has(guide.name)),
		byScope: {
			product: count(loading, (session) => session.scope === "product"),
			harness: count(loading, (session) => session.scope === "harness"),
			trial: count(trials, (session) => session.loaded.has(guide)),
		},
		pathOnly: count(loading, (session) => session.loaded.get(guide) === "path"),
	};
};

const guideRow = (guide: GuideOnDisk, usage: Usage, total: number) =>
	row([
		guide.hidden ? `${guide.name} (hidden)` : guide.name,
		usage.listed,
		usage.loaded,
		total === 0 ? "0.0%" : `${((100 * usage.loaded) / total).toFixed(1)}%`,
		usage.loadedWhereListed,
		percent(usage.loadedWhereListed, usage.listed),
		`${usage.byScope.product} / ${usage.byScope.harness}`,
		usage.byScope.trial,
	]);

const byLoads = Order.combine(
	Order.mapInput(Order.Number, ([, { loaded }]: readonly [GuideOnDisk, Usage]) => -loaded),
	Order.mapInput(Order.String, ([{ name }]: readonly [GuideOnDisk, Usage]) => name),
);

const kindSection = (kind: GuideKind, usage: ReadonlyArray<readonly [GuideOnDisk, Usage]>) => {
	const ranked = Arr.sort(
		Arr.filter(usage, ([guide]) => guide.kind === kind),
		byLoads,
	);

	const total = Arr.reduce(ranked, 0, (sum, [, { loaded }]) => sum + loaded);
	const pathOnly = Arr.reduce(ranked, 0, (sum, [, each]) => sum + each.pathOnly);

	const never = Arr.map(
		Arr.filter(ranked, ([, { loaded }]) => loaded === 0),
		([{ name }]) => name,
	);

	return section([
		`## ${kind}s (${ranked.length} on disk, ${total} loads in real sessions, ${pathOnly} of them by a named path only)`,
		`Never loaded in real sessions: ${Arr.isReadonlyArrayNonEmpty(never) ? Arr.join(never, ", ") : "none"}.`,
		table(
			[
				"guide",
				"listed in",
				"loaded",
				"share of loads",
				"loaded where listed",
				"rate",
				"product / harness",
				"trials",
			],
			["---", "--:", "--:", "--:", "--:", "--:", "--:", "--:"],
			Arr.map(ranked, ([guide, each]) => guideRow(guide, each, total)),
		),
	]);
};

const loadedByName = (session: SessionFacts, name: string) =>
	Arr.some([...session.loaded.keys()], (guide) => guide.name === name);

const eventSection = (real: ReadonlyArray<SessionFacts>) => {
	const rows = Arr.flatMap(guideEvents, (event) => {
		const fired = Arr.filter(real, (session) => session.events.has(event));

		return Arr.map(event.guides, (name) => {
			const there = Arr.filter(fired, (session) => session.listed.has(name));
			const loaded = count(there, (session) => loadedByName(session, name));

			return row([
				event.name,
				fired.length,
				name,
				there.length,
				loaded,
				percent(loaded, there.length),
				there.length - loaded,
			]);
		});
	});

	return section([
		"## events (real sessions)",
		table(
			["event", "sessions", "guide", "listed there", "loaded", "hit rate", "missed"],
			["---", "--:", "---", "--:", "--:", "--:", "--:"],
			rows,
		),
	]);
};

const modelOf = (model: string | undefined) => {
	if (model === undefined) {
		return "none";
	}

	return Str.includes("/")(model) ? "provider/id" : model;
};

const instructionsOf = (file: string | undefined) =>
	file === undefined ? "none" : Str.replace(/\.md$/u, "")(Arr.lastNonEmpty(Str.split(file, "/")));

interface Slot {
	readonly cells: ReadonlyArray<string>;
	count: number;
}

const delegateSection = (real: ReadonlyArray<SessionFacts>) => {
	const calls = new Map<string, Slot>();

	for (const each of Arr.flatMap(real, (session) => session.delegateCalls)) {
		const role = each.continues ? "continues" : (each.role ?? "none");
		const cells = [role, modelOf(each.model), instructionsOf(each.instructionsFile)];
		const key = Arr.join(cells, "\n");
		const slot = calls.get(key) ?? { cells, count: 0 };

		slot.count += 1;
		calls.set(key, slot);
	}

	const ranked = Arr.sort(
		[...calls.values()],
		Order.combine(
			Order.mapInput(Order.Number, (slot: Slot) => -slot.count),
			Order.mapInput(Order.String, (slot: Slot) => Arr.join(slot.cells, " ")),
		),
	);

	return section([
		"## delegate calls (real sessions)",
		table(
			["role", "model", "instructions file", "calls"],
			["---", "---", "---", "--:"],
			Arr.map(ranked, (slot) => row([...slot.cells, slot.count])),
		),
	]);
};

/** The usage report as markdown: per guide kind, then per event, then the delegate calls. */
export const reportOf = ({
	library,
	sessions,
}: {
	readonly library: Library;
	readonly sessions: ReadonlyArray<SessionFacts>;
}) => {
	const real = Arr.filter(sessions, (session) => session.scope !== "trial");
	const trials = Arr.filter(sessions, (session) => session.scope === "trial");
	const usage = Arr.map(library.guides, (guide) => [guide, usageOf(guide, real, trials)] as const);

	const starts = Arr.sort(
		Arr.map(sessions, (session) => Str.slice(0, 10)(session.started)),
		Order.String,
	);

	const first = Option.getOrElse(Arr.head(starts), () => "n/a");
	const last = Option.getOrElse(Arr.last(starts), () => "n/a");
	const harness = count(real, (session) => session.scope === "harness");
	const roleCounts = Arr.map(roles, (role) => `${role} ${count(real, (session) => session.role === role)}`);

	return section([
		"# Guide usage",
		Arr.join(
			[
				`Sessions: ${sessions.length} with a model turn, ${real.length} real (${harness} harness work, ${real.length - harness} product work), ${trials.length} trials under /tmp.`,
				`Started: ${first} to ${last}.`,
				`Roles of the real sessions: ${Arr.join(roleCounts, ", ")}.`,
			],
			"\n",
		),
		...Arr.map(kinds, (kind) => kindSection(kind, usage)),
		eventSection(real),
		delegateSection(real),
	]);
};
