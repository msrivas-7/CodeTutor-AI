# Testing Basics

You've been writing code for a while now. The next time you change a function — to add a feature, fix a bug, or rename something — how do you *know* you didn't break what already worked? You can re-run the program and skim the output. That works for ten lines of code. It doesn't work for a hundred. And it definitely doesn't work for code other people will touch six months from now.

Tests are how you check that. A test is a function that exercises some code and uses `assert` to declare what should be true afterward. Run them after every change. The ones that broke tell you exactly what went wrong.

## What you'll learn

- Write tests using `assert` and the `test_<thing>` naming convention
- Run a list of tests and report pass/fail counts
- Pick when an assertion belongs in *production* code vs only in tests

## Instructions

This is a multi-file lesson — there's a production module and a test runner.

**`mathops.py`** — production code. Define two trivial functions:
- `add(a, b)` returns `a + b`
- `is_even(n)` returns `n % 2 == 0`

**`main.py`** — tests + runner. The starter has four `test_*` functions stubbed out. Fill in their bodies with `assert`s:

- `test_add_basic` asserts `add(2, 3) == 5`
- `test_add_negatives` asserts `add(-1, 1) == 0`
- `test_is_even_true` asserts `is_even(4) is True`
- `test_is_even_false` asserts `is_even(5) is False`

Then write the runner: a `for` loop over the `tests` list, each in `try`/`except AssertionError`. For each test, print `PASS <name>` or `FAIL <name>: <message>`. After the loop, print the summary.

Your output must match exactly:

```
PASS test_add_basic
PASS test_add_negatives
PASS test_is_even_true
PASS test_is_even_false
4/4 passed
```

## Key concepts

### What `assert` actually does

`assert <condition>` is roughly:

```python
if not <condition>:
    raise AssertionError
```

Optionally with a message: `assert x == y, "x and y should match"` raises `AssertionError("x and y should match")` on failure. A passing assertion is silent — you only hear from it when something's wrong.

### A test is just a function

```python
def test_add_basic():
    assert add(2, 3) == 5
```

That's it. There's no test framework, no special decorator — a test is a function that performs an *arrange* (set up inputs), an *act* (call the code under test), and an *assert* (declare what should be true). When all three live in one short function, a passing test reads almost like a sentence: "given 2 and 3, add returns 5."

The `test_` prefix is convention. Tools like `pytest` use the prefix to discover tests automatically; for a hand-rolled runner it's still useful — it makes intent obvious at a glance.

### A tiny test runner

```python
for t in tests:
    try:
        t()
        print(f"PASS {t.__name__}")
    except AssertionError as e:
        print(f"FAIL {t.__name__}: {e}")
```

That's the whole runner. Each test runs; failure raises `AssertionError`, which the `try`/`except` catches and reports. Real codebases use `pytest`, but `pytest` *does this same thing* — it just discovers tests for you, prints prettier output, and supports fixtures. The mechanic is the loop above.

### When `assert` is right — and when it isn't

`assert` is excellent in tests. It's also useful inside production code as a *precondition* or *invariant check*: "this function should never be called with a negative number; if it is, fail loud and early."

```python
def average(nums):
    assert len(nums) > 0, "cannot average an empty list"
    return sum(nums) / len(nums)
```

Two warnings, though. First, `assert` is *removed* when Python is run with the `-O` (optimize) flag. So an assertion that's actually load-bearing for security or correctness — "the user is authenticated", "the input was sanitized" — must be a real `if`/`raise`, not an `assert`. Second, don't use `assert` for input validation that's expected to fail at runtime (bad user input, missing files, network errors) — those are exceptions you handle, not invariants you assert.

A working rule: `assert` for "this can't possibly happen if my code is right." `if`/`raise` for "this fails sometimes, and the caller needs to know."

## Hints

(These are surfaced by the tutor on request — they don't auto-reveal.)

1. Two files. `mathops.py` is trivial — two one-line functions. `main.py` is where the testing happens — fill in the four `assert`s, then write a `for` loop that calls each test in `try`/`except AssertionError`.
2. The runner shape:
```python
passed = 0
failed = 0
for t in tests:
    try:
        t()
        passed += 1
        print(f"PASS {t.__name__}")
    except AssertionError as e:
        failed += 1
        print(f"FAIL {t.__name__}: {e}")
print(f"{passed}/{passed + failed} passed")
```
`t.__name__` gives you the function's name as a string — so `test_add_basic` rather than `<function test_add_basic at 0x...>`.
3. The same `try`/`except`-tally shape, generalized to any kind of "did this work?" check:
```python
results = {"ok": 0, "err": 0}
for task in tasks:
    try:
        task()
        results["ok"] += 1
    except Exception:
        results["err"] += 1
```
