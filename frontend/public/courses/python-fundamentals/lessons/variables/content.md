# Variables and Strings

In lesson 1 you wrote `print("Hello, [your name]!")` — the text was hard-coded inside the parentheses. What if you want to use that name in five different places? Or change it later? You'd be editing the same string everywhere.

A **variable** is a labeled box that holds a value. You put a value in once, then refer to it by name as many times as you want.

## What you'll learn

- How to create a variable with `=`
- How to glue strings together with `+` (called **concatenation**)
- How to turn a number into text with `str()` so you can mix it with words

## Instructions

1. The starter has two variables already:

   ```python
   name = "Alice"
   age = 25
   ```

2. Add two `print()` lines so the output is exactly:

   ```
   Name: Alice
   Age: 25
   ```

3. Click **Run** to see your output, then **Check** to confirm.

## Key concepts

**Assignment** uses `=`. The variable name goes on the left, the value on the right:

```python
name = "Alice"      # name now refers to the string "Alice"
age = 25            # age now refers to the number 25
```

**Concatenation** with `+` glues strings together:

```python
print("Hello, " + name)   # → Hello, Alice
```

The `+` is the same operator you use for math, but with strings it joins them end-to-end instead of adding numbers.

**`str()` converts a number to text** so you can join it with strings:

```python
print("Age: " + str(age))   # → Age: 25
```

If you tried `print("Age: " + age)` without `str()`, Python would complain — it can't directly mix text and a number with `+`.

## Hints

- Two `print()` calls — one per line of output.
- For the name line: `print("Name: " + name)`.
- For the age line, wrap the age in `str()` first: `print("Age: " + str(age))`.
- Spaces and capitalization in the strings have to match the goal exactly.
