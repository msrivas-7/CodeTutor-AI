# Iterators & Generators

Every list comprehension you've written so far computes everything up front. `[n * n for n in range(1_000_000)]` builds a million-element list before you can do anything with it. That's fine when the data is small. But if it's huge — every line of a 10GB log file, every Fibonacci number — eager computation either wastes memory or doesn't terminate.

A *generator* fixes that. It's a function that produces values *one at a time, on demand*. Each call to `next()` runs the function until it hits a `yield`, hands you the value, and pauses. The next call resumes right where it left off. The whole sequence never sits in memory.

## What you'll learn

- Write a generator function with `yield`
- Consume a generator with `for` or `next()`
- Recognize when a generator is the right tool — and when a list still wins

## Instructions

Write a generator that produces the Fibonacci sequence. Use it to print the first 10 numbers (as a list) and their sum.

Define `fibonacci()` — a generator that yields `0, 1, 1, 2, 3, 5, ...`. It runs forever; that's fine.

Then in the script body:

1. Build a list `first_10` of the first 10 values from `fibonacci()`.
2. Print `first 10 fib: <list>`.
3. Print `sum: <sum of those 10>`.

The starter has the print scaffolding ready. Your output must match exactly:

```
first 10 fib: [0, 1, 1, 2, 3, 5, 8, 13, 21, 34]
sum: 88
```

## Key concepts

### `yield` turns a function into a generator

```python
def count_up_to(n):
    for i in range(1, n + 1):
        yield i
```

This looks like a regular function, but the `yield` keyword changes what calling it does. Calling `count_up_to(5)` does *not* run the body — it returns a *generator object*. The body only runs as you ask for values:

```python
g = count_up_to(5)
next(g)     # 1   (runs until first yield, pauses)
next(g)     # 2   (resumes, runs until next yield)
list(g)     # [3, 4, 5]   (drains the rest)
```

Most of the time you don't call `next()` directly — you use a `for` loop, which calls `next()` for you and stops cleanly when the generator finishes:

```python
for i in count_up_to(5):
    print(i)   # prints 1, 2, 3, 4, 5
```

A generator finishes (raises `StopIteration` internally) when its body falls off the end or hits a `return`. `for` and `list()` both know how to stop on that signal.

### Infinite generators

Because values are produced lazily, a generator can be *infinite*:

```python
def naturals():
    i = 0
    while True:
        yield i
        i += 1
```

Calling `list(naturals())` would hang forever. But you can take a finite prefix — five values, a hundred, whatever — without consuming the rest. `for` plus `break`, or a counted loop with `next()`, both work.

### Generator expressions

Just like a list comprehension uses `[...]`, a *generator expression* uses `(...)`:

```python
squares_list = [n * n for n in range(1_000_000)]   # builds a million-item list
squares_gen  = (n * n for n in range(1_000_000))   # builds a generator (cheap)
```

`squares_list` reserves memory for a million ints. `squares_gen` reserves none — values are produced as you ask for them. Functions like `sum()`, `max()`, and `any()` accept generators directly: `sum(n * n for n in range(1_000_000))` never materializes the list at all.

### When NOT to use a generator

A generator can only be iterated *once*. After the first pass, it's exhausted — a second `for` loop produces nothing. So if you need to iterate the same data twice, or index into it, or call `len()` on it, you want a list.

```python
g = count_up_to(3)
list(g)   # [1, 2, 3]
list(g)   # []  — already drained
```

A working rule: lists are stored data; generators are produced data. If the values exist somewhere already (in memory, on disk in a known shape, in a small fixed range), and you want to look at them more than once, store them as a list. Use a generator when materializing the values would be wasteful (huge), impossible (infinite), or premature (you may not need them all).

## Hints

(These are surfaced by the tutor on request — they don't auto-reveal.)

1. The Fibonacci generator wants two state variables (the current and next term) and a `while True:` loop. After yielding, advance them: the next current is the previous next; the next next is the sum of both.
2. Shape:
```python
def fibonacci():
    a, b = 0, 1
    while True:
        yield a
        a, b = b, a + b
```
For the first 10, `[next(fib) for _ in range(10)]` is the cleanest path — call `next()` 10 times and collect into a list.
3. The same lazy-stream pattern in a different shape — odd numbers forever:
```python
def odds():
    n = 1
    while True:
        yield n
        n += 2
```
