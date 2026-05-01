# Capstone: Mini In-Memory ORM

The course's final lesson. The capstone before this one was a script. This one is a *library* — a small, self-contained tool that other code calls into. You'll build a `Query` class that lets you filter, sort, and pick from a list of dicts using a chainable, declarative API:

```python
oldest_admin = (
    Query(users)
        .where(lambda r: r["role"] == "admin")
        .sort_by(lambda r: -r["age"])
        .first()
)
```

That's roughly the shape of every real ORM you'll ever use — Django's `User.objects.filter(role="admin").order_by("-age").first()` is the same idea with a database round-trip behind each method. You're going to write the in-memory version in about thirty lines.

## What you'll learn

- Build a class whose methods return *new instances of the same class* (the chainable / fluent pattern)
- Define `__iter__`, `__len__`, and `__repr__` so the class plays nicely with `len()`, `for`, and the REPL
- Wire lambdas through as predicates and key functions to make the API feel declarative

## Instructions

Define a class `Query` in `main.py` with these pieces:

- `__init__(self, rows)` stores `list(rows)` as `self.rows`. Wrap with `list(...)` so generators get materialized once.
- `where(self, predicate)` returns a *new* `Query` containing only the records for which `predicate(record)` is truthy.
- `sort_by(self, key)` returns a *new* `Query` with the records sorted by `key(record)`. (Use the built-in `sorted`.)
- `first(self)` returns the first record (or `None` if empty).
- `__len__(self)` returns the count.
- `__iter__(self)` yields each record (use `iter(self.rows)`).
- `__repr__(self)` returns a string like `"Query(3 rows)"`.

Then in the script body:

```python
users = [
    {"name": "Alice", "age": 30, "role": "admin"},
    {"name": "Bob", "age": 25, "role": "user"},
    {"name": "Cara", "age": 35, "role": "admin"},
]

q = Query(users)
admins = q.where(lambda r: r["role"] == "admin")
oldest_admin = admins.sort_by(lambda r: -r["age"]).first()

print(f"all users: {len(q)}")
print(f"admins: {len(admins)}")
print(f"oldest admin: {oldest_admin['name']}")
```

Your output must match exactly:

```
all users: 3
admins: 2
oldest admin: Cara
```

## Key concepts (review + composition)

### Chainable methods (a.k.a. the fluent API pattern)

The trick: every transformation method returns a new instance of the same class.

```python
def where(self, predicate):
    return Query([r for r in self.rows if predicate(r)])
```

This is what makes `q.where(...).sort_by(...).first()` work. Each method packages its result back into a `Query`, so the next method has something to call into. The original `q` is never modified — every step produces a new query, leaving older ones unchanged. That's important: it means a query can be branched and reused without surprises.

### `__iter__` and `__len__` make `Query` feel native

You added `__len__` and `__iter__` so `len(q)` and `for r in q:` work. That's the difference between a class that's *useable* and a class that *fits in*. A learner who didn't know `Query` was a custom class would still be able to use it, because Python's built-ins delegate to those dunders.

```python
def __iter__(self):
    return iter(self.rows)

def __len__(self):
    return len(self.rows)
```

If you also define `__getitem__`, your class becomes indexable (`q[0]`). For this lesson the four operations above are enough.

### Lambdas as predicates and key functions

The same `lambda r: r["role"] == "admin"` you'd use with `filter`, you can use with `where`. Same for `sort_by(lambda r: -r["age"])` — sort descending by age. Lambdas turn out to be how you get a *declarative* feel out of imperative code: the call site reads like "give me admins, oldest first" because the test and the ordering are first-class arguments.

### What's intentionally missing

A real ORM has `select` (project specific fields), `group_by`, `join`, `aggregate`, lazy evaluation, and roughly a dozen other methods. We've left those out so the lesson stays tight. The practice exercises poke at three of them — `where` standalone, `pluck` (a `select` for one field), and `count_by` (the `GROUP BY count` reduction).

The fluent pattern itself scales: every method you'd add follows the same shape — take `self`, transform `self.rows`, return a new `Query`. You can plug new operations in indefinitely without ever changing existing call sites.

### And that's the course

You started with comprehensions and walked through error handling, file I/O, modules, classes, inheritance, dunders, generators, decorators, testing, and regex. This lesson pulls together the load-bearing pieces of that arc — classes, dunders, lambdas, higher-order functions — into a small library in about twenty lines, written in a style that wouldn't look out of place in a senior Python codebase. The rest (try/except, generators, decorators, regex, testing) are the next things you'd reach for as the library grows.

The next thing worth doing is a tour of the standard library — `csv`, `json`, `pathlib`, `dataclasses`, `argparse`, `subprocess`. Almost every script you'll ever write is some combination of those plus the patterns from this course. None of them will surprise you anymore.

## Hints

(These are surfaced by the tutor on request — they don't auto-reveal.)

1. The class has seven methods. Three transformations (`where`, `sort_by`, `first`), three dunders (`__len__`, `__iter__`, `__repr__`), and `__init__`. Each transformation method should be three lines or fewer.
2. Skeleton:
```python
class Query:
    def __init__(self, rows):
        self.rows = list(rows)

    def where(self, predicate):
        return Query([r for r in self.rows if predicate(r)])

    def sort_by(self, key):
        return Query(sorted(self.rows, key=key))

    def first(self):
        return self.rows[0] if self.rows else None

    def __iter__(self):
        return iter(self.rows)

    def __len__(self):
        return len(self.rows)

    def __repr__(self):
        return f"Query({len(self.rows)} rows)"
```
The `len(self.rows)` reuse in `__repr__` is fine — `len()` on a list is O(1).
3. The chained call site, broken into named steps if it helps to read:
```python
admins = q.where(lambda r: r["role"] == "admin")
sorted_desc = admins.sort_by(lambda r: -r["age"])
oldest = sorted_desc.first()
```
Equivalent to one big chain. Both are fine — pick whichever reads better in your code.
