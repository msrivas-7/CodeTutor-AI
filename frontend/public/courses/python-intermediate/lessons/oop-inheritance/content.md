# Inheritance & super()

Last lesson you wrote a `BankAccount` class. Suppose now you want a `SavingsAccount` — almost the same thing, but with an interest rate and a method to apply interest. You could copy `BankAccount` and add the new bits. But duplicate code drifts: a bug fixed in one stops getting fixed in the other.

*Inheritance* lets a new class build on an existing one without copying. The new class gets every method and attribute of the parent for free, and you only write what's actually different. `super()` is the helper that lets a subclass call back to the parent's version of a method when it needs the original behavior plus a little extra.

## What you'll learn

- Define a subclass with `class Child(Parent):`
- Override a parent method, and call back to the original with `super()`
- Recognize when *composition* (one object holds another) is a better fit than inheritance

## Instructions

You're going to model two account types.

Define `Account` with:
- `__init__(self, owner, balance=0)` storing both on `self`
- `deposit(self, amount)` adding to `self.balance`
- `describe(self)` returning the string `"<owner>: <balance>"`

Define `SavingsAccount(Account)` — a subclass — with:
- `__init__(self, owner, balance=0, rate_percent=5)` that stores `rate_percent`, then calls `super().__init__(owner, balance)` to let the parent set up `owner` and `balance`
- `add_interest(self)` that adds `self.balance * self.rate_percent // 100` to `self.balance`. (`//` is *integer* division — it keeps the balance a whole number. Plain `/` would give you `25.0` instead of `25` and break the expected output.)
- `describe(self)` that returns `"<parent's describe()> (<rate_percent>% interest)"` — use `super().describe()` to avoid duplicating the parent's string format

Then in the script body:

```python
acc = Account("Alice", 100)
acc.deposit(50)
print(acc.describe())

sav = SavingsAccount("Bob", 200, rate_percent=10)
sav.deposit(50)
sav.add_interest()
print(sav.describe())
```

Your output must match exactly:

```
Alice: 150
Bob: 275 (10% interest)
```

## Key concepts

### Subclassing

```python
class Animal:
    def speak(self):
        return "..."

class Dog(Animal):
    def speak(self):
        return "Woof!"
```

The `(Animal)` after `Dog` is what makes it a subclass. `Dog` inherits everything from `Animal` and *overrides* `speak`. If you'd written `class Cat(Animal):` with no body, `Cat` would behave identically to `Animal`.

### super()

When you override a method but still want the parent's behavior, call `super().method(...)`:

```python
class Employee(Person):
    def __init__(self, name, salary):
        super().__init__(name)   # let Person set self.name
        self.salary = salary
```

`super()` finds the parent class and gives you a way to call its methods. The big win is you don't have to spell out `Person.__init__(self, name)` — if you change the parent later, the subclass still does the right thing.

A subtle point: `super().__init__(...)` does not happen automatically. If you write a subclass `__init__` that doesn't call it, the parent's setup never runs. Forgetting that line is one of the most common inheritance bugs.

### Override, don't expand

When you override a method, you decide whether to *replace* the parent's logic or *extend* it. If extending, call `super().method(...)` first (or last, depending on what you want) and then add the new bit:

```python
class SavingsAccount(Account):
    def describe(self):
        return f"{super().describe()} ({self.rate_percent}% interest)"
```

If replacing, just write the new logic. There's no rule that says you *must* call `super()` — call it when the parent's work is something you'd otherwise have to copy.

### Composition over inheritance

Inheritance is seductive — it looks free — but it tightly couples two classes. Every change to the parent risks breaking the children. A good question to ask before reaching for inheritance: **"Is a subclass really a kind of the parent, or does it just *use* the parent?"** A `Dog` is an `Animal` (inheritance fits). A `Car` *has* an `Engine` — it is not an `Engine`. That's *composition*: the car holds an engine as an attribute and delegates to it.

```python
class Engine:
    def start(self):
        return "vroom"

class Car:
    def __init__(self):
        self.engine = Engine()

    def start(self):
        return self.engine.start()
```

Most OO codebases that age badly do so because someone reached for inheritance when composition would have done. The default should be composition; inheritance is the move when you have a real "is-a" relationship and the subclass would otherwise duplicate most of the parent.

## Hints

(These are surfaced by the tutor on request — they don't auto-reveal.)

1. Two classes. Get `Account` working first — it's just a smaller version of last lesson's `BankAccount` with a `describe` method. Then make `SavingsAccount(Account)` reuse what's already there with `super()`.
2. In `SavingsAccount.__init__`, call `super().__init__(owner, balance)` to let `Account` set up the basics, then add `self.rate_percent = rate_percent`. In `SavingsAccount.describe`, call `super().describe()` to get `"<owner>: <balance>"`, then tack `" (<rate>% interest)"` on the end with an f-string.
3. The same shape on a smaller example:
```python
class Greeter:
    def greet(self):
        return "hello"

class LoudGreeter(Greeter):
    def greet(self):
        return super().greet().upper() + "!"

LoudGreeter().greet()  # "HELLO!"
```
