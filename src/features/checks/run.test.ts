import { expect, test } from "bun:test";

import { checkSlotsFor } from "./run.ts";

test.each([
	[4, 2],
	[8, 2],
	[12, 3],
	[16, 4],
])("a machine with %p cores has %p check slots", (cores, slots) => {
	expect(checkSlotsFor(cores)).toBe(slots);
});
