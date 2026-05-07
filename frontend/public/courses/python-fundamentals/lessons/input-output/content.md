# Input and Output

So far you've only printed hard-coded values. Now you'll make your program interactive by reading input from the user.

## What you'll learn

- How to read text input with `input()`
- How to convert strings to numbers with `int()` and `float()`
- A cleaner way to format output with **f-strings**
- How to combine input and output in a useful program

## Instructions

1. The starter code has a greeting program that asks for a name.
2. Extend it to also ask for the user's **birth year**.
3. Calculate their approximate age (use 2025 as the current year).
4. Print a message like: `"Hi Alice! You are about 25 years old."`

Use the **stdin** tab in the output panel to provide test input (one value per line).

## Key concepts

`input()` always returns a **string**, even if the user types a number:

```python
name = input("What is your name? ")     # returns str
year = input("What year were you born? ") # returns str — "1999", not 1999
```

To do math with the input, **convert** it first:

```python
year = int(input("What year were you born? "))
age = 2025 - year
```

Common conversions:
- `int("42")` → `42` (whole number)
- `float("3.14")` → `3.14` (decimal)
- `str(42)` → `"42"` (back to text)

**f-strings** are a cleaner way to do what `+` and `str()` did in the last lesson. Put `f` before the opening quote and drop variables straight into the string with `{}`:

```python
print("Age: " + str(age))     # the long way (lesson 2)
print(f"Age: {age}")          # the f-string way (same output)
```

You don't have to call `str()` — f-strings convert numbers, booleans, floats automatically.

## Hints

- `input()` pauses the program and waits for a line of text. In this editor, input comes from the **stdin** tab.
- If you forget `int()`, you'll get a `TypeError` when you try to subtract.
- Put each input prompt on its own line in the stdin tab.
