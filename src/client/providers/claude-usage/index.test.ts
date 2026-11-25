import { expect, test } from "bun:test";

import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Layer from "effect/Layer";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import { backAt, ClaudeUsage, claudeUsageLayer } from "./index.ts";

interface Sent {
	readonly url: string;
	readonly authorization: string | undefined;
	readonly body: string;
}

const answering = (reply: () => Response) => {
	const sent: Array<Sent> = [];

	const transport = HttpClient.make((request, url) => {
		const body = Match.value(request.body).pipe(
			Match.tag("Uint8Array", ({ body: bytes }) => new TextDecoder().decode(bytes)),
			Match.orElse(() => ""),
		);

		sent.push({ url: url.href, authorization: request.headers["authorization"], body });

		return Effect.succeed(HttpClientResponse.fromWeb(request, reply()));
	});

	const layer = claudeUsageLayer.pipe(Layer.provide(Layer.succeed(HttpClient.HttpClient, transport)));

	return { sent, layer };
};

const token = Redacted.make("sk-ant-oat01-test");

const resets = DateTime.makeUnsafe("2026-11-11T22:59:59.645534+00:00");

const ultraPage = `{
	"five_hour": null,
	"seven_day": { "utilization": 100.0, "resets_at": "2026-11-11T22:59:59.645534+00:00" },
	"tangelo": null,
	"limits": [
		{ "kind": "weekly_all", "group": "weekly", "percent": 100, "resets_at": "2026-11-11T22:59:59.645534+00:00", "scope": null, "is_active": true },
		{ "kind": "weekly_scoped", "group": "weekly", "percent": 10, "resets_at": "2026-11-11T22:59:59.645534+00:00", "scope": { "model": { "display_name": "Fable" }, "surface": null }, "is_active": false }
	],
	"spend": {
		"used": { "amount_minor": 0, "currency": "USD", "exponent": 2 },
		"limit": { "amount_minor": 4000, "currency": "USD", "exponent": 2 },
		"enabled": false,
		"disabled_reason": "out_of_credits"
	}
}`;

const enterprisePage = `{
	"limits": [],
	"spend": {
		"used": { "amount_minor": 884857, "currency": "USD", "exponent": 2 },
		"limit": { "amount_minor": 929325, "currency": "USD", "exponent": 2 },
		"enabled": true,
		"disabled_reason": null
	}
}`;

const scopeRefusal = `{"type":"error","error":{"type":"permission_error","message":"OAuth token does not meet scope requirement user:profile"}}`;

const weeklyLimitHit = () =>
	new Response(`{"type":"error","error":{"type":"rate_limit_error","message":"limit"}}`, {
		status: 429,
		headers: {
			"anthropic-ratelimit-unified-status": "rejected",
			"anthropic-ratelimit-unified-7d-utilization": "1.0",
			"anthropic-ratelimit-unified-7d-reset": "1794438000",
			"anthropic-ratelimit-unified-7d-status": "rejected",
		},
	});

const badKey = () => new Response(`{"type":"error","error":{"message":"invalid x-api-key"}}`, { status: 401 });

const ProbeSent = Schema.Struct({ model: Schema.String, max_tokens: Schema.Finite });

const decodeSent = Schema.decodeEffect(Schema.fromJsonString(ProbeSent));

const decodeSystem = Schema.decodeEffect(Schema.fromJsonString(Schema.Struct({ system: Schema.String })));

const usd = (minor: number) => ({ minor, exponent: 2, currency: "USD" });

const ultraExtra = { used: usd(0), cap: Option.some(usd(4000)), off: Option.some("out_of_credits") };

const enterpriseExtra = { used: usd(884_857), cap: Option.some(usd(929_325)), off: Option.none() };

const ultra = answering(() => new Response(ultraPage));

const enterprise = answering(() => new Response(enterprisePage)).layer;

const scopeless = answering(() => new Response(scopeRefusal, { status: 403 })).layer;

const rejected = answering(badKey).layer;

const limited = answering(weeklyLimitHit);

const probed = answering(weeklyLimitHit);

const everyClaim = answering(
	() =>
		new Response("{}", {
			headers: {
				"anthropic-ratelimit-unified-5h-utilization": "0.25",
				"anthropic-ratelimit-unified-5h-reset": "1794400000",
				"anthropic-ratelimit-unified-7d-utilization": "0.5",
				"anthropic-ratelimit-unified-overage-utilization": "0",
			},
		}),
).layer;

