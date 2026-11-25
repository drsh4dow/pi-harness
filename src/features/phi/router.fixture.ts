import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Rec from "effect/Record";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";

import type { Run } from "#tools/driver/index.ts";
import type { MockAnthropic } from "./anthropic.fixture.ts";
import type { MockOpenAi } from "./openai.fixture.ts";
import documented from "./phi-router.config.json" with { type: "json" };

/** An account as `src/features/phi/phi-router.config.json` lists it, which the compiler checks the file against. */
interface Account {
	readonly name: string;
	readonly vendor: string;
	readonly scheme?: string;
	readonly loginFolder?: string;
	readonly keyCommand?: string;
	readonly lacks?: ReadonlyArray<string>;
}

const lists: {
	readonly clean: ReadonlyArray<Account>;
	readonly sealed: ReadonlyArray<Account>;
	readonly targetModel: Readonly<Record<string, string>>;
} = documented;

/** A Claude account's mock, by account name. */
type ClaudeMocks = Readonly<Record<string, Pick<MockAnthropic, "url">>>;

const refused = "http://127.0.0.1:9";

/** A Codex access token whose claims expire in 2100, unsigned. */
const codexToken = "eyJhbGciOiJub25lIn0.eyJleHAiOjQxMDI0NDQ4MDB9.fake";

const far = 4_102_444_800_000;

const loginFile = (account: Account): readonly [string, Schema.JsonObject] =>
	account.vendor === "anthropic"
		? [".credentials.json", { claudeAiOauth: { accessToken: `fake-${account.name}-access`, expiresAt: far } }]
		: ["auth.json", { tokens: { access_token: codexToken, account_id: `fake-${account.name}` } }];

const faked = (claude: ClaudeMocks, logins: string) => (account: Account) => {
	const mock = Rec.get(claude, account.name);

	const endpoint = Option.getOrElse(
		Option.map(mock, ({ url }) => url),
		() => refused,
	);

	if (account.loginFolder === undefined) {
		return { ...account, keyCommand: `printf %s fake-${account.name}-key`, endpoint };
	}

	return { ...account, loginFolder: `${logins}/${account.name}`, endpoint };
};

const checkoutOf = (env: Readonly<Record<string, string | undefined>>) => {
	const checkout = env["PHI_ROUTER_CHECKOUT"];

	if (checkout === undefined || !Str.startsWith("/")(checkout)) {
		throw new Error("PHI_ROUTER_CHECKOUT must name a phi-router checkout by its absolute path");
	}

	return checkout;
};

export const routerSetup = ({
	env,
	claude,
	openai,
	baaRepos = () => [],
}: {
	readonly env: Readonly<Record<string, string | undefined>>;
	readonly claude: ClaudeMocks;
	readonly openai: Pick<MockOpenAi, "url">;
	readonly baaRepos?: (project: string) => ReadonlyArray<string>;
}) => ({
	checkout: checkoutOf(env),
	files: ({ home, project }: { readonly home: string; readonly project: string }) => {
		const logins = ".local/share/fake-logins";
		const fake = faked(claude, `${home}/${logins}`);
		const withLogins = Arr.filter([...lists.clean, ...lists.sealed], ({ loginFolder }) => loginFolder !== undefined);

		const config = {
			judge: { endpoint: openai.url, keyCommand: "printf %s fake-judge-key" },
			clean: Arr.map(lists.clean, fake),
			sealed: Arr.map(lists.sealed, fake),
			targetModel: lists.targetModel,
			baaRepos: baaRepos(project),
		};

		const loginFiles = Arr.map(withLogins, (account) => {
			const [file, json] = loginFile(account);

			return [`${logins}/${account.name}/${file}`, json] as const;
		});

		return Rec.fromEntries([[".config/phi-router/config.json", config], ...loginFiles]);
	},
});

/** The policy's stub for a sealed part, which opens the text phi-router puts in its place. */
const withheld = "[withheld: holds patient identifiers, handled on the HIPAA account]";

const MessagesOf = Schema.fromJsonString(Schema.Struct({ messages: Schema.Json }));

const decodeMessages = Schema.decodeUnknownOption(MessagesOf);

const encodeJson = Schema.encodeOption(Schema.fromJsonString(Schema.Json));

export const holdsStub = (body: string) => {
	const messages = Option.flatMap(decodeMessages(body), (decoded) => encodeJson(decoded.messages));

	return Option.exists(messages, Str.includes(withheld));
};

export const routerCommand = (checkout: string) => `${checkout}/plugins/claude/bin/phi-router`;

const Line = Schema.Struct({
	account: Schema.String,
	lane: Schema.Literals(["clean", "sealed"]),
	model: Schema.String,
	reason: Schema.String,
	session: Schema.String,
	substitute: Schema.Boolean,
});

const decodeLine = Schema.decodeUnknownOption(Schema.fromJsonString(Line));

export const laneLog = (run: Pick<Run, "home">) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const file = `${run.home}/.local/state/phi-router/lanes.jsonl`;
		const exists = yield* fs.exists(file);
		const text = exists ? yield* fs.readFileString(file) : "";
		const lines = Arr.filter(Str.split(text, "\n"), Str.isNonEmpty);

		return Arr.getSomes(Arr.map(lines, (line) => decodeLine(line)));
	}).pipe(Effect.orDie);

const Status = Schema.fromJsonString(Schema.Struct({ pinned: Schema.Boolean }));

const decodeStatus = Schema.decodeUnknownOption(Status);

export const pinnedOf = ({
	run,
	checkout,
	session,
}: {
	readonly run: Pick<Run, "exec">;
	readonly checkout: string;
	readonly session: string;
}) =>
	Effect.gen(function* () {
		const { output } = yield* run.exec([routerCommand(checkout), "status", "--session", session]);

		return Option.map(decodeStatus(Str.trim(output)), ({ pinned }) => pinned);
	});
