# Comprehensions — build a list, a dict, and a set in three lines.
#
# `students` is a list of (name, grade) tuples. From it, build:
#   1. passing_names — list of names with grade >= 60
#   2. grades_by_name — dict mapping each name to its grade
#   3. grade_tens — set of the tens digit of every grade (grade // 10)
#
# Then print each on its own line. Output must match content.md exactly.

students = [("Alice", 87), ("Bob", 54), ("Cara", 91)]

# TODO: build passing_names with a list comprehension + an `if` filter
passing_names = []

# TODO: build grades_by_name with a dict comprehension
grades_by_name = {}

# TODO: build grade_tens with a set comprehension
grade_tens = set()

# Sets aren't ordered — sort just for stable printing.
print(f"passing students: {passing_names}")
print(f"grades by student: {grades_by_name}")
print(f"unique grade tens: {sorted(grade_tens)}")
