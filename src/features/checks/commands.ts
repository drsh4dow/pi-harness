import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Str from "effect/String";

const checkPatterns: ReadonlyArray<RegExp> = [
	/^(?:bun|npm|pnpm|yarn)(?: +-[\w-]+(?:=\S+| +[^\s;&|()-]\S*)?)*?(?: run(?: +-[\w-]+(?:=\S+| +[^\s;&|()-]\S*)?)*?)? (?:check|test|lint|typecheck)(?:[:-]\S*)?(?=[\s;&|)]|$)/u,
	/^(?:just|make)(?: +[^\s;&|()]+)*? +(?:check|test|lint|typecheck)[\w:-]*(?=[\s;&|)]|$)/u,
	/^(?:(?:npx|bunx|pnpm exec|uv run|poetry run|python3? -m) +)*(?:vitest|jest|pytest|tsc|mypy|ruff check|eslint|oxlint|cargo (?:test|check|clippy|nextest)|go (?:test|vet))(?=[\s;&|)]|$)/u,
];

const keywords = /^(?:(?:if|then|else|elif|do|while|until|time|!|\{)\s+)*/u;

const assignments = /^(?:[A-Za-z_]\w*=(?:'[^']*'|"(?:[^"\\]|\\.)*"|[^\s'";&|()])*\s+)+/u;

const wrappers =
	/^(?:(?:timeout(?: +-\S+(?: +\S+)?)* +\d\S*|nice(?: +-n +-?\d+)?|time|env(?: +-\S+)*(?: +[A-Za-z_]\w*=(?:'[^']*'|"(?:[^"\\]|\\.)*"|[^\s'";&|()])*)*) +)*/u;

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

export const throughCheck =
	(prefix: string) =>
	(line: string): string =>
		Arr.reduce(Arr.reverse(commandStarts(line)), line, throughCheckAt(prefix));
