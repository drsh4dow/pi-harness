import { expect, test } from "bun:test";

import { throughCheck } from "./commands.ts";

const wrap = throughCheck("C ");

const rows: ReadonlyArray<readonly [string, string]> = [
	["bun run check", "C bun run check"],
	["bun test src/a.test.ts", "C bun test src/a.test.ts"],
	["npm run test:unit -- --watch=false", "C npm run test:unit -- --watch=false"],
	[
		"just check && just test-cov && just test-integration",
		"C just check && C just test-cov && C just test-integration",
	],
	["make -C api test", "C make -C api test"],
	["uv run pytest -x tests/unit", "C uv run pytest -x tests/unit"],
	["python -m pytest", "C python -m pytest"],
	["cargo test --all", "C cargo test --all"],
	["npx vitest run", "C npx vitest run"],
	["cd /w && bun run check 2>&1 | tail -5", "cd /w && C bun run check 2>&1 | tail -5"],
	["bun run check > /tmp/check.log 2>&1; echo $?", "C bun run check > /tmp/check.log 2>&1; echo $?"],
	["CI=1 FOO='a b' bun test", "C env CI=1 FOO='a b' bun test"],
	["timeout 600 just test", "C timeout 600 just test"],
	["if bun test; then echo ok; fi", "if C bun test; then echo ok; fi"],
	["(cd sub && pytest)", "(cd sub && C pytest)"],
	["git log\nbun run lint", "git log\nC bun run lint"],
	["bun tests/run.ts", "bun tests/run.ts"],
	["bun run build", "bun run build"],
	["just fmt", "just fmt"],
	["make build && echo test", "make build && echo test"],
	["git commit -m 'bun test passes'", "git commit -m 'bun test passes'"],
	['echo "just check; bun test"', 'echo "just check; bun test"'],
	["# bun test\ngit status", "# bun test\ngit status"],
	["cat > run.sh <<'EOF'\nbun test\nEOF\nbash run.sh", "cat > run.sh <<'EOF'\nbun test\nEOF\nbash run.sh"],
	["cat <<EOF > a\nbun test\nEOF\nbun test", "cat <<EOF > a\nbun test\nEOF\nC bun test"],
	["grep -c x <<< 'bun test'", "grep -c x <<< 'bun test'"],
];

test.each(rows)("%p runs its checks through the prefix", (line, expected) => {
	expect(wrap(line)).toBe(expected);
});
