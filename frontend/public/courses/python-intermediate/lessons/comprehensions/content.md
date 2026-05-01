# Comprehensions

You already met list comprehensions in fundamentals — the `[x for x in xs]` shorthand. This lesson goes deeper and adds two siblings: dicts and sets. Same shape, different brackets.

## What you'll learn

- Build dicts and sets in one line, not just lists
- Combine filtering and transformation in a single expression
- Know when a comprehension stops being clearer than a regular loop

## Instructions

You're given a list of student tuples — each is a name and a numeric grade out of 100. Build three things from it and print each on its own line:

1. A **list** of the names of students who passed (grade ≥ 60). Print it as `passing students: <list>`.
2. A **dict** mapping every student's name to their grade. Print it as `grades by student: <dict>`.
3. A **set** of the unique tens-digit of every grade (e.g., 87 → 8, 54 → 5). Print it as `unique grade tens: <sorted list>`.

Sets don't have a stable print order — the same set can render `{5, 8, 9}` one run and `{8, 9, 5}` the next. To make the output predictable, the starter calls `sorted(grade_tens)` for the print line. Build the value as a set (set comprehension is the lesson); just print it sorted.

The students list is given for you in the starter. Your output must match exactly:

```
passing students: ['Alice', 'Cara']
grades by student: {'Alice': 87, 'Bob': 54, 'Cara': 91}
unique grade tens: [5, 8, 9]
```

## Key concepts

### List comprehension with a filter

You saw the basics in fundamentals. Worth a recap because the shape is the same for dicts and sets:

```python
nums = [1, 2, 3, 4, 5]
evens = [n for n in nums if n % 2 == 0]
# evens is [2, 4]
```

Read it left-to-right: build a list `[…]` with `n` for each `n` in `nums` where `n` is even. The `if` clause is optional.

### Dict comprehension

Same idea, but you write a `key: value` pair instead of a single expression:

```python
words = ["hi", "hello"]
lengths = {w: len(w) for w in words}
# lengths is {'hi': 2, 'hello': 5}
```

Notice the curly braces and the colon — that's how Python knows it's a dict, not a set.

### Set comprehension

Curly braces, no colon — Python infers a set:

```python
nums = [1, 2, 2, 3, 3, 3]
unique = {n for n in nums}
# unique is {1, 2, 3}
```

Sets drop duplicates automatically. Useful when you want to know "what distinct values appear here?"

### When to NOT use a comprehension

Comprehensions are a shortcut, not a hammer. If the body needs more than one short expression — multiple statements, complex branching, side effects like printing — a regular `for` loop is clearer:

```python
# Good: one expression, easy to read
squares = [n * n for n in range(10)]

# Bad: cramming logic in — use a loop instead
results = [process(n) if n > 0 else fallback(n) for n in items if n is not None]
```

A rough rule: if you can't read it left-to-right and immediately see what it builds, it's too much.

## Hints

(These are surfaced by the tutor on request — they don't auto-reveal.)

1. You need three different collection types. Each has its own bracket style: `[...]`, `{...}`, and `{k: v for ...}`.
2. For the passing-students list, filter the students with `if grade >= 60`. Each tuple unpacks into two names: `for name, grade in students`.
3. The tens digit of a number is `grade // 10` (integer division — drops the units digit).
