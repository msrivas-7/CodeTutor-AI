class Counter:
    def __init__(self, start=0):
        self.value = start

    def increment(self):
        self.value += 1

    def reset(self):
        self.value = 0
