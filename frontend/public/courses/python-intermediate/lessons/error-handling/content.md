# Error Handling

In fundamentals you saw what happens when something goes wrong: Python prints a traceback and the program stops. That's the right default — failing loudly is better than failing silently — but sometimes *you* know how to recover, and you'd rather handle the error than let the whole program die.

This lesson teaches the two halves of that story: catching errors others raise (`try`/`except`), and raising your own (`raise`).

## What you'll learn

- Catch specific exceptions with `try`/`except` and recover instead of crashing
- Raise your own exceptions with descriptive messages
- Spot the trap of catching too much — and what `finally` is for

## Instructions

You're given a list of strings — some are valid integers, some aren't. Build two lists and print each on its own line:

1. `parsed` — the integers from any string that parses with `int(...)`. Preserve order.
2. `skipped` — the strings that *failed* to parse, kept as-is.

You'll need a `try`/`except ValueError` around `int(s)` inside a loop over the inputs.

The starter has the input list. Your output must match exactly:

```
parsed: [42, 7, -3]
skipped: ['hello', '']
```

## Key concepts

### try and except

`try` runs a block of code. If anything inside it raises an exception, Python jumps to the matching `except` block instead of crashing:

```python
try:
    n = int("hello")
except ValueError:
    n = 0  # fallback
```

Always catch the *narrowest* exception you can name. `except ValueError:` catches just bad-number errors. `except Exception:` catches almost anything — including bugs you'd rather see crash. `except:` (bare) catches *everything*, including `KeyboardInterrupt`, and is almost never what you want.

A small heuristic: if you can't name the specific failure you're handling, you probably shouldn't be catching it.

### raise

When *you* detect a problem, raise an exception instead of returning a magic value like `-1` or `None`:

```python
def withdraw(balance, amount):
    if amount > balance:
        raise ValueError("amount exceeds balance")
    return balance - amount
```

`raise` exits the function immediately. The caller can choose to catch it (with `try`/`except`) or let it propagate. Returning a sentinel like `-1` *looks* simpler, but every caller has to remember to check — and one who forgets gets a silent bug. A `raise` is loud.

Use built-in exceptions when one fits: `ValueError` for bad values, `TypeError` for wrong types, `KeyError` for missing dict keys, `FileNotFoundError` for missing files. Custom exception classes are a tool for later — built-ins cover most cases.

### finally

`finally` runs whether the `try` succeeded or not. It's for cleanup that *must* happen — closing a file, releasing a lock, restoring state:

```python
f = open("data.txt")
try:
    process(f.read())
finally:
    f.close()  # runs even if process() raises
```

(In real code you'd use a `with` block for files — that's the next lesson. `finally` shines when you don't have a context manager handy.)

### When NOT to use try/except

Exceptions are for *exceptional* cases — things you don't expect on the happy path. If you can check the condition first with an `if`, prefer the `if`:

```python
# Bad: using exceptions for control flow
try:
    val = my_dict["key"]
except KeyError:
    val = "default"

# Better: just ask
val = my_dict.get("key", "default")
```

The rule of thumb: `try`/`except` for things that *can* fail despite your best efforts (parsing user input, reading a file, calling an API). `if` for things you can verify cheaply ahead of time.

## Hints

(These are surfaced by the tutor on request — they don't auto-reveal.)

1. You need to do the same thing for every string — try to convert it, and put it in one list if it works, another if it doesn't. Two empty lists at the top, and a loop.
2. Inside the loop, wrap the `int(s)` call in `try`. The `except ValueError:` block runs only when the conversion fails — that's where the string goes into `skipped`.
3. A smaller working pattern in a different context:
```python
results, errors = [], []
for x in items:
    try:
        results.append(parse(x))
    except ValueError:
        errors.append(x)
```
