students = [("Alice", 87), ("Bob", 54), ("Cara", 91)]

passing_names = [name for name, grade in students if grade >= 60]
grades_by_name = {name: grade for name, grade in students}
grade_tens = {grade // 10 for name, grade in students}

print(f"passing students: {passing_names}")
print(f"grades by student: {grades_by_name}")
print(f"unique grade tens: {sorted(grade_tens)}")
