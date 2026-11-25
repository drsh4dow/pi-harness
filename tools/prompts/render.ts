import * as Arr from "effect/Array";
import * as Schema from "effect/Schema";

const AnthropicPayload = Schema.Struct({
	system: Schema.Array(Schema.Struct({ text: Schema.String })),
});

const Instruction = Schema.Struct({
	role: Schema.Literals(["developer", "system"]),
	content: Schema.String,
});

const InputItem = Schema.Union([Instruction, Schema.Struct({})]);

const ResponsesPayload = Schema.Struct({ input: Schema.Array(InputItem) });

export const SystemPromptPayload = Schema.Union([AnthropicPayload, ResponsesPayload]);

export type SystemPromptPayload = typeof SystemPromptPayload.Type;

const isInstruction = Schema.is(Instruction);

const systemBlocks = (payload: SystemPromptPayload) =>
	"system" in payload
		? Arr.map(payload.system, (block) => block.text)
		: Arr.map(Arr.filter(payload.input, isInstruction), (item) => item.content);

export interface Capture {
	readonly title: string;
	readonly whichPi: string;
	readonly payload: SystemPromptPayload;
}

export interface Report {
	readonly piVersion: string;
	readonly project: string;
	readonly captures: ReadonlyArray<Capture>;
}

const fence = (body: string) => `\`\`\`\`text\n${body}\n\`\`\`\``;

const section = (capture: Capture) => {
	const blocks = systemBlocks(capture.payload);

	return [`## ${capture.title}`, "", capture.whichPi, "", fence(Arr.join(blocks, "\n\n")), ""];
};

export const render = (report: Report) => {
	const lines = [
		"# System prompts",
		"",
		`The full system prompt each agent receives, copied from the request pi ${report.piVersion} builds. Captured in \`${report.project}\`.`,
		"",
		...Arr.flatMap(report.captures, section),
	];

	return Arr.join(lines, "\n");
};
