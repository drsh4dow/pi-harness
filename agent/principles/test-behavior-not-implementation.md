---
when: Writing, changing, reviewing, or deciding whether to keep a test.
---

# Test Behavior, Not Implementation

A test is a claim about what users of the code can observe through its interface: return values, errors, state they can read back, and effects on outside systems. Private helpers, internal call order, and intermediate data are implementation.

Judge each test against two imagined edits:

- **Break the behavior** (a wrong value, a skipped or doubled effect). If the test still passes, it proves nothing. The usual causes are a loose assertion, an expected value computed by the code under test, and an assertion on data the test built itself.
- **Change the internals** and keep every observable result. If the test fails, it is pinned to the implementation.

Keep a test that catches the first edit and survives the second. Rewrite or delete the rest. Drive the code through its public interface with a concrete input, and derive the expected value from the requirement. What an external service receives is behavior. A call to an internal helper is not. Pair "this never happens" with a case where it does happen. Assert the error type that callers branch on, not the message.

Would the tests catch a regression if the code changed? Answer it by experiment, not by reading. Invert one condition the change adds, such as dropping a negation or swapping `&&` for `||`, run the suite, then restore the file from a copy. A mutation that stays green is a finding. Name the test case that is missing.

The default suite holds no wall-clock assertion, such as "finishes under 1 s". Elapsed time measures the machine's load as much as the code, so the assertion fails on a busy machine and passes a slow regression on an idle one. Timing belongs in a perf check that runs on its own.
