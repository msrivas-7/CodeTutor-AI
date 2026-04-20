# Variables and strings

Repeating the same value over and over gets tedious — and error-prone. Variables let you name a value once and reuse it. In this lesson you'll store a name and an age in variables, then build a sentence that includes both.

## What you'll learn

- Declare variables with `const` and `let`
- Combine strings with `+` or template literals
- Pick `const` vs `let` based on whether the value should change

## Instructions

Create two variables:

- `name`, a string, set to `"Ada"`
- `age`, a number, set to `36`

Then print exactly:

```
Hi, I'm Ada and I'm 36 years old.
```

Use **at least one** `const` in your solution (any of the variables is fine — they don't change).

## Key concepts

### Declaring variables

```javascript
const name = "Ada";
let age = 36;
```

- `const` declares a value that **won't** be reassigned. Use it by default.
- `let` declares a value that **will** change (counters, accumulators, etc.).

Reassigning a `const` throws an error; reassigning a `let` is fine:

```javascript
let count = 0;
count = count + 1;  // OK

const pi = 3.14;
pi = 3;             // TypeError: Assignment to constant variable.
```

### Joining strings

Two ways to build a sentence out of variables:

**Concatenation with `+`:**

```javascript
console.log("Hi, I'm " + name + " and I'm " + age + " years old.");
```

**Template literals (backticks):**

```javascript
console.log(`Hi, I'm ${name} and I'm ${age} years old.`);
```

Template literals are usually easier to read — especially when you have multiple variables or want to write text that includes quote characters. The `${...}` syntax drops a variable (or any expression) straight into the string.

## Hints

1. You need two variables and one `console.log`.
2. Use `const name = "Ada";` and pick `const` or `let` for `age`.
3. `console.log(\`Hi, I'm ${name} and I'm ${age} years old.\`);`
