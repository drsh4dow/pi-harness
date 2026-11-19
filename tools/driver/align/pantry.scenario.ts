/**
 * A vague build request: the root asks one round of questions, each with its own pick, and ends its turn with no file
 * of the project edited. Who gets reminded, how and how early are product calls no run can settle.
 */
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { scenario } from "#tools/driver/index.ts";
import { type Commit, judge, model, observe, offGitHub, plant, questionsIn } from "./observe.ts";

const history: ReadonlyArray<Commit> = [
	{
		subject: "First version of pantry",
		files: {
			".gitignore": "__pycache__/\n",
			"README.md": `# pantry

Keeps track of what is in our kitchen.

    python -m pantry add milk --qty 2 --expires 2026-12-01
    python -m pantry list
    python -m pantry remove milk
`,
			"pyproject.toml": `[project]
name = "pantry"
version = "0.3.0"
requires-python = ">=3.11"
`,
			"pantry/__init__.py": "",
			"pantry/store.py": `import json
from dataclasses import asdict, dataclass
from datetime import date
from pathlib import Path

PATH = Path.home() / ".pantry.json"


@dataclass
class Item:
    name: str
    qty: int
    expires: date | None


def load() -> list[Item]:
    if not PATH.exists():
        return []
    raw = json.loads(PATH.read_text())
    return [Item(r["name"], r["qty"], date.fromisoformat(r["expires"]) if r["expires"] else None) for r in raw]


def save(items: list[Item]) -> None:
    rows = [{**asdict(i), "expires": i.expires.isoformat() if i.expires else None} for i in items]
    PATH.write_text(json.dumps(rows, indent=2))
`,
			"pantry/__main__.py": `import argparse
from datetime import date

from . import store


def main() -> None:
    parser = argparse.ArgumentParser(prog="pantry")
    sub = parser.add_subparsers(dest="command", required=True)
    add = sub.add_parser("add")
    add.add_argument("name")
    add.add_argument("--qty", type=int, default=1)
    add.add_argument("--expires", type=date.fromisoformat)
    sub.add_parser("list")
    remove = sub.add_parser("remove")
    remove.add_argument("name")
    args = parser.parse_args()

    items = store.load()
    if args.command == "add":
        items.append(store.Item(args.name, args.qty, args.expires))
        store.save(items)
    elif args.command == "remove":
        store.save([i for i in items if i.name != args.name])
    else:
        for i in sorted(items, key=lambda i: i.expires or date.max):
            print(f"{i.name:20} {i.qty:3}  {i.expires or ''}")


main()
`,
		},
	},
];

const request =
	"We keep finding stuff gone off in the fridge before anyone notices it's in pantry. Can you add reminders for things that are about to expire?";

const picks = /\b(?:recommend|my pick|i'd (?:go|pick|choose|default|lean)|i would|default|suggest|propose|lean)/iu;

scenario({
	env: { ...process.env, GH_HOST: offGitHub },
	model,
	play: (run) =>
		Effect.gen(function* () {
			const base = yield* plant({ run, history });
			const { reply, files } = yield* observe({ run, base, request, within: "20 minutes", stopAt: () => true });
			const text = Option.getOrElse(reply, () => "");

			yield* judge({
				run,
				rules: [
					[
						!Arr.isReadonlyArrayNonEmpty(files),
						`a vague build request leaves every file of the project as it was, on every branch and worktree (edited: ${Arr.join(files, ", ")})`,
					],
					[
						Option.isSome(reply) && Arr.isReadonlyArrayNonEmpty(questionsIn(text)),
						`the root settles idle on a reply that asks the human questions (it asks ${String(questionsIn(text).length)})`,
					],
					[
						picks.test(text),
						"the root's questions come with its own picks: the reply recommends, suggests, proposes or names a default",
					],
				],
			});
		}),
});
