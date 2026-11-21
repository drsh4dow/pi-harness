# Python

The dunify reference for Python, used in steps 3 to 5 of [`../SKILL.md`](../SKILL.md). Checked on ruff 0.17.6, basedpyright 1.40.2, import-linter 2.17, ast-grep 0.51.3 and uv 0.13.8.

## Source root and edge file

The source root is `src/<package>/` and a feature's edge file is its `__init__.py`. A runtime directory is a subpackage, such as `src/app/server/`. Runtimes that deploy apart become uv workspace members at `packages/<runtime>/src/<runtime>/`, with the contract as one more member. Re-export a feature's names from its edge file through `__all__`, which ruff and basedpyright both accept, and import those names. Inside a feature, a client module or a module of `primitives/`, name every module and package but the edge file with a leading underscore, such as `_summary.py` or `_totals/`, at every depth. `from app.server.features.billing import total` records an import of `billing.total` when `total` is a module, and the boundary gate rejects it.

## Ceiling

```toml
[tool.ruff.lint]
select = ["ALL"]
ignore = [
	"COM812", # collision: ruff format writes code COM812 rejects
	"D", # collision: the comment check rejects every docstring
	"PLR0915", # the user's standing choice
]
flake8-bandit.check-typed-exception = true
flake8-implicit-str-concat.allow-multiline = false
flake8-tidy-imports.ban-relative-imports = "all"
flake8-type-checking.strict = true
[tool.basedpyright]
typeCheckingMode = "all"
```

- Put this in `pyproject.toml` and pin every tool exactly in the `dev` dependency group, since `ALL` gains rules on each ruff upgrade. `ALL` holds every plugin ruff implements, framework groups such as `DJ`, `FAST` and `PD` included. Leave `preview` unset.
- List ruff's rules with `uv run ruff rule --all --output-format json` and keep the entries whose `status` key is `Stable`, because `"preview": false` also matches removed rules. `uv run ruff check --show-settings` prints the resolved set under `linter.rules.enabled`.
- basedpyright has no command that lists rules. `all` sets every rule in the table on its configuration docs page to error, except the ones that table marks discouraged.
- `PLR0915` is the only rule that caps a function's statements, and no rule caps its lines or a module's lines. `C901`, `PLR0912`, `PLR0913`, `PLR0917` and `PLR0911` stay on at their defaults, 10, 12, 5, 5 and 6. The nesting rule `PLR1702` is preview, so the ceiling has no nesting cap. The check holds the file cap with the file cap command from `SKILL.md`, with the extension `py`.
- `CPY001` is stable and wants a `# Copyright <year> <owner>` line atop every file, empty `__init__.py` included. An SPDX line alone fails it.

## Known collisions

This is a starting list. Prove each one with a file before you turn a side off.

- `COM812` and the formatter. Format a file holding a call too long for one line, then run `ruff check --select COM812` on it. The formatter's output fails.
- `D` and the comment check. `D100` wants a docstring in every module, and the comment check rejects every docstring.
- `ruff format --check` warns about each lint rule that conflicts with the current `[tool.ruff.format]` settings. At the defaults it names only `COM812`. Tabs add `W191`, and single quotes add `Q000` and `Q003`.

## Boundaries

Use import-linter. For runtimes `server` and `worker` and the contract `shared`:

```toml
[tool.importlinter]
root_package = "app"
contracts = [
	{ name = "Runtimes stay apart", type = "independence", modules = [
		"app.server",
		"app.worker",
	] },
	{ name = "Features over client over primitives", type = "layers", containers = [
		"app.*",
	], layers = [
		"(features)",
		"(client)",
		"(primitives)",
	] },
	{ name = "Inner modules stay inside their parent", type = "private_modules" },
	{ name = "Primitives import nothing from the app", type = "forbidden", source_modules = [
		"app.*.primitives",
	], forbidden_modules = [
		"app.shared",
	] },
	{ name = "The contract imports no runtime", type = "forbidden", source_modules = [
		"app.shared",
	], forbidden_modules = [
		"app.server",
		"app.worker",
	] },
]
```

