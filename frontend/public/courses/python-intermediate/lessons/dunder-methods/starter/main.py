class Money:
    def __init__(self, amount, currency):
        self.amount = amount
        self.currency = currency

    def __str__(self):
        # TODO: return f"{self.amount} {self.currency}"
        pass

    def __repr__(self):
        # TODO: return f"Money({self.amount}, {self.currency!r})"
        pass

    def __eq__(self, other):
        # TODO: isinstance(other, Money) check, then compare both attributes
        pass


m1 = Money(100, "USD")
m2 = Money(100, "USD")
m3 = Money(50, "USD")

print(m1)
print(repr(m1))
print(m1 == m2)
print(m1 == m3)
