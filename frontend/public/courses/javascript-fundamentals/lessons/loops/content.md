# Loops

Writing `console.log(1); console.log(2); console.log(3); ...` up to 1000 is a nightmare. Loops fix that — they let you run the same block of code over and over, usually with a variable that changes each time.

## What you'll learn

- Write a `for` loop with a counter
- Write a `while` loop with a stop condition
- Pick the right one for the job

## Instructions

Use a `for` loop to print the numbers **1 through 5**, each on its own line:

```
1
2
3
4
5
```

Your solution must use a `for` loop.

## Key concepts

### The `for` loop

`for` is three things separated by semicolons: where to start, when to keep going, and what to change each step.

```javascript
for (let i = 0; i < 3; i++) {
  console.log(i);
}
// prints: 0, 1, 2
```

- `let i = 0` — initialize the counter (runs once before the loop starts)
- `i < 3` — keep going while this is `true` (checked *before* each iteration)
- `i++` — shorthand for `i = i + 1`, runs *after* each iteration

### The `while` loop

`while` is simpler: just a condition. The loop keeps running until the condition is `false`.

```javascript
let n = 100;
while (n > 1) {
  n = n / 2;
  console.log(n);
}
```

Use `while` when the number of iterations depends on logic inside the loop, not a known count upfront.

### Don't forget to change the variable

This is an infinite loop:

```javascript
let i = 0;
while (i < 5) {
  console.log(i);
  // oops — never changed i
}
```

If the loop body doesn't change the variable in the condition, it runs forever.

## Hints

1. Start at 1 and stop after 5.
2. `for (let i = 1; i <= 5; i++) { ... }`
3. Inside the body: `console.log(i);`