- `uv run lint-imports` exits 1 when a contract breaks. It counts imports under `if TYPE_CHECKING:`, so runtimes stay apart for types too.
- Parentheses mark a layer optional, so a runtime may lack one. For a runtime that holds its owned folders directly, keep it out of the layers contract. For a single runtime, the container is `app` and the first contract goes.
- `private_modules` lets only a module's parent package and that package's descendants import a module whose name starts with `_`, which holds every edge file at every depth. A feature, a client module, a module of `primitives/` and a contract keep plain names, so the other contracts judge those imports.
- Nothing in import-linter checks the names, so the check runs this naming gate, which fails on every plain name below those:

   ```sh
   find src -name __pycache__ -prune -o \( -path '*/features/*/*' -o -path '*/client/*/*' -o -path '*/primitives/*/*' \) \( -type d -o -name '*.py' \) ! -name '_*' -print | awk '{ print $0 " is importable past its edge file. Rename it with a leading underscore." } END { exit NR > 0 }'
   ```

- In a uv workspace, list every member in `root_packages` in place of `root_package`, and run `lint-imports` from the workspace root.

## Bans

Use ruff's `banned-api` (rule `TID251`) for the message and `per-file-ignores` for the owner. Seed bans:

```toml
[tool.ruff.lint.flake8-tidy-imports.banned-api]
"urllib.request".msg = "Call app.server.client.http.get."
"subprocess".msg = "Call app.server.client.process.run."
"os.environ".msg = "Read app.server.client.settings.SETTINGS."
"sqlite3".msg = "Call app.server.client.db.query."
"asyncio.create_task".msg = "Call app.server.client.tasks.spawn."
"datetime.datetime.now".msg = "Call app.server.primitives.clock.now."
[tool.ruff.lint.per-file-ignores]
"src/app/server/client/http.py" = ["TID251"]
```

A key matches imports and attribute access, so `os.environ.get(...)` and `datetime.now()` after `from datetime import datetime` both fail. An owner path is exempt from every ban, so give each owner its own file and list that file alone.

## Comment check

```yaml
id: no-comments
language: Python
severity: error
message: Delete this comment. Say it with a name, a type, a test, an issue or an ADR.
rule:
   any:
      - kind: comment
        not:
           any:
              - all: [regex: "^#!", nthChild: 1, inside: { kind: module }]
              - all:
                   - regex: "^#.*(Copyright|SPDX-License-Identifier)"
                   - inside: { kind: module }
                   - not: { follows: { not: { kind: comment }, stopBy: end } }
      - kind: expression_statement
        has: { any: [kind: string, kind: concatenated_string] }
```

Python has one comment kind, `comment`, and each `#` line is its own node, so a license header keeps only its Copyright and SPDX lines, at the top of the file. A docstring is a string statement, so the second branch rejects it with every other bare string. Directives such as `# noqa` and `# type: ignore` are comments, so the check rejects them. A `#!` line passes only as the first line of the file. The rule cannot see blank lines, so ruff `EXE004` rejects a `#!` line after one.

Add `ast-grep-cli` to the `dev` group so `uv run ast-grep` runs the pinned version.

## Baseline

- basedpyright has one. `uv run basedpyright --writebaseline` writes `.basedpyright/baseline.json` and exits 1 on the run that records new errors. A normal run fails on a new error and rewrites the file when errors fall, so the check runs `git diff --exit-code .basedpyright/baseline.json` after it.
- Ruff has none, and `--add-noqa` writes suppression directives. The budget script reads `uv run ruff check --output-format json --exit-zero` and the file cap command's lines, and replaces `ruff check .` and the file cap command in the check until the burn-down ends. Each entry has `code` and `filename`, an absolute path to make relative.
- The comment check uses the budget script too. `uv run ast-grep scan --rule no-comments.yml --json=stream src tests` prints one object per line with `file` and `ruleId`, and exits 1 while matches remain.
- import-linter baselines a violation as an `ignore_imports` entry in its contract. The default alerting fails once that import is gone, so the list only shrinks.

## Check command

`uv check` runs ty, not this stack. Where the repo has no task runner, add a `Makefile` whose `check` target runs, in order: `uv run ruff format --check .`, `uv run ruff check .`, `uv run basedpyright`, `uv run lint-imports`, the naming gate, `uv run ast-grep scan --rule no-comments.yml src tests`, the file cap command, `sh tools/width.sh size-limits.txt src`, and `uv run pytest -q`. Keep gate fixtures in a top-level `gate_fixtures/`, listed in ruff's `extend-exclude` and basedpyright's `exclude`. Each gate test runs its tool on the fixture by path, such as `ruff check --select TID251 gate_fixtures/ban.py`. import-linter reads only the installed package, so the boundary test copies its fixture into `src/` and deletes it afterward.
