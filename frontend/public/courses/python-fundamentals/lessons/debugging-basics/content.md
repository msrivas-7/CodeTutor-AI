# Debugging Basics

Bugs are a normal part of programming. The skill isn't avoiding them — it's finding and fixing them efficiently. Python gives you helpful error messages if you know how to read them.

## What you'll learn

- How to read a Python traceback (error message)
- Common error types and what they mean
- Using `print()` to trace what your code is doing

## Instructions

The starter code has **4 intentional bugs**. Your job is to find and fix all of them so the program runs and prints:

```
All bugs fixed!
Result: [4, 8, 12, 16, 20]
```

Run the code first — read the error message carefully. Fix one bug at a time, re-running after each fix.

## Key concepts

**Reading a traceback:**

```
Traceback (most recent call last):
  File "main.py", line 5, in <module>
    print(total)
NameError: name 'total' is not defined
```

Read from the bottom up:
1. The **error type** and message (`NameError: name 'total' is not defined`)
2. The **line number** (`line 5`)
3. The **code** that caused it (`print(total)`)

**Common errors:**

| Error | What it means |
|-------|--------------|
| `SyntaxError` | Python can't parse your code (typo, missing colon, bad indentation) |
| `NameError` | You used a variable that doesn't exist |
| `TypeError` | You used the wrong type (e.g., adding a string and an int) |
| `IndexError` | You tried to access a list index that's out of range |

**Print debugging:** When the error isn't obvious, add `print()` calls to see what values your variables hold at each step.

## Hints

- Fix one error at a time and re-run.
- The first error Python shows you might hide others — fix it and run again.
- Read the error type first, then the line number. That tells you exactly where to look.
- Compare what you expect a variable to be vs what it actually is.
- Once the crashes are fixed, compare the function's condition with its name: `double_evens` should select even numbers.
