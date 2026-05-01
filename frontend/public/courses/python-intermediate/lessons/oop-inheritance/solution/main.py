class Account:
    def __init__(self, owner, balance=0):
        self.owner = owner
        self.balance = balance

    def deposit(self, amount):
        self.balance += amount

    def describe(self):
        return f"{self.owner}: {self.balance}"


class SavingsAccount(Account):
    def __init__(self, owner, balance=0, rate_percent=5):
        super().__init__(owner, balance)
        self.rate_percent = rate_percent

    def add_interest(self):
        self.balance += self.balance * self.rate_percent // 100

    def describe(self):
        return f"{super().describe()} ({self.rate_percent}% interest)"


acc = Account("Alice", 100)
acc.deposit(50)
print(acc.describe())

sav = SavingsAccount("Bob", 200, rate_percent=10)
sav.deposit(50)
sav.add_interest()
print(sav.describe())
