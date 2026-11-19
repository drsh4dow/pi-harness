import { expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";

const dir = `${tmpdir()}/git-env-fixture-${process.pid}`;

test("a test runs git in a repository of its own", () => {
	try {
		for (const args of [
			["init", "-q", dir],
			["-C", dir, "checkout", "-q", "-b", "leaked"],
		]) {
			expect(Bun.spawnSync(["git", ...args]).exitCode).toBe(0);
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
