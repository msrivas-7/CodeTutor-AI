# Loops

Loops let you run the same code multiple times. Instead of writing `print()` ten times, you write it once inside a loop.

## What you'll learn

- `for` loops to iterate a known number of times
- `range()` to generate sequences of numbers
- `while` loops for condition-based repetition
- `break` and `continue` for loop control

## Instructions

1. Write a `for` loop that prints the **multiplication table** for a number read from stdin.
2. Print each line as: `"N x i = result"` for i from 1 to 10.

### Bonus challenge

3. After the table, use a `while` loop to find the **smallest power of 2** that is greater than the input number. Print it. (This part is optional — try it once your for loop works!)

Example output for input `7`:
```
7 x 1 = 7
7 x 2 = 14
7 x 3 = 21
7 x 4 = 28
7 x 5 = 35
7 x 6 = 42
7 x 7 = 49
7 x 8 = 56
7 x 9 = 63
7 x 10 = 70
Smallest power of 2 greater than 7: 8
```

## Key concepts

**for loop** with `range()`:

```python
for i in range(1, 11):    # i = 1, 2, 3, ..., 10
    print(i)
```

`range(start, stop)` generates numbers from `start` up to (but not including) `stop`.

**while loop** runs as long as its condition is true:

```python
power = 1
while power <= n:
    power = power * 2
```

**break** exits the loop immediately. **continue** skips to the next iteration.

## Hints

- `range(1, 11)` gives you 1 through 10 (the stop value is exclusive).
- For the power-of-2 part, start at 1 and keep doubling until you exceed the input.
- Make sure your while loop has a condition that eventually becomes false — otherwise it runs forever.
