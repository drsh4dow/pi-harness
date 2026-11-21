# TypeScript

The dunify reference for TypeScript. Checked on TypeScript 7.0.2, oxlint 1.94.0, oxlint-tsgolint 7.0.2007, oxfmt 0.79.0, dependency-cruiser 18.8.0, ast-grep 0.51.3 and Vite 8.3.8.

## Source root and edge file

The source root is `src/`. A folder's edge file is `index.ts`, or `index.tsx` when it holds JSX, at every depth inside a feature, a client or `primitives/`. The ceiling's `import/no-relative-parent-imports` rejects every `../` import, so cross folders with package.json subpath imports, one entry for `shared` and one per runtime directory, such as `"imports": { "#shared/*": "./src/shared/*", "#web/*": "./src/web/*" }`. Write the extension in each import, and set `allowImportingTsExtensions` with `noEmit` in the tsconfig. The compiler, oxlint, dependency-cruiser and Vite all resolve them.

For a hot spot, replace the registry with Vite's `import.meta.glob("./features/*/index.tsx", { eager: true })`, a path relative to the calling file, and add `"types": ["vite/client"]` to the tsconfig so the compiler knows `glob`.

A contract's schemas need a schema library, since anti-slop's `no-runtime-typeof` rejects a hand-written type guard. Where the repo has none, put the pick of one in the questions of step 2.

## Ceiling

Install `oxlint`, `oxlint-tsgolint` and `oxfmt`. Turn on every stable category in `.oxlintrc.json`:

```json
{
	"$schema": "./node_modules/oxlint/configuration_schema.json",
	"plugins": ["eslint", "typescript", "unicorn", "oxc", "import", "promise"],
	"categories": {
		"correctness": "error",
		"suspicious": "error",
		"pedantic": "error",
		"perf": "error",
		"style": "error",
		"restriction": "error"
	},
	"options": { "typeAware": true, "typeCheck": true, "reportUnusedDisableDirectives": "error" },
	"overrides": [{ "files": ["**/*.test.ts"], "plugins": ["vitest"] }]
}
```

- `plugins` replaces the default set, so keep `eslint` and `oxc` in it. Add `node` for a runtime on Node, `react`, `react-perf` and `jsx-a11y` for React, and `nextjs` or `vue` for those. Give `vitest` or `jest` to test files only, as above, since `vitest/require-hook` fires on app code.
- List the rules with `oxlint --rules --format=json`. Each entry has `scope`, `category` and `type_aware`, and `scope` spells `jsx_a11y` and `react_perf` with underscores. Before you add JS plugins or turn a rule off, `number_of_rules` from `oxlint --format=json src` equals the non-nursery rule count of your plugins.
- With `typeCheck` on, oxlint reports compiler errors as codes such as `typescript(TS2322)`, so the check needs no separate `tsc` run.
- Fetch https://raw.githubusercontent.com/dmmulroy/anti-slop/main/skills/install-anti-slop/SKILL.md on every run and follow it. Add its vendored path to `ignorePatterns` in `.oxfmtrc.json` as well, or `oxfmt --check` fails on it.

TypeScript 7 already defaults `strict`, `noUncheckedSideEffectImports` and `forceConsistentCasingInFileNames` to true. Add the rest to `compilerOptions`:

```json
"noUncheckedIndexedAccess": true, "exactOptionalPropertyTypes": true, "noPropertyAccessFromIndexSignature": true,
"noImplicitOverride": true, "noImplicitReturns": true, "noFallthroughCasesInSwitch": true,
"noUnusedLocals": true, "noUnusedParameters": true, "allowUnreachableCode": false, "allowUnusedLabels": false,
"verbatimModuleSyntax": true, "isolatedModules": true, "erasableSyntaxOnly": true
```

oxlint reads `//` comments in `.oxlintrc.json`, so write each ledger reason beside its rule, as in `"oxc/no-async-await": "off", // collides with promise/prefer-await-to-then`. The ledger starts with the size rules:

```jsonc
"rules": {
	"eslint/max-lines": ["error", { "max": 600 }],
	"eslint/max-lines-per-function": "off", // the user's standing choice
	"eslint/max-statements": "off", // the user's standing choice
}
```

`eslint/complexity`, `eslint/max-depth` and `eslint/max-params` stay on at their defaults, 20, 4 and 3. A file cap exception is an `overrides` entry for that one file that sets `eslint/max-lines` to its line count, with the reason.

## Known collisions

Each pair below failed on a file at the versions above. Treat the list as a start, and prove each pair with a file before you turn a side off.

