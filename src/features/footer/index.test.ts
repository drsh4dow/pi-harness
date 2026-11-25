import { afterEach, beforeEach, expect, setSystemTime, test } from "bun:test";

import { getBuiltinModel } from "@earendil-works/pi-ai/providers/all";
import { type ContextUsage, SessionManager } from "@earendil-works/pi-coding-agent";
import * as Option from "effect/Option";
import * as Str from "effect/String";

import { type FooterContext, type FooterInputs, footerView } from "./index.ts";

const opus = getBuiltinModel("anthropic", "claude-opus-5-5");

const start = Date.parse("2025-01-01T09:00:00Z");

beforeEach(() => {
	setSystemTime(start);
});

afterEach(() => {
	setSystemTime();
});

const sgr = { warning: 33, error: 31 } as const;

const colored = (color: keyof typeof sgr, text: string) => `\u001B[${String(sgr[color])}m${text}\u001B[39m`;

const theme: FooterInputs["theme"] = {
	fg: (color, text) => (color === "warning" || color === "error" ? colored(color, text) : text),
	bold: (text) => text,
};

interface Response {
	readonly input: number;
	readonly cacheRead: number;
	readonly cacheWrite: number;
	readonly cost: number;
}

const respond = (session: SessionManager, { input, cacheRead, cacheWrite, cost }: Response) => {
	session.appendMessage({
		role: "assistant",
		content: [{ type: "text", text: "Done." }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-opus-5-5",
		usage: {
			input,
			output: 40,
			cacheRead,
			cacheWrite,
			totalTokens: input + 40 + cacheRead + cacheWrite,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
		},
		stopReason: "stop",
		timestamp: 0,
	});
};

interface Setup {
	readonly session: FooterContext["sessionManager"];
	readonly subscription: boolean;
	readonly context: ContextUsage | undefined;
	readonly autoCompact: () => boolean;
	readonly providers?: number;
	readonly statuses?: ReadonlyMap<string, string>;
	readonly model?: typeof opus;
	readonly withTheme?: FooterInputs["theme"];
}

const view = ({
	session,
	subscription,
	context,
	autoCompact,
	providers = 1,
	statuses = new Map(),
	model = opus,
	withTheme = theme,
}: Setup) =>
	footerView({
		ctx: {
			sessionManager: session,
			model,
			modelRegistry: { isUsingOAuth: () => subscription },
			getContextUsage: () => context,
		},
		data: {
			getGitBranch: () => "main",
			getExtensionStatuses: () => statuses,
			getAvailableProviderCount: () => providers,
		},
		theme: withTheme,
		home: Option.some("/home/me"),
		thinkingLevel: () => "high",
		autoCompact,
	});

const padded = (left: string, right: string, width: number) =>
	left + Str.repeat(width - Bun.stringWidth(left) - Bun.stringWidth(right))(" ") + right;

test("the stats line holds the cache hit rate, the cost, and the context use, and no token counters", () => {
	const session = SessionManager.inMemory("/work");

	respond(session, { input: 100, cacheRead: 0, cacheWrite: 900, cost: 0.5 });
	respond(session, { input: 50, cacheRead: 950, cacheWrite: 0, cost: 0.25 });

	const render = view({
		session,
		subscription: true,
		context: { tokens: 291_000, contextWindow: 1_000_000, percent: 29.1 },
		autoCompact: () => true,
	});

	expect(render(80)[1]).toBe(padded("0s CH95.0% $0.750 (sub) 29.1%/1.0M (auto)", "claude-opus-5-5 • high", 80));
});

test("a session without cache use or cost on an API key shows only the context use", () => {
	const session = SessionManager.inMemory("/work");

	respond(session, { input: 100, cacheRead: 0, cacheWrite: 0, cost: 0 });

	const render = view({ session, subscription: false, context: undefined, autoCompact: () => false });

	expect(render(60)[1]).toBe(padded("0s ?/1.0M", "claude-opus-5-5 • high", 60));
});

test("the context use turns to a warning above 70% and to an error above 90%", () => {
	const session = SessionManager.inMemory("/work");

	const lineAt = (percent: number) =>
		view({
			session,
			subscription: false,
			context: { tokens: percent * 10_000, contextWindow: 1_000_000, percent },
			autoCompact: () => false,
		})(60)[1];

	expect([lineAt(70), lineAt(70.5), lineAt(91)]).toEqual([
		padded("70.0%/1.0M", "claude-opus-5-5 • high", 60),
		padded(colored("warning", "70.5%/1.0M"), "claude-opus-5-5 • high", 60),
		padded(colored("error", "91.0%/1.0M"), "claude-opus-5-5 • high", 60),
	]);
});

test("a narrow terminal drops the model before the stats", () => {
	const session = SessionManager.inMemory("/work");

	const render = view({
		session,
		subscription: true,
		context: { tokens: 0, contextWindow: 1_000_000, percent: 0 },
		autoCompact: () => true,
	});

	const [, stats = ""] = render(28);

	expect(Bun.stripANSI(stats)).toBe("$0.000 (sub) 0.0%/1.0M (a...");
});

test("turning auto-compaction off shows once the session gains an entry", () => {
	const session = SessionManager.inMemory("/work");
	let enabled = true;

	const render = view({
		session,
		subscription: false,
		context: { tokens: 0, contextWindow: 1_000_000, percent: 0 },
		autoCompact: () => enabled,
	});

	const [, before] = render(60);

	enabled = false;
	respond(session, { input: 10, cacheRead: 0, cacheWrite: 0, cost: 0 });

	expect([before, render(60)[1]]).toEqual([
		padded("0.0%/1.0M (auto)", "claude-opus-5-5 • high", 60),
		padded("0s 0.0%/1.0M", "claude-opus-5-5 • high", 60),
	]);
});

test("with several providers the model names its provider when the line has room", () => {
	const render = view({
		session: SessionManager.inMemory("/work"),
		subscription: false,
		context: { tokens: 0, contextWindow: 1_000_000, percent: 0 },
		autoCompact: () => false,
		providers: 2,
	});

	expect([render(60)[1], render(40)[1]]).toEqual([
		padded("0.0%/1.0M", "(anthropic) claude-opus-5-5 • high", 60),
		padded("0.0%/1.0M", "claude-opus-5-5 • high", 40),
	]);
});

const lineWith = (clock: string) => padded(`${clock}?/1.0M`, "claude-opus-5-5 • high", 60);

test("the stats line opens with the time from the first message to the latest", () => {
	const session = SessionManager.inMemory("/work");
	const render = view({ session, subscription: false, context: undefined, autoCompact: () => false });

	const lineAfter = (elapsed: number) => {
		setSystemTime(start + elapsed);
		respond(session, { input: 10, cacheRead: 0, cacheWrite: 0, cost: 0 });

		return render(60)[1];
	};

	expect([render(60)[1], lineAfter(0), lineAfter(45_000), lineAfter(754_000), lineAfter(3_725_000)]).toEqual([
		lineWith(""),
		lineWith("0s "),
		lineWith("45s "),
		lineWith("12m34s "),
		lineWith("1h02m "),
	]);
});

test("entries after the latest message leave the clock where it was", () => {
	const session = SessionManager.inMemory("/work");

	respond(session, { input: 10, cacheRead: 0, cacheWrite: 0, cost: 0 });
	setSystemTime(start + 30_000);
	respond(session, { input: 10, cacheRead: 0, cacheWrite: 0, cost: 0 });
	setSystemTime(start + 600_000);
	session.appendThinkingLevelChange("low");

	const render = view({ session, subscription: false, context: undefined, autoCompact: () => false });

	expect(render(60)[1]).toBe(padded("30s ?/1.0M", "claude-opus-5-5 • high", 60));
});

const pwdIn = (cwd: string) =>
	view({
		session: SessionManager.inMemory(cwd),
		subscription: false,
		context: undefined,
		autoCompact: () => false,
	})(60)[0];

test("a working directory under home reads from ~", () => {
	expect([pwdIn("/home/me"), pwdIn("/home/me/code/app"), pwdIn("/home/meadow")]).toEqual([
		"~ (main)",
		"~/code/app (main)",
		"/home/meadow (main)",
	]);
});

test("the stats line drops the cache hit rate when the latest response sent no prompt tokens", () => {
	const session = SessionManager.inMemory("/work");

	respond(session, { input: 50, cacheRead: 950, cacheWrite: 0, cost: 0 });
	respond(session, { input: 0, cacheRead: 0, cacheWrite: 0, cost: 0 });

	const render = view({ session, subscription: false, context: undefined, autoCompact: () => false });

	expect(render(60)[1]).toBe(padded("0s ?/1.0M", "claude-opus-5-5 • high", 60));
});

test("extension statuses share one line, sorted by key, each on one line of single spaces", () => {
	const render = view({
		session: SessionManager.inMemory("/work"),
		subscription: false,
		context: undefined,
		autoCompact: () => false,
		statuses: new Map([
			["b", "two\nlines "],
			["a", "\ttab\r\nand   spaces"],
		]),
	});

	expect(render(60)[2]).toBe("tab and spaces two lines");
});

test("a Kimi Coding model counts as a subscription though it signs in with an API key", () => {
	const render = view({
		session: SessionManager.inMemory("/work"),
		subscription: false,
		context: undefined,
		autoCompact: () => false,
		model: { ...opus, provider: "kimi-coding" },
	});

	expect(render(60)[1]).toBe(padded("$0.000 (sub) ?/1.0M", "claude-opus-5-5 • high", 60));
});

const marked: FooterInputs["theme"] = {
	fg: (color, text) => (color === "dim" ? `<${text}>` : theme.fg(color, text)),
	bold: (text) => text,
};

test("the model stays dimmed after a colored context percent", () => {
	const render = view({
		session: SessionManager.inMemory("/work"),
		subscription: false,
		context: { tokens: 910_000, contextWindow: 1_000_000, percent: 91 },
		autoCompact: () => false,
		withTheme: marked,
	});

	const left = colored("error", "91.0%/1.0M");
	const right = "claude-opus-5-5 • high";
	const gap = Str.repeat(60 - Bun.stringWidth("91.0%/1.0M") - Bun.stringWidth(right))(" ");

	expect(render(60)[1]).toBe(`<${left}><${gap}${right}>`);
});

test("the footer reads the session's entries again only once its leaf moves", () => {
	const session = SessionManager.inMemory("/work");
	let reads = 0;

	const counted: FooterContext["sessionManager"] = {
		getCwd: () => session.getCwd(),
		getLeafId: () => session.getLeafId(),
		getSessionId: () => session.getSessionId(),
		getSessionName: () => session.getSessionName(),
		getEntries: () => {
			reads += 1;

			return session.getEntries();
		},
	};

	const render = view({ session: counted, subscription: false, context: undefined, autoCompact: () => false });

	render(60);
	render(60);

	const beforeMove = reads;

	respond(session, { input: 10, cacheRead: 0, cacheWrite: 0, cost: 0 });
	render(60);
	render(60);

	expect([beforeMove, reads]).toEqual([1, 2]);
});
