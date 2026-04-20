# Functions

Functions are the main unit of reuse in most programs. You give a piece of logic a name, and then *call* that name every time you want it to run — possibly with different inputs.

> From this lesson on, the lesson checker runs tests that **call your function** with various inputs and compare what it returns. Make sure you `return` the answer — not just `console.log` it.

## What you'll learn

- Declare a function with `function name(params) { ... }`
- Accept parameters and `return` a value
- Call a function and use its returned value

## Instructions

Write a function named `greet` that takes one parameter `name` (a string) and **returns** a greeting string formatted like `"Hello, World!"`.

Examples:

- `greet("World")` → `"Hello, World!"`
- `greet("Ada")` → `"Hello, Ada!"`
- `greet("")` → `"Hello, !"`

Use the **Examples** tab above the editor to see the tests your function has to pass. Click **Run examples** to run your code against them, and **Check My Work** to finalize.

## Key concepts

### Declaring a function

```javascript
function add(a, b) {
  return a + b;
}
```

- `function` is the keyword that starts a declaration
- `add` is the function's name
- `(a, b)` are its **parameters** — local variables that get bound to whatever the caller passes in
- Whatever you `return` is the value that shows up where the call was written

### Calling a function

```javascript
const sum = add(3, 4);  // sum is now 7
console.log(sum);       // prints 7
```

### return vs console.log

These are different things — a confusing early stumble.

```javascript
function shout(msg) {
  console.log(msg);   // prints to the output — doesn't hand anything back
}

function shoutBetter(msg) {
  return msg.toUpperCase();   // hands a value back
}

const result = shout("hi");          // result is undefined
const result2 = shoutBetter("hi");   // result2 is "HI"
```

The lesson checker calls your function and inspects what it *returned*. A function that only `console.log`s will fail the tests — tests see whatever is returned, not whatever was printed.

### Template literals are your friend

```javascript
function greet(name) {
  return `Hello, ${name}!`;
}
```

Way easier than splicing with `+`.

## Hints

1. You need `function greet(name) { ... }` — and inside, a single `return`.
2. The result should be formatted like `Hello, X!` where `X` is the name.
3. `return \`Hello, ${name}!\`;`