- `import/no-default-export` with `import/no-named-export` and `import/prefer-default-export`.
- `oxc/no-async-await` with `typescript/promise-function-async` and `promise/prefer-await-to-then`.
- `oxc/no-rest-spread-properties` with `eslint/prefer-object-spread`.
- `unicorn/number-literal-case` with oxfmt, which writes `0xFF` as `0xff`.
- `vitest/prefer-called-once` with `vitest/prefer-called-times`.
- `vitest/prefer-strict-boolean-matchers` with `vitest/prefer-to-be-truthy` and `vitest/prefer-to-be-falsy`.
- `vitest/no-importing-vitest-globals` with `vitest/prefer-importing-vitest-globals`.
- `vitest/require-test-timeout`, which demands a numeric literal, with `eslint/no-magic-numbers`.
- `eslint/func-style` with `react/function-component-definition`.
- `react/jsx-no-literals` with `react/jsx-curly-brace-presence`.
- `eslint/no-void` with `typescript/no-floating-promises`, `typescript/no-misused-promises` and `promise/prefer-await-to-then`, on a promise started where nothing awaits it.

`anti-slop/require-safety-comment-for-type-assertion` and the comment check together reject every `as`. That is a ban and no collision, so both stay on unless the user says otherwise.

No oxlint rule demands a doc comment. The `jsdoc` rules check only blocks that the comment check rejects, so leave the `jsdoc` plugin out.

Keep both sides of these pairs on, since one file passes both: `eslint/no-ternary` and `unicorn/prefer-ternary` with an early return, `unicorn/no-nested-ternary` and oxfmt, which keeps the parentheses, `eslint/sort-imports` and oxfmt without `sortImports`, and `typescript/dot-notation` and `noPropertyAccessFromIndexSignature`. `eslint/no-duplicate-imports` and `import/consistent-type-specifier-style` pass together once the first has `{ "allowSeparateTypeImports": true }`.

## Boundaries

Install `dependency-cruiser` and `@swc/core`. dependency-cruiser parses TypeScript through the compiler API of TypeScript 6 and older. Under TypeScript 7 it cruises 0 modules and exits 0 unless `parser` is `"swc"`, so confirm its summary counts your modules. Write one `forbidden` rule per layout row, with the row's Imports column in `to.pathNot`. `$1` reuses the runtime directory that `from.path` captured, which is `src/` itself for a project with one runtime, and the rule catches `import type` edges too. Run it as `depcruise src --output-type err-long`, which prints each rule's `comment` under its violation and exits with the violation count. The rows for a runtime directory, the contract and `client/` in `.dependency-cruiser.json`, a format the ceiling does not lint, hold for one runtime and for several:

```json
{
	"forbidden": [
		{
			"name": "runtimes-apart",
			"severity": "error",
			"comment": "A runtime directory imports only its own files and shared/. Cross to another runtime through a contract in shared/.",
			"from": { "path": "^src/(?!shared/|features/|client/|primitives/)([^/]+)/" },
			"to": { "path": "^src/", "pathNot": ["^src/$1/", "^src/shared/"] }
		},
		{
			"name": "contract-imports-no-runtime",
			"severity": "error",
			"comment": "shared/ holds types and schemas, and imports only shared/.",
			"from": { "path": "^src/shared/" },
			"to": { "path": "^src/", "pathNot": ["^src/shared/"] }
		},
		{
			"name": "client-imports",
			"severity": "error",
			"comment": "client/ imports only primitives/ and shared/. Call client/ from a feature.",
			"from": { "path": "^(src/(?:(?!features/|client/|primitives/)[^/]+/|))client/" },
			"to": { "path": "^src/", "pathNot": ["^$1(client|primitives)/", "^src/shared/"] }
		}
	],
	"options": {
		"parser": "swc",
		"tsPreCompilationDeps": true,
		"tsConfig": { "fileName": "tsconfig.json" },
		"doNotFollow": { "path": "node_modules" }
	}
}
```

Add one rule that holds the edge file at every depth. `from.path` captures the importer's folders, one per group. The first `pathNot` entry allows a file directly in one of those folders, or the `index.ts` of a folder directly in one of them. The second allows a file directly in `features/`, `client/`, `primitives/` or `shared/`, or the edge file of a folder there, since the row rules judge those imports. Six folder levels below `src/` get a group each, and an import from deeper fails closed. dependency-cruiser refuses a quantifier inside a quantified group as an unsafe regex, so each optional part is written `(x|)`.

dependency-cruiser pastes each captured folder name into `pathNot` as regex, and it has no escape. So `from.pathNot` skips an importer below a folder whose name holds a regex character, which would otherwise reject `[id]/page.ts` importing `./data.ts`. Imports from those folders go unchecked. Name folders with letters, digits, `-` and `_`. Where a framework names them, such as Next.js routes, each route file imports only edge files, and you list those folders in `CODING_STANDARDS.md` as checked by review.

```json
{
	"name": "edge-file",
	"severity": "error",
	"comment": "Import a folder from outside it only through its edge file, index.ts.",
	"from": {
		"path": "^(src/)([^/]+/|)([^/]+/|)([^/]+/|)([^/]+/|)([^/]+/|)([^/]+/|)(.*/|)[^/]+$",
		"pathNot": "[\\[\\]()+*?^$|{}\\\\.][^/]*/"
	},
	"to": {
		"path": "^src/",
		"pathNot": [
			"^$1(?:$2(?:$3(?:$4(?:$5(?:$6(?:$7(?:$8|)|)|)|)|)|)|)[^/]+(?:/index\\.tsx|/index\\.ts|)$",
			"^src/(?:(?!features/|client/|primitives/)[^/]+/|)(?:features|client|primitives|shared)/[^/]+(?:/index\\.tsx|/index\\.ts|)$"
		]
	}
}
```

