import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Str from "effect/String";

/**
 * What counts as a check: a simple command whose words, past its environment assignments and a `timeout`, `nice` or
 * `time` wrapper, start the way one of these patterns does.
 */
const checkPatterns: ReadonlyArray<RegExp> = [
	/^(?:bun|npm|pnpm|yarn)(?: run)? (?:check|test|lint|typecheck)(?:[:-]\S*)?(?=[\s;&|)]|$)/u,
	/^(?:just|make)(?: +[^\s;&|()]+)*? +(?:check|test|lint|typecheck)[\w:-]*(?=[\s;&|)]|$)/u,
	/^(?:(?:npx|bunx|pnpm exec|uv run|poetry run|python3? -m) +)*(?:vitest|jest|pytest|tsc|mypy|ruff check|eslint|oxlint|cargo (?:test|check|clippy|nextest)|go (?:test|vet))(?=[\s;&|)]|$)/u,
];

const keywords = /^(?:(?:if|then|else|elif|do|while|until|time|!|\{)\s+)*/u;

const assignments = /^(?:[A-Za-z_]\w*=(?:'[^']*'|"(?:[^"\\]|\\.)*"|[^\s'";&|()])*\s+)+/u;

const wrappers = /^(?:(?:timeout(?: +-\S+(?: +\S+)?)* +\d\S*|nice(?: +-n +-?\d+)?|time) +)*/u;

/**
 * One shell token: a here-document with its body, a character that ends a simple command, a blank or comment, or a
 * piece of a word. A here-document takes the rest of its line with it.
 */
const token =
	/(?<heredoc>(?<!<)<<-?[ \t]*(?<quote>['"]?)(?<delimiter>\w+)\k<quote>[^\n]*\n[\s\S]*?\n\t*\k<delimiter>(?=\n|$))|(?<separator>[;&|\n()`])|(?<blank>[ \t\r]+|(?<=^|[\s;&|()])#[^\n]*)|'[^']*'?|"(?:[^"\\]|\\[\s\S])*"?|\\[\s\S]?|[^\s'"\\;&|()`<]+|[\s\S]/gu;

interface Scan {
	readonly starts: ReadonlyArray<number>;
	readonly atStart: boolean;
}

const scanned = (scan: Scan, { groups, index }: RegExpMatchArray): Scan => {
	if (groups?.["heredoc"] !== undefined || groups?.["separator"] !== undefined) {
		return { ...scan, atStart: true };
	}

	if (groups?.["blank"] !== undefined || !scan.atStart) {
		return scan;
	}

	return { starts: [...scan.starts, index ?? 0], atStart: false };
};

/** Where each simple command of a shell command line starts, outside quotes, comments and here-document bodies. */
const commandStarts = (line: string) =>
	Arr.reduce(Str.matchAll(token)(line), { starts: [], atStart: true }, scanned).starts;

const leadingLength = (pattern: RegExp) => (text: string) =>
	Option.match(Str.match(pattern)(text), { onNone: () => 0, onSome: ([found]) => found.length });

const isCheck = (words: string) => Arr.some(checkPatterns, (pattern) => pattern.test(words));

const throughCheckAt = (prefix: string) => (line: string, start: number) => {
	const at = start + leadingLength(keywords)(Str.slice(start)(line));
	const command = Str.slice(at)(line);
	const assigned = leadingLength(assignments)(command);
	const runner = Str.slice(assigned)(command);

	if (!isCheck(Str.slice(leadingLength(wrappers)(runner))(runner))) {
		return line;
	}

	return `${Str.slice(0, at)(line)}${prefix}${assigned === 0 ? "" : "env "}${command}`;
};

/**
 * The command line with `prefix` put before each check, so the check runs through it. A check with environment
 * assignments gets them through `env`, so the prefix sees them as part of its command.
 */
export const throughCheck =
	(prefix: string) =>
	(line: string): string =>
		Arr.reduce(Arr.reverse(commandStarts(line)), line, throughCheckAt(prefix));
