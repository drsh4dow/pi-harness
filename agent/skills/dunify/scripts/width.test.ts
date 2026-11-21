import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dir, "width.sh");

const runWidth = (folders: Record<string, number>, limits: string, roots = ["src"]) => {
	const repo = mkdtempSync(join(tmpdir(), "width-"));
	try {
		spawnSync("git", ["init", "-q"], { cwd: repo });
		for (const [folder, entries] of Object.entries(folders)) {
			mkdirSync(join(repo, folder), { recursive: true });
			for (let entry = 0; entry < entries; entry += 1) {
				writeFileSync(join(repo, folder, `f${String(entry)}.ts`), "");
			}
		}
		writeFileSync(join(repo, "size-limits.txt"), limits);
		const run = spawnSync("sh", [script, "size-limits.txt", ...roots], { cwd: repo, encoding: "utf8" });
		return { status: run.status, output: run.stdout + run.stderr };
	} finally {
		rmSync(repo, { recursive: true, force: true });
	}
};

test("a folder of 21 entries fails with the folder rule", () => {
	const { status, output } = runWidth({ "src/wide": 21 }, "");
	expect(status).toBe(1);
	expect(output).toContain("src/wide holds 21 entries, over 20. Folder rule");
});

test("a baselined folder passes at its count and fails once it grows", () => {
	expect(runWidth({ "src/wide": 40 }, "src/wide 40 baseline\n").status).toBe(0);
	expect(runWidth({ "src/wide": 41 }, "src/wide 40 baseline\n").output).toContain("over 40");
});

test("a baselined folder that shrank asks for the lower count", () => {
	const { status, output } = runWidth({ "src/wide": 36 }, "src/wide 40 baseline\n");
	expect(status).toBe(1);
	expect(output).toContain("Lower its baseline line in size-limits.txt to 36.");
});

test("a baseline line for a folder that no longer exists fails", () => {
	const { status, output } = runWidth({ "src/kept": 3 }, "src/gone 40 baseline\nlib/other 40 baseline\n");
	expect(status).toBe(1);
	expect(output).toBe("src/gone holds 0 entries. Delete its baseline line in size-limits.txt.\n");
});

test("a source root that does not exist fails with the usage", () => {
	const { status, output } = runWidth({ "src/kept": 3 }, "", ["srcc"]);
	expect(status).toBe(2);
	expect(output).toContain("srcc is not a folder. usage:");
});
