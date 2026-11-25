import { expect, test } from "bun:test";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as Option from "effect/Option";
import * as Rec from "effect/Record";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";

import { laneLog, routerSetup } from "./router.fixture.ts";

const home = "/home/run";

const project = `${home}/project`;

const mocks = {
	"ultra-a": { url: "http://127.0.0.1:4001" },
	ent: { url: "http://127.0.0.1:4003" },
};

const judge = { url: "http://127.0.0.1:4100/v1" };

const setupIn = (checkout: string) =>
	routerSetup({
		env: { PHI_ROUTER_CHECKOUT: checkout },
		claude: mocks,
		openai: judge,
		baaRepos: (folder) => [folder],
	});

const files = setupIn("/checkout").files({ home, project });

const Account = Schema.Struct({
	name: Schema.String,
	vendor: Schema.String,
	endpoint: Schema.String,
	loginFolder: Schema.optional(Schema.String),
	keyCommand: Schema.optional(Schema.String),
});

type Account = typeof Account.Type;

const Config = Schema.Struct({
	judge: Schema.Struct({ endpoint: Schema.String }),
	clean: Schema.Array(Account),
	sealed: Schema.Array(Account),
	baaRepos: Schema.Array(Schema.String),
});

const ClaudeLogin = Schema.Struct({ claudeAiOauth: Schema.Struct({ accessToken: Schema.String }) });

const CodexLogin = Schema.Struct({ tokens: Schema.Struct({ access_token: Schema.String }) });

const fileAt = (path: string) => Option.getOrNull(Rec.get(files, path));

const config = Schema.decodeUnknownEffect(Config)(fileAt(".config/phi-router/config.json"));

const accounts = Effect.map(config, ({ clean, sealed }) => [...clean, ...sealed]);

const mockOf = ({ name }: Account) =>
	Option.map(
		Arr.findFirst(Rec.toEntries(mocks), ([mocked]) => mocked === name),
		([, mock]) => mock,
	);

const loginFoldersOf = (vendor: string) =>
	Effect.map(accounts, (all) =>
		Arr.flatMap(all, (account) =>
			account.vendor === vendor && account.loginFolder !== undefined ? [account.loginFolder] : [],
		),
	);

const keyCommandsOf = (all: ReadonlyArray<Account>) =>
	Arr.flatMap(all, ({ keyCommand }) => (keyCommand === undefined ? [] : [keyCommand]));

const inHome = (folder: string) => Str.slice(home.length + 1)(folder);

const refuses = (endpoint: string) => Effect.map(Effect.exit(HttpClient.get(endpoint)), Exit.isFailure);

test("the scenario's phi-router reaches only loopback: each Claude account its mock, the judge the OpenAI mock", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const decoded = yield* config;
			const all = yield* accounts;

			const mocked = Arr.getSomes(
				Arr.map(all, (account) => Option.map(mockOf(account), ({ url }) => [account.endpoint, url])),
			);

			expect(decoded.judge.endpoint).toBe(judge.url);
			expect(mocked).toEqual([
				[mocks["ultra-a"].url, mocks["ultra-a"].url],
				[mocks.ent.url, mocks.ent.url],
			]);
			expect(Arr.every(all, ({ endpoint }) => Str.startsWith("http://127.0.0.1:")(endpoint))).toBe(true);
		}),
	));

test("an account no mock stands for gets an endpoint that refuses a connection", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const all = yield* accounts;
			const unmocked = Arr.filter(all, (account) => Option.isNone(mockOf(account)));
			const refused = yield* Effect.forEach(unmocked, ({ endpoint }) => refuses(endpoint));

			expect(Arr.map(unmocked, ({ name }) => name)).toEqual(["ultra-b", "codex", "openai"]);
			expect(refused).toEqual([true, true, true]);
		}).pipe(Effect.provide(FetchHttpClient.layer)),
	));

test("a Claude account's login folder sits in the run's HOME and holds a fake .credentials.json", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const folders = yield* loginFoldersOf("anthropic");

			const logins = yield* Effect.forEach(folders, (folder) =>
				Schema.decodeUnknownEffect(ClaudeLogin)(fileAt(`${inHome(folder)}/.credentials.json`)),
			);

			expect(folders).toEqual([`${home}/.local/share/fake-logins/ultra-a`, `${home}/.local/share/fake-logins/ent`]);
			expect(Arr.map(logins, ({ claudeAiOauth }) => claudeAiOauth.accessToken)).toEqual([
				"fake-ultra-a-access",
				"fake-ent-access",
			]);
		}),
	));

test("a Codex account's login folder sits in the run's HOME and holds an auth.json with a token", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const folders = yield* loginFoldersOf("openai");

			const logins = yield* Effect.forEach(folders, (folder) =>
				Schema.decodeUnknownEffect(CodexLogin)(fileAt(`${inHome(folder)}/auth.json`)),
			);

			expect(folders).toEqual([`${home}/.local/share/fake-logins/codex`]);
			expect(Arr.map(logins, ({ tokens }) => Str.isNonEmpty(tokens.access_token))).toEqual([true]);
		}),
	));

test("an account without a login folder gets a key command that prints a fake key", () =>
	Effect.runPromise(
		Effect.map(accounts, (all) => {
			expect(keyCommandsOf(all)).toEqual(["printf %s fake-ultra-b-key", "printf %s fake-openai-key"]);
		}),
	));

test("the scenario's BAA repos, given the run's project, reach phi-router's config", () =>
	Effect.runPromise(
		Effect.map(config, ({ baaRepos }) => {
			expect(baaRepos).toEqual([project]);
		}),
	));

test("the checkout is the folder PHI_ROUTER_CHECKOUT names by its absolute path, and a relative one is refused", () => {
	expect(setupIn("/checkout").checkout).toBe("/checkout");
	expect(() => setupIn("phi-router")).toThrow(
		"PHI_ROUTER_CHECKOUT must name a phi-router checkout by its absolute path",
	);
});

const laneLine = (account: string, lane: string) =>
	`{"account":"${account}","lane":"${lane}","model":"claude-opus-5-5","reason":"${lane}","session":"s-1","substitute":false}`;

const laneLogHolding = (text: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const runHome = yield* fs.makeTempDirectoryScoped();
		const state = `${runHome}/.local/state/phi-router`;

		yield* fs.makeDirectory(state, { recursive: true });
		yield* fs.writeFileString(`${state}/lanes.jsonl`, text);

		return yield* laneLog({ home: runHome });
	});

test("laneLog reads phi-router's lane log in the run's HOME oldest first, past a line it cannot read", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const lines = yield* laneLogHolding(
				Arr.join([laneLine("ultra-a", "clean"), "not a lane", laneLine("ent", "sealed"), ""], "\n"),
			);

			expect(Arr.map(lines, ({ account, lane }) => [account, lane])).toEqual([
				["ultra-a", "clean"],
				["ent", "sealed"],
			]);
		}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
	));

test("laneLog of a run whose phi-router wrote no lane log is empty", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const runHome = yield* fs.makeTempDirectoryScoped();
			const lines = yield* laneLog({ home: runHome });

			expect(lines).toEqual([]);
		}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
	));
