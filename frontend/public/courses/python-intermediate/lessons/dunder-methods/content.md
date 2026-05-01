# Dunder Methods

In the last two lessons your classes worked, but they didn't *feel* like Python's built-in types. `print(my_account)` showed something like `<__main__.Account object at 0x102fab410>`. `acc1 == acc2` was `False` even when they had the same owner and balance. `len(my_stack)` raised `TypeError`.

Those built-ins delegate to special methods on your class — methods whose names are wrapped in double underscores, pronounced "*dunder*" methods. `print` calls `__str__`. `==` calls `__eq__`. `len()` calls `__len__`. Define the dunder, and the built-in starts working on your type.

## What you'll learn

- Define `__repr__` and `__str__` so `repr()`, `str()`, and `print()` produce useful output
- Define `__eq__` so `==` compares by value
- Define `__len__` so `len()` works on your own objects

## Instructions

Build a tiny `Money` class.

`__init__(self, amount, currency)` stores both fields. Then add three dunder methods:

- `__str__(self)` returns `"<amount> <currency>"` — used by `print(m)` and `str(m)`.
- `__repr__(self)` returns `"Money(<amount>, '<currency>')"` — the debug-friendly view, which is what shows up in the REPL or when an instance appears inside a list.
- `__eq__(self, other)` returns `True` when `other` is also a `Money` with the same `amount` and `currency`. Use `isinstance(other, Money)` first so comparing to a non-`Money` returns `False` instead of crashing.

Then in script body:

```python
m1 = Money(100, "USD")
m2 = Money(100, "USD")
m3 = Money(50, "USD")

print(m1)            # uses __str__
print(repr(m1))      # uses __repr__
print(m1 == m2)      # uses __eq__
print(m1 == m3)
```

Your output must match exactly:

```
100 USD
Money(100, 'USD')
True
False
```

## Key concepts

### `__repr__` vs `__str__`

The two are easy to confuse. The convention:

- `__repr__` is for *developers*. It should look unambiguous — ideally something you could paste into the REPL to recreate the object. The REPL, `repr()`, and the way an instance prints when it's nested in a list or dict all use `__repr__`.
- `__str__` is for *end users*. It can be friendly, lossy, formatted however reads best. `print(obj)` and `str(obj)` use `__str__`.

If a class only has `__repr__`, Python uses it for both. So if you're only going to write one, write `__repr__`. The default `<__main__.Foo object at 0x...>` is the worst-of-both — useless to developers and unfriendly to users — and 30 seconds of `__repr__` removes it.

```python
class Money:
    def __repr__(self):
        return f"Money({self.amount}, {self.currency!r})"

    def __str__(self):
        return f"{self.amount} {self.currency}"
```

The `!r` inside the f-string is shorthand for "call `repr()` on this value" — it's why the currency string in `Money(100, 'USD')` shows up with quotes.

### `__eq__`

By default, `a == b` is true only when `a` and `b` are the *same object* (`a is b`). For most custom types that's not what you want — two `Money(100, "USD")` instances should compare equal even though they're different objects in memory.

```python
def __eq__(self, other):
    if not isinstance(other, Money):
        return False
    return self.amount == other.amount and self.currency == other.currency
```

The `isinstance` guard matters. Without it, `Money(100, "USD") == "USD"` would crash on `other.amount`. Returning `False` for "not the same kind of thing" is what the built-in types do.

(Defining `__eq__` has a subtle consequence: it disables your class's default `__hash__`, which means instances stop being usable as dict keys or set members. That's usually fine — but if you need both, define `__hash__` too.)

### `__len__`

`len(obj)` calls `obj.__len__()` and expects an integer back. Define it whenever "how many things does this object hold" has an obvious answer:

```python
class Bag:
    def __init__(self, items):
        self.items = items

    def __len__(self):
        return len(self.items)
```

Bonus: defining `__len__` also makes your object *truthy* exactly when it's non-empty. `if my_bag:` becomes equivalent to `if len(my_bag) > 0:` — Python uses `__len__` to decide.

### Don't define what you don't need

There are dozens of dunders — `__add__` for `+`, `__getitem__` for `[]`, `__iter__` for `for x in obj`, and so on. The temptation when you first learn this is to add them all. Resist. A `__add__` on a class where addition isn't obvious will confuse readers more than it helps. The four in this lesson — `__repr__`, `__str__`, `__eq__`, `__len__` — cover most real cases. Reach for the others when there's a clear "this is what `+` should mean here" answer.

## Hints

(These are surfaced by the tutor on request — they don't auto-reveal.)

1. Three dunder methods on one class. Each is a regular `def` inside `class Money:` — Python finds them by name. The tricky one is `__eq__` because of the type-check.
2. `__str__` returns `f"{self.amount} {self.currency}"`. `__repr__` returns `f"Money({self.amount}, {self.currency!r})"` — the `!r` is what adds the quotes around the currency. `__eq__` should `isinstance(other, Money)` first, then compare both attributes.
3. The same shape on a smaller class:
```python
class Pair:
    def __init__(self, a, b):
        self.a, self.b = a, b
    def __repr__(self):
        return f"Pair({self.a!r}, {self.b!r})"
    def __eq__(self, other):
        if not isinstance(other, Pair): return False
        return (self.a, self.b) == (other.a, other.b)
```
