class BankAccount:
    def __init__(self, owner, balance=0):
        self.owner = owner
        self.balance = balance

    def deposit(self, amount):
        self.balance += amount

    def withdraw(self, amount):
        if amount > self.balance:
            raise ValueError("insufficient funds")
        self.balance -= amount


acc = BankAccount("Alice", 100)
acc.deposit(50)
acc.withdraw(30)

try:
    acc.withdraw(1000)
except ValueError as e:
    print(f"error: {e}")

print(f"{acc.owner}'s balance: {acc.balance}")
