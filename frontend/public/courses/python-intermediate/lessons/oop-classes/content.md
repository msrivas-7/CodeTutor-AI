# Classes & Objects

So far when you've needed to bundle pieces of data together you've used a `dict` — `{"name": "Alice", "balance": 100}` and so on. That works, but as the data grows new behaviors, dicts get clunky. You're constantly typing the same keys, and the *operations* on the data live somewhere else as standalone functions.

A *class* is Python's way to fix that: a single shape that bundles data and the functions that act on it. The data is called *instance attributes*; the functions are called *methods*. Defining a class is how you create a new type of thing.

## What you'll learn

- Define a class with `__init__` and instance methods
- Set and read state via `self`
- Recognize when a class is the right shape — and when a function or dict is enough

## Instructions

You're going to model a tiny bank account.

Define a class `BankAccount` with:

- `__init__(self, owner, balance=0)` — store the owner name and the starting balance on `self`.
- `deposit(self, amount)` — add `amount` to `self.balance`.
- `withdraw(self, amount)` — subtract `amount` from `self.balance`. If `amount` is greater than the current balance, raise `ValueError("insufficient funds")`.

Then in script body:

1. Create `acc = BankAccount("Alice", 100)`.
2. Deposit 50, then withdraw 30.
3. Try to withdraw 1000 — wrap that call in `try`/`except ValueError` and print `error: insufficient funds`.
4. Print the final balance as `Alice's balance: 120`.

Your output must match exactly:

```
error: insufficient funds
Alice's balance: 120
```

## Key concepts

### Defining a class

```python
class BankAccount:
    def __init__(self, owner, balance=0):
        self.owner = owner
        self.balance = balance
```

`class BankAccount:` opens a block. Inside, `def __init__` defines the *constructor* — a special method Python calls automatically when you write `BankAccount("Alice", 100)`. `__init__` is your chance to stash the starting state. The arguments after `self` are exactly the arguments the caller passed to the constructor.

### `self` is just a parameter

Every method's first parameter is `self`. It's the instance the method was called on. So when you write `acc.deposit(50)`, Python turns it into roughly `BankAccount.deposit(acc, 50)` — `acc` becomes `self`. That's it. There's no magic. The only reason `self` looks special is that it's always there.

```python
def deposit(self, amount):
    self.balance += amount  # mutate the instance's own state
```

When you assign to `self.foo`, you're writing an attribute onto *this specific instance*. Different `BankAccount` objects have independent `self.balance` values.

### Calling methods

```python
acc = BankAccount("Alice", 100)   # __init__ runs here
acc.deposit(50)                   # acc.balance is now 150
acc.withdraw(30)                  # acc.balance is now 120
print(acc.owner, acc.balance)     # Alice 120
```

Reading attributes (`acc.balance`) and calling methods (`acc.deposit(50)`) use the same `.` — Python figures out which is which.

### When NOT to use a class

Classes have a cost: they're more typing, more vocabulary for a reader, more places to look. Don't reach for one until you have *both* data and behavior that travel together. If you only have data — a record with no operations — a dict or a tuple is usually clearer. If you only have behavior — a single transformation — a function is enough.

A working rule of thumb: the moment you find yourself passing the same dictionary into the same handful of functions, that's the signal to make it a class. Until then, don't.

## Hints

(These are surfaced by the tutor on request — they don't auto-reveal.)

1. Two parts. First, write the `class BankAccount` block with `__init__`, `deposit`, and `withdraw`. Second, write the script body that uses it — including a `try`/`except` around the withdraw that should fail.
2. Inside `withdraw`, check `amount > self.balance` before subtracting; if so, `raise ValueError("insufficient funds")`. Outside the class, the script code looks like ordinary lesson-1 code — it just calls `acc.something(...)` instead of standalone functions.
3. The same shape on a different example:
```python
class Light:
    def __init__(self, color="white"):
        self.color = color
        self.on = False

    def turn_on(self):
        self.on = True

bulb = Light("red")
bulb.turn_on()
print(bulb.color, bulb.on)   # red True
```
