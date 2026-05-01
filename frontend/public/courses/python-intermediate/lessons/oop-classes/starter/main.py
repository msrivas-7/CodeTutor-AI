class BankAccount:
    def __init__(self, owner, balance=0):
        # TODO: store owner and balance on self
        pass

    def deposit(self, amount):
        # TODO: add amount to self.balance
        pass

    def withdraw(self, amount):
        # TODO: if amount > self.balance, raise ValueError("insufficient funds")
        # otherwise subtract amount from self.balance
        pass


# TODO: create acc = BankAccount("Alice", 100), deposit 50, withdraw 30,
# then try to withdraw 1000 inside try/except ValueError and print
# "error: insufficient funds". Finally print "Alice's balance: 120".
