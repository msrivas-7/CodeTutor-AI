# Decorators

Suppose you have a dozen functions and you want every one of them to log when it gets called. Option one: edit each function and add a `print` at the top and bottom. That's twelve places to keep in sync, and twelve places to undo when you don't need the logging anymore.

Option two: write the wrapping logic *once*, in a function that takes another function and returns a new one with the extra behavior baked in. Then mark each function you want wrapped with `@that_decorator`. That's a *decorator*. Most "cross-cutting" concerns — logging, timing, caching, retries, auth checks — fit this shape.

## What you'll learn

- Read and write the `@decorator` syntax
- Define a decorator as a function that returns a wrapped function
- Use `*args, **kwargs` so the decorator works for any function shape

## Instructions

Write a decorator `log_calls(func)` that wraps any function and makes it print:

- `calling <name>` before the call,
- the wrapped function's return value, then
- `returned <value>` after the call.

The wrapper must accept any arguments — use `*args, **kwargs` — and return whatever `func` returns.

Apply it with `@log_calls` to two functions:

- `add(a, b)` returns `a + b`
- `greet(name)` returns `f"hello, {name}"`

Then in the script:

```python
add(2, 3)
greet("world")
```

Your output must match exactly:

```
calling add
returned 5
calling greet
returned hello, world
```

## Key concepts

### Functions are values

Before the syntax, the load-bearing fact: in Python, a function is just a value. You can pass one to another function, return it, store it in a variable. That's why a decorator can take a function as its argument and return a new function — there's nothing magical about it.

```python
def shout(msg):
    return msg.upper()

f = shout         # not calling, just renaming
f("hi")           # "HI"
```

### A decorator is a function that returns a function

```python
def log_calls(func):
    def wrapper(*args, **kwargs):
        print(f"calling {func.__name__}")
        result = func(*args, **kwargs)
        print(f"returned {result}")
        return result
    return wrapper
```

`log_calls` takes a function `func` and gives you back `wrapper`, a *different* function that wraps a call to `func` with two prints. The inner `wrapper` references `func` — that's a *closure*, the same trick `memoize` and `count_calls` will use later in this lesson. The closure is what lets the wrapper "remember" which function it's wrapping.

### The `@` syntax

```python
@log_calls
def add(a, b):
    return a + b
```

is exactly the same as:

```python
def add(a, b):
    return a + b
add = log_calls(add)
```

The `@decorator` line is sugar — Python calls the decorator on the function and reassigns the name. Everywhere `add` is referenced afterwards, it's actually the wrapper.

### `*args` and `**kwargs`

The wrapper has no idea what arguments the wrapped function takes. Maybe it takes none, maybe it takes ten, maybe a mix of positional and keyword. `*args, **kwargs` is the catchall:

```python
def wrapper(*args, **kwargs):
    return func(*args, **kwargs)
```

In the function definition, `*args` collects extra positional args into a tuple and `**kwargs` collects extra keyword args into a dict. In the call, the same syntax *unpacks* them back. So `wrapper(1, 2, name="alice")` becomes `func(1, 2, name="alice")` no matter what `func` actually accepts.

(You don't have to call them `args` and `kwargs` — those are just convention. Python only cares about the `*` and `**`.)

### When NOT to use a decorator

Decorators have real costs. They make stack traces less obvious — every call goes through `wrapper` first, which clutters tracebacks. They mask the wrapped function's signature in tooling (you can fix this with `functools.wraps`, but only if you remember). And they hide work, which makes one-place behavior look like everywhere-behavior to a reader.

A working rule: reach for a decorator when the same wrapping logic applies to several functions. Don't dress up a single one-off call site as a decorator just because you can — a regular wrapper call is clearer when there's only one client.

## Hints

(These are surfaced by the tutor on request — they don't auto-reveal.)

1. The `log_calls` decorator is a function that takes `func` and returns `wrapper`. `wrapper` does three things: print before, call `func` and store the result, print after, then return the result.
2. Shape:
```python
def log_calls(func):
    def wrapper(*args, **kwargs):
        print(f"calling {func.__name__}")
        result = func(*args, **kwargs)
        print(f"returned {result}")
        return result
    return wrapper
```
Then put `@log_calls` on the line above each `def add(...)` and `def greet(...)`. After that, `add(2, 3)` triggers all three lines automatically.
3. The same pattern with one print instead of two:
```python
def trace(func):
    def wrapper(*args, **kwargs):
        result = func(*args, **kwargs)
        print(f"{func.__name__} -> {result}")
        return result
    return wrapper
```
