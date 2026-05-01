class Account:
    def __init__(self, owner, balance=0):
        # TODO: store owner and balance on self
        pass

    def deposit(self, amount):
        # TODO: add amount to self.balance
        pass

    def describe(self):
        # TODO: return a "<owner>: <balance>" string (use an f-string)
        pass


class SavingsAccount(Account):
    def __init__(self, owner, balance=0, rate_percent=5):
        # TODO: hand owner+balance to the parent's __init__ via super().__init__
        # then save rate_percent on self
        pass

    def add_interest(self):
        # TODO: grow self.balance by rate_percent% — use // (integer division) so it stays a whole number
        pass

    def describe(self):
        # TODO: take the parent's describe() and tack " (X% interest)" onto the end
        pass


# TODO: build acc = Account("Alice", 100), deposit 50, print acc.describe().
# Then build sav = SavingsAccount("Bob", 200, rate_percent=10),
# deposit 50, add_interest(), print sav.describe().
