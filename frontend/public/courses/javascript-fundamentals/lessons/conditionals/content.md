# Conditionals

Programs get interesting when they make decisions. In this lesson you'll write code that prints different output depending on a value.

## What you'll learn

- Write `if / else if / else` to branch on a condition
- Use comparison operators (`===`, `<`, `>`, `<=`, `>=`, `!==`)
- Combine conditions with `&&` (and), `||` (or), `!` (not)

## Instructions

Given a variable `age` set to `30`, print exactly one of:

- `child` — when `age < 13`
- `teen` — when `age` is between 13 and 17 (inclusive)
- `adult` — when `age >= 18`

Your code must use all three of `if`, `else if`, and `else`.

## Key concepts

### Branching with if / else if / else

```javascript
const score = 72;
if (score >= 90) {
  console.log("A");
} else if (score >= 60) {
  console.log("B");
} else {
  console.log("C");
}
```

Each branch checks its condition in order. As soon as one is `true`, that block runs and the rest are skipped. `else` is the fallback when none of the earlier checks match.

### Comparison operators

| Operator | Meaning |
| --- | --- |
| `===` | equal (strict) |
| `!==` | not equal |
| `<` `<=` | less than / ≤ |
| `>` `>=` | greater than / ≥ |

Prefer `===` over `==` — `===` compares without type coercion, which avoids a family of bugs like `"0" == 0` being `true`.

### Combining conditions

```javascript
if (age >= 13 && age <= 17) console.log("teen");
if (isWeekend || isHoliday) console.log("no school");
if (!isLoggedIn) console.log("please log in");
```

- `&&` — both sides must be `true`
- `||` — either side must be `true`
- `!` — flip a boolean

## Hints

1. Start with `if (age < 13)`.
2. Next comes `else if (age < 18)` — the age range check piggybacks on the previous one failing.
3. The final `else` covers everything else.
