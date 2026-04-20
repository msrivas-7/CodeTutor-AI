# Arrays

An array is an ordered list of values. You'll reach for arrays any time you have "a list of things" — numbers, names, todo items, etc.

## What you'll learn

- Create arrays with `[value1, value2, ...]`
- Read elements by index (`arr[0]`) and check the size with `arr.length`
- Iterate with `for...of`
- Transform arrays with `.map(...)` and `.filter(...)`

## Instructions

Write a function `sumOfSquares(nums)` that takes an array of numbers and returns the **sum of each number squared**. For example:

- `sumOfSquares([1, 2, 3])` → `14` (because 1 + 4 + 9)
- `sumOfSquares([])` → `0`

## Key concepts

### Creating and indexing arrays

```javascript
const colors = ["red", "green", "blue"];
console.log(colors[0]);      // "red"
console.log(colors.length);  // 3
```

Indexing starts at `0`, and `colors[colors.length - 1]` is the last item.

### Adding and iterating

```javascript
const numbers = [];
numbers.push(10);
numbers.push(20);

for (const n of numbers) {
  console.log(n);
}
```

`push` appends. `for...of` walks each element without managing a counter.

### Transforming: map and filter

These return **new** arrays — the originals are untouched.

```javascript
const doubled = [1, 2, 3].map((n) => n * 2);
// [2, 4, 6]

const positives = [-2, -1, 0, 3, 7].filter((n) => n > 0);
// [3, 7]
```

The `(n) => expression` syntax is an **arrow function** — a compact way to write a function inline. It's exactly like writing:

```javascript
function double(n) { return n * 2; }
```

### Reducing to a single value

When you need to collapse an array into one value (a sum, a count, a max), `.reduce` is the tool:

```javascript
const total = [1, 2, 3, 4].reduce((acc, n) => acc + n, 0);
// 10
```

The second argument (`0` here) is the starting accumulator.

## Hints

1. Each element squared — then add them all up.
2. Map squares the numbers, then sum them with `.reduce` or a loop.
3. `return nums.map((n) => n * n).reduce((a, b) => a + b, 0);`
