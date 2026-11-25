import { Type } from "typebox";

export const HandleRef = Type.Object({ ref: Type.String() });

const Refs = Type.Array(HandleRef, { minItems: 1 });

export const RefsParams = Type.Object({ of: Refs });

const CommandName = Type.String({
	pattern: String.raw`\S`,
	description:
		"A few words that tell this command apart from the others you run, such as `dev server` or `unit tests`. The human sees it in their list of running agents and on its pane.",
});

export const ServeParams = Type.Object({
	name: CommandName,
	command: Type.String({
		minLength: 1,
		description:
			"Run it as is and let it print, rather than redirecting, filtering or silencing it. Pipe it through `tee <file>` to keep a copy. A loop should print one line per pass, so the pane shows it is alive.",
	}),
	ready: Type.Optional(
		Type.String({ description: "Output text that means it is up. The call returns once it appears (60 s at most)." }),
	),
});

export const WatchParams = Type.Object({
	name: CommandName,
	command: Type.String({
		minLength: 1,
		description:
			"Run it as is and let it print, rather than redirecting, filtering or silencing it. The wake already carries what you need. A loop should print one line per pass, so the pane shows it is alive.",
	}),
	deadline: Type.Optional(
		Type.Number({ exclusiveMinimum: 0, description: "Seconds. Only for commands that might hang." }),
	),
});

export const GroupParams = Type.Object({
	name: Type.String({
		pattern: String.raw`\S`,
		description:
			"A few words for what the group's work has in common, such as `principles eval`. The human sees its members under it in their list of running agents.",
	}),
	of: Refs,
});

/**
 * Seconds. The default keeps a wait that runs out inside the 5-minute prompt cache, so the next call reads it warm. The
 * cap bounds one call; a longer wait is a turn's end, which costs no call.
 */
export const waitTimeout = { default: 240, max: 3600 } as const;

const WaitRefs = Type.Array(HandleRef, {
	minItems: 1,
	description: "Wait only for these jobs. Without it, for any job you hold.",
});

const WaitSeconds = Type.Number({
	exclusiveMinimum: 0,
	maximum: waitTimeout.max,
	description: `Seconds, ${String(waitTimeout.default)} by default.`,
});

export const WaitParams = Type.Object({ of: Type.Optional(WaitRefs), timeout: Type.Optional(WaitSeconds) });

export const promptGuidelines = [
	"Starting work returns a handle at once. Its result reaches you as a wake once you end your turn, or in the reply of a `wait` call, never while another tool call runs.",
];

/** Only an agent that may start delegates gets these, since pi shows a tool's guidelines only while the tool is active. */
export const delegateGuidelines = [
	"Decide what goes to a delegate before you start, while your context is small. Work of a handful of tool calls, or that needs context a task message cannot carry, stays with you.",
	"Reading of more than about 1,500 lines, or of three or more areas, goes to delegates, one per area in parallel, each asked for the facts you need with file, line, and quotes. This holds when the reading serves your own plan. Context spent on reading never comes back, so read yourself only what you will edit.",
	"Run independent parts, where no two write the same file and none needs another's result, as delegates started in one turn with one `group` name, and use the **swarm** skill for three or more leaves.",
	"Write each delegate task message as the delegate's whole world. Name the task, the inputs as file paths, what counts as done, and the shape of the answer.",
	"Give each delegate that commits its own branch or worktree, and start it there with cwd.",
	"A delegate's answer is a claim. Check what you will act on against the real artifact before you report it as done.",
	"A delegate that reports something missing hands you a gap. Supply it in a fresh delegate's message. If only someone above you can settle it, it is your own open question now.",
];

/** Only an agent that may start owners gets these. */
export const ownerGuidelines = [
	"Hand implementation to one owner per slice when a slice has written acceptance criteria or the work has two or more slices. Coupled code gets one owner.",
	"An owner you start can start delegates of its own, so hand it its whole slice. A leaf cannot.",
];

export const lastLevelGuideline =
	"Your delegates cannot start delegates of their own, so give each one work it can finish alone.";
