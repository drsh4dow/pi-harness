import { expect, test } from "bun:test";

import * as Arr from "effect/Array";
import * as Str from "effect/String";

import { libraryOf } from "./guides.ts";
import { reportOf } from "./report.ts";

test("the report has a section per guide kind, then the events, then the delegate calls", () => {
	const report = reportOf({ library: libraryOf({ today: [], past: [] }), sessions: [] });
	const headings = Arr.filter(Str.split(report, "\n"), Str.startsWith("## "));

	expect(Arr.map(headings, (heading) => Str.split(heading, " (")[0])).toEqual([
		"## principles",
		"## playbooks",
		"## skills",
		"## events",
		"## delegate calls",
	]);
});
