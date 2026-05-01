# Lambdas & Higher-Order Functions

In fundamentals you defined functions with `def`. Sometimes you need a function for a single line of code — sorting by a custom key, filtering a list — and giving it a name and four lines of indentation feels like overkill. Python lets you write a tiny one-expression function inline. That's a `lambda`.

A `lambda` only matters because of where you pass it. So this lesson pairs lambdas with three built-ins that take a function as an argument: `sorted`, `filter`, and `map`. Functions that take other functions are called *higher-order functions*.

## What you'll learn

- Write a lambda — a one-line function with no name
- Pass a lambda to `sorted` (via `key=`), `filter`, and `map`
- Tell when a comprehension is clearer than `map`/`filter`

## Instructions

You're given a list of book tuples — each is a title and a page count. The starter has the list ready. Build three things and print each on its own line:

1. **Sorted by pages.** A list of just the titles, sorted from fewest pages to most. Use `sorted` with `key=lambda b: b[1]`. Print as `sorted by pages: <list>`.
2. **Long books.** A list of titles where pages > 200. Preserve the original order. Use `filter` with a `lambda`. Print as `long books: <list>`.
3. **Titles upper.** A list of every title in uppercase. Use `map` with a `lambda` calling `.upper()`. Print as `titles upper: <list>`.

Both `filter` and `map` return iterators in Python 3 — you need to wrap them in `list(...)` to materialize a list. For #1 and #2, you'll also need to pull just the title out of each tuple after sorting/filtering — a small comprehension over the result is the cleanest way.

Your output must match exactly:

```
sorted by pages: ['Frog', 'Anne', 'Moby Dick']
long books: ['Moby Dick', 'Anne']
titles upper: ['MOBY DICK', 'FROG', 'ANNE']
```

## Key concepts

### What a lambda actually is

A `lambda` is a function. The only thing it lacks is a name. These two are equivalent:

```python
def double(n):
    return n * 2

double = lambda n: n * 2
```

The shape: `lambda <args>: <expression>`. The expression's value is the return value — there is no `return` keyword and no statements. If you find yourself wanting an `if` block or two lines, use `def` instead.

### sorted with a key

`sorted` returns a new list. By default it sorts the items themselves. If your items are tuples (or anything compound), pass `key=` to tell it *what* to compare:

```python
people = [("Alice", 30), ("Bob", 25)]
youngest_first = sorted(people, key=lambda p: p[1])
# [('Bob', 25), ('Alice', 30)]
```

`reverse=True` flips the order. The original list is untouched — `sorted` always returns a new one.

### filter and map

`filter(func, iterable)` keeps items where `func(item)` is truthy. `map(func, iterable)` applies `func` to every item. Both return *iterators* in Python 3, not lists, so wrap them with `list(...)` when you want a list:

```python
nums = [1, 2, 3, 4, 5]
evens = list(filter(lambda n: n % 2 == 0, nums))   # [2, 4]
doubled = list(map(lambda n: n * 2, nums))         # [2, 4, 6, 8, 10]
```

### map/filter vs comprehensions

These two lines do the same thing:

```python
doubled = list(map(lambda n: n * 2, nums))
doubled = [n * 2 for n in nums]
```

In Python, the comprehension is usually preferred — it reads left-to-right and doesn't need `lambda` or `list(...)`. So why learn `map` and `filter`? Because lots of APIs (sorting libraries, dataframes, async helpers) take a *function* as an argument. You can't hand them a comprehension. You hand them a `lambda` or a named `def`.

A simple rule: if you're transforming one list into another *and that's it*, use a comprehension. If you're handing a function to someone else's API, use a lambda.

## Hints

(These are surfaced by the tutor on request — they don't auto-reveal.)

1. Each book is a tuple. By default `sorted` compares the whole tuple — starting with the title. You need to tell it to compare on something else, and `filter`/`map` need a function that does something to each item.
2. `sorted` takes `key=` — pass a lambda that returns whatever you want to compare on. `filter(predicate, xs)` keeps items where the predicate is true. `map(func, xs)` runs `func` on every item. Both `filter` and `map` return iterators, so wrap them with `list(...)` (or iterate them in a comprehension) when you need a list.
3. A smallest example combining all three pieces:
```python
pairs = [(3, "c"), (1, "a"), (2, "b")]
letters_in_order = [p[1] for p in sorted(pairs, key=lambda p: p[0])]
# ['a', 'b', 'c']
```