test("the usage page gives each plan window, scoped to a model when it is one, and the extra usage", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const claude = yield* ClaudeUsage;
			const got = yield* claude.plan(token);

			expect(got).toEqual({
				windows: [
					{ name: "weekly", percent: 100, resetsAt: Option.some(resets) },
					{ name: "weekly · Fable", percent: 10, resetsAt: Option.some(resets) },
				],
				spend: Option.some(ultraExtra),
			});
			expect(ultra.sent).toEqual([
				{ url: "https://api.anthropic.com/api/oauth/usage", authorization: "Bearer sk-ant-oat01-test", body: "" },
			]);
		}).pipe(Effect.provide(ultra.layer)),
	));

test("an Enterprise page with no plan windows still gives its extra usage, which is on", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const claude = yield* ClaudeUsage;
			const got = yield* claude.plan(token);

			expect(got).toEqual({
				windows: [],
				spend: Option.some(enterpriseExtra),
			});
		}).pipe(Effect.provide(enterprise)),
	));

test("a token without the profile scope fails with the API's own reason", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const claude = yield* ClaudeUsage;
			const got = yield* Effect.flip(claude.plan(token));

			expect(got.message).toBe(
				"Claude usage page answered HTTP 403: OAuth token does not meet scope requirement user:profile",
			);
		}).pipe(Effect.provide(scopeless)),
	));

test("a probe the weekly limit rejects still reads the limit from the headers, and sends a one-token message", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const claude = yield* ClaudeUsage;
			const got = yield* claude.probe({ token, model: "claude-opus-5-5" });

			expect(got).toEqual([
				{ name: "weekly", percent: 100, resetsAt: Option.some(DateTime.makeUnsafe(1_794_438_000_000)) },
			]);
			expect(limited.sent).toHaveLength(1);
			expect(limited.sent[0]?.url).toBe("https://api.anthropic.com/v1/messages");

			const bodies = yield* Effect.forEach(limited.sent, ({ body }) => decodeSent(body));

			expect(bodies).toEqual([{ model: "claude-opus-5-5", max_tokens: 1 }]);
		}).pipe(Effect.provide(limited.layer)),
	));

test("a probe calls itself Claude Code, the only caller Anthropic serves a subscription token", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const claude = yield* ClaudeUsage;

			yield* claude.probe({ token, model: "claude-opus-5-5" });

			const bodies = yield* Effect.forEach(probed.sent, ({ body }) => decodeSystem(body));

			expect(bodies).toEqual([{ system: "You are Claude Code, Anthropic's official CLI for Claude." }]);
		}).pipe(Effect.provide(probed.layer)),
	));

test("a probe reply gives one window per rate-limit claim in its headers, in the usage page's words", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const claude = yield* ClaudeUsage;
			const got = yield* claude.probe({ token, model: "claude-opus-5-5" });

			expect(got).toEqual([
				{ name: "5-hour", percent: 25, resetsAt: Option.some(DateTime.makeUnsafe(1_794_400_000_000)) },
				{ name: "weekly", percent: 50, resetsAt: Option.none() },
				{ name: "extra usage", percent: 0, resetsAt: Option.none() },
			]);
		}).pipe(Effect.provide(everyClaim)),
	));

test("a probe reply with no rate-limit headers fails with the status and reason", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const claude = yield* ClaudeUsage;
			const got = yield* Effect.flip(claude.probe({ token, model: "claude-opus-5-5" }));

			expect(got.message).toBe("Claude probe answered HTTP 401: invalid x-api-key");
		}).pipe(Effect.provide(rejected)),
	));

const limitedAt = DateTime.makeUnsafe("2026-11-18T11:04:37Z");

const backs = [
	{
		name: "the latest reset of a rejected claim, not of an allowed one",
		headers: {
			"anthropic-ratelimit-unified-status": "rejected",
			"anthropic-ratelimit-unified-reset": "1795000000",
			"anthropic-ratelimit-unified-5h-status": "allowed",
			"anthropic-ratelimit-unified-5h-reset": "1797000000",
			"anthropic-ratelimit-unified-7d-status": "rejected",
			"anthropic-ratelimit-unified-7d-reset": "1796000000",
		},
		back: DateTime.makeUnsafe(1_796_000_000_000),
	},
	{
		name: "retry-after when it is later than every reset",
		headers: {
			"anthropic-ratelimit-unified-status": "rejected",
			"anthropic-ratelimit-unified-reset": "1795000000",
			"retry-after": "99999999",
		},
		back: DateTime.add(limitedAt, { seconds: 99_999_999 }),
	},
	{
		name: "retry-after alone",
		headers: { "retry-after": "30" },
		back: DateTime.add(limitedAt, { seconds: 30 }),
	},
	{
		name: "a minute when the headers name no reset",
		headers: { "anthropic-ratelimit-unified-status": "rejected", "retry-after": "soon" },
		back: DateTime.add(limitedAt, { minutes: 1 }),
	},
];

test.each(backs)("a 429 says its account is back at $name", ({ headers, back }) => {
	expect(backAt({ headers: new Headers(headers), now: limitedAt })).toEqual(back);
});
