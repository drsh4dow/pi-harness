import type { AssistantMessage } from "@earendil-works/pi-ai";

const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

export const assistantReply = ({
	text,
	...overrides
}: Partial<AssistantMessage> & { readonly text: string }): AssistantMessage => ({
	role: "assistant",
	content: [{ type: "text", text }],
	api: "anthropic-messages",
	provider: "anthropic",
	model: "claude-opus-5-5",
	usage: { ...zero, totalTokens: 0, cost: { ...zero, total: 0 } },
	stopReason: "stop",
	timestamp: 0,
	...overrides,
});
