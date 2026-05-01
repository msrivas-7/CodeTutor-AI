class Account:
    def __init__(self, owner, balance=0):
        # TODO: store owner and balance on self
        pass

    def deposit(self, amount):
        # TODO: add amount to self.balance
        pass

    def describe(self):
        # TODO: return "<owner>: <balance>"
        pass


class SavingsAccount(Account):
    def __init__(self, owner, balance=0, rate_percent=5):
        # TODO: store rate_percent, then super().__init__(owner, balance)
        pass

    def add_interest(self):
        # TODO: self.balance += self.balance * self.rate_percent // 100
        pass

    def describe(self):
        # TODO: return f"{super().describe()} ({self.rate_percent}% interest)"
        pass


# TODO: build acc = Account("Alice", 100), deposit 50, print acc.describe()
# Then build sav = SavingsAccount("Bob", 200, rate_percent=10),
# deposit 50, add_interest(), print sav.describe().