## Bans

Use oxlint's `eslint/no-restricted-imports`, `eslint/no-restricted-globals` and `eslint/no-restricted-properties`, which print each entry's `message` as help. Put each runtime's bans in an `overrides` entry for its runtime directory. Exempt the owner with a later entry. An override replaces the rule's options, so restate there every ban the owner does not own:

```jsonc
{
	"overrides": [
		{
			"files": ["src/electron-renderer/**"],
			"rules": {
				"eslint/no-restricted-imports": [
					"error",
					{
						"paths": [
							{
								"name": "react",
								"importNames": ["useEffect", "useLayoutEffect", "useInsertionEffect"],
								"message": "Call useStoreValue from src/electron-renderer/client/store.ts.",
							},
						],
					},
				],
				"eslint/no-restricted-globals": [
					"error",
					{ "name": "setTimeout", "message": "Call schedule from src/electron-renderer/client/schedule.ts." },
					{ "name": "fetch", "message": "Call the functions in src/electron-renderer/client/rpc.ts." },
				],
				"eslint/no-restricted-properties": [
					"error",
					{
						"object": "globalThis",
						"property": "setTimeout",
						"message": "Call schedule from src/electron-renderer/client/schedule.ts.",
					},
				],
			},
		},
		{
			"files": ["src/electron-renderer/client/schedule.ts"],
			"rules": {
				"eslint/no-restricted-globals": [
					"error",
					{ "name": "fetch", "message": "Call the functions in src/electron-renderer/client/rpc.ts." },
				],
				"eslint/no-restricted-properties": "off", // schedule.ts owns the timers
			},
		},
	],
}
```

Seed these bans for a React stack:

- `useEffect`, `useLayoutEffect` and `useInsertionEffect` from `react`, and the same names on `"object": "React"`. A restricted `importNames` also rejects `import * as React`.
- `setTimeout`, `setInterval`, `requestAnimationFrame` and `requestIdleCallback` as globals and as `globalThis` properties. `unicorn/prefer-global-this` already turns `window.` into `globalThis.`.
- `fetch` the same way, and `ipcRenderer` from `electron` through `importNames`.

## Comment check

Write the rule file as two YAML documents split by `---`. The first is the rule in step 3 of [`../SKILL.md`](../SKILL.md). The second repeats its body with its own `id` and `language: Tsx`, since each language scans only its own extensions and an anchor does not cross documents. Both grammars name every comment `comment`, JSX `{/* */}` included, and a shebang is no comment node.

A directive is a comment, so the check rejects `@ts-expect-error`, `@ts-ignore` and every `oxlint-` and `oxfmt-` directive. Turn a rule off for some files with an `overrides` entry in the ledger instead, once the user approves it in step 2.

## Baseline

- oxlint has a native baseline behind flags that `--help` hides. `oxlint --suppress-all` writes counts per file and rule to `oxlint-suppressions.json` in the working directory. The next run exits 1 on a new violation, and on a fall with `There are suppressions that do not occur anymore`, so the check runs plain `oxlint`. An owner who lowers a count runs `oxlint --prune-suppressions`, which writes the lower counts, and commits the file.
- The compiler has none. `--suppress-all` skips the `typescript(TS…)` codes and still exits 0. The budget script reads `oxlint --prune-suppressions --format=json`, which lists only what the suppressions miss. It exits 1 while any compiler error remains, so judge from the JSON. Any other code there is a new violation and fails, and the TS codes count against the budget.
- dependency-cruiser has a native baseline. `depcruise src --baseline` writes `.dependency-cruiser-known-violations.json`, and `depcruise src --ignore-known` fails only on new edges. Put `src` first, since `--ignore-known` takes an optional file name, swallows `src`, prints help and exits 0. A fall passes silently, so the check also runs `depcruise src --baseline --baseline-mode shrink-only` and `git diff --exit-code .dependency-cruiser-known-violations.json`.
- The comment check has none. The budget script reads `ast-grep scan --rule rules/no-comments.yml --json=stream src`, one match per line.
- oxfmt needs none, since `oxfmt` rewrites every file.
- `oxlint-suppressions.json` and the budget script's counts key each entry by file path, and `.dependency-cruiser-known-violations.json` by the paths of both ends of an edge, so a move renames the file in all three.

## Check command

Use a package.json script. In a new repo, and in an existing one once the burn-down ends:

```json
"check": "oxfmt --check && oxlint && depcruise src --output-type err-long && ast-grep scan --rule rules/no-comments.yml src && sh tools/width.sh size-limits.txt src && vitest run"
```

Put the repo's own test command in place of `vitest run`.

During the burn-down, swap the `depcruise` call and the ast-grep call for the baseline steps above, and keep `oxlint-suppressions.json` beside `oxlint`. `@swc/core` and `@ast-grep/cli` fetch their binaries in postinstall scripts, so allow both where the package manager asks, as bun does with `trustedDependencies`.
