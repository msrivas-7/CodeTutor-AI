# Mini project: Habit tracker

You've got arrays, objects, functions, conditionals, and loops. Time to wire them together into something that feels like a real program.

## What you'll learn

- Model a small data structure with arrays and objects
- Split a program into small, testable functions
- Compose those functions inside `main()` and print a formatted summary

## Instructions

Write a tiny habit tracker with three functions and a `main()` that uses them.

Each **habit** is an object: `{ name: "read", done: false }`. A **habit list** is an array of those objects.

Write:

1. `addHabit(habits, name)` — returns the list with a new `{ name, done: false }` appended.
2. `markDone(habits, name)` — returns the list with the matching habit's `done` flipped to `true`. If no habit has that name, return the list unchanged.
3. `summary(habits)` — returns a string like `"1 of 3 habits done"`.
4. `main()` — builds up a list with three habits (`read`, `walk`, `meditate`), marks `walk` done, then prints each habit as `"name: done"` or `"name: todo"` (one per line), followed by the `summary` string.

Finally, call `main()` so your program actually runs.

Expected output from `main()`:

```
read: todo
walk: done
meditate: todo
1 of 3 habits done
```

## Key concepts

### Small functions, composed

Each function does one thing. `addHabit` doesn't print. `markDone` doesn't add. `summary` doesn't mutate. `main()` is the only place that knows about the whole flow — it calls the other three in order.

This split is what makes a program testable: the unit tests check each function in isolation; `main()` is the integration.

### Returning a modified list

You can either mutate and return:

```javascript
function addHabit(habits, name) {
  habits.push({ name, done: false });
  return habits;
}
```

Or build a new one (no mutation):

```javascript
function addHabit(habits, name) {
  return [...habits, { name, done: false }];
}
```

Either works for this project. The non-mutating style scales better in real apps; the mutating style is simpler to write first.

### Formatting with template literals

`` `${habit.name}: ${habit.done ? "done" : "todo"}` `` handles the per-line format. `done ? "done" : "todo"` is a **ternary** — a short `if/else` that returns a value.

## Hints

1. Start with the three helper functions and get their unit tests passing before you touch `main()`.
2. In `main()`, use `console.log` in a `for...of` loop to print each habit's line, then one more `console.log` for the summary.
3. `habits.filter((h) => h.done).length` gives you how many are done — useful for `summary`.
