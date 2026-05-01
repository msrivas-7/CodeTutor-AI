class Money:
    def __init__(self, amount, currency):
        self.amount = amount
        self.currency = currency

    def __str__(self):
        return f"{self.amount} {self.currency}"

    def __repr__(self):
        return f"Money({self.amount}, {self.currency!r})"

    def __eq__(self, other):
        if not isinstance(other, Money):
            return False
        return self.amount == other.amount and self.currency == other.currency


m1 = Money(100, "USD")
m2 = Money(100, "USD")
m3 = Money(50, "USD")

print(m1)
print(repr(m1))
print(m1 == m2)
print(m1 == m3)
