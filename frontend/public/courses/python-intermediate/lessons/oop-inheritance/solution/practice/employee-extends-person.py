class Person:
    def __init__(self, name):
        self.name = name

    def describe(self):
        return self.name


class Employee(Person):
    def __init__(self, name, salary):
        super().__init__(name)
        self.salary = salary

    def describe(self):
        return f"{self.name} (${self.salary})"
