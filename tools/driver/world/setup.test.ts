import { expect, test } from "bun:test";

import { setupOf } from "./setup.ts";

test("setupOf: contextWindow compacts with a quarter of the window in reserve, keeping an eighth", () => {
	expect(setupOf({ model: "local/big", contextWindow: 40_000 }).settings).toEqual({
		compaction: { enabled: true, reserveTokens: 10_000, keepRecentTokens: 5000 },
	});
});
