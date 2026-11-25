import { expect, test } from "bun:test";

import { foundIn } from "./wire.fixture.ts";

const quoted = 'MRN "55120-8873"';

const withBackslash = String.raw`C:\charts\delgado`;

const requestBody = String.raw`{"messages":[{"role":"user","content":"Chart MRN \"55120-8873\" at C:\\charts\\delgado"}]}`;

test("foundIn finds a canary that holds a quote or a backslash in a JSON request body, which escapes them", () => {
	expect(foundIn([requestBody])([quoted, withBackslash])).toEqual([quoted, withBackslash]);
});

test("foundIn finds a canary as written in a body, and leaves out one no body holds", () => {
	expect(foundIn(["notes", `Chart ${quoted}`])([quoted, "Ottoline Varga-Pemberton"])).toEqual([quoted]);
});
