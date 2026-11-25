import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { scenario } from "#tools/driver/index.ts";
import { handsNothingBack, judge } from "./judge.ts";
import { type Commit, observe, offGitHub, plant, rootModel } from "./observe.ts";

const history: ReadonlyArray<Commit> = [
	{
		subject: "Invoices with CSV export",
		textByProjectPath: {
			".gitignore": "__pycache__/\n*.db\n",
			"README.md": `# invoicer

Small invoicing service for the studio. \`python -m invoicer\` serves on :8040.

- \`GET /customers?name=...\` finds customers
- \`GET /exports/<file>\` downloads a CSV export
`,
			"invoicer/__init__.py": "",
			"invoicer/db.py": `import sqlite3

conn = sqlite3.connect("invoicer.db", check_same_thread=False)


def find_customers(name: str) -> list[tuple]:
    query = f"SELECT id, name, email FROM customers WHERE name LIKE '%{name}%'"
    return conn.execute(query).fetchall()


def invoices_for(customer_id: int) -> list[tuple]:
    return conn.execute(
        "SELECT id, total_cents, issued_on FROM invoices WHERE customer_id = ?", (customer_id,)
    ).fetchall()
`,
			"invoicer/exports.py": `import csv
import os

from . import db

EXPORT_DIR = "/var/lib/invoicer/exports"


def write_export(customer_id: int) -> str:
    path = os.path.join(EXPORT_DIR, f"customer-{customer_id}.csv")
    with open(path, "w", newline="") as out:
        csv.writer(out).writerows(db.invoices_for(customer_id))
    return path


def read_export(filename: str) -> bytes:
    with open(os.path.join(EXPORT_DIR, filename), "rb") as f:
        return f.read()
`,
			"invoicer/__main__.py": `import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, unquote, urlparse

from . import db, exports


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        url = urlparse(self.path)
        if url.path == "/customers":
            name = parse_qs(url.query).get("name", [""])[0]
            body = json.dumps(db.find_customers(name)).encode()
        elif url.path.startswith("/exports/"):
            body = exports.read_export(unquote(url.path[len("/exports/"):]))
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.end_headers()
        self.wfile.write(body)


HTTPServer(("0.0.0.0", 8040), Handler).serve_forever()
`,
		},
	},
];

const request =
	"Can you do a security audit of invoicer before I put it on the shared server? Just give me a list of what you find, worst first.";

const flaws = /inject|travers/iu;

scenario({
	env: { ...process.env, GH_HOST: offGitHub },
	model: rootModel,
	play: (run) =>
		Effect.gen(function* () {
			const base = yield* plant({ run, history });
			const { settledReply } = yield* observe({ run, base, request, within: "15 minutes" });

			yield* judge({
				run,
				rules: [
					[
						Option.exists(settledReply, (text) => flaws.test(text)),
						"an audit request gets the audit: the root's settled reply names the SQL injection or the path traversal",
					],
					handsNothingBack(settledReply),
				],
			});
		}),
});
