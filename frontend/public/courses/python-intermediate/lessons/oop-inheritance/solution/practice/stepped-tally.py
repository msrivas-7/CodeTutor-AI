class Tally:
    def __init__(self, start=0):
        self.value = start

    def increment(self):
        self.value += 1


class SteppedTally(Tally):
    def __init__(self, start=0, step=1):
        super().__init__(start)
        self.step = step

    def increment(self):
        self.value += self.step
