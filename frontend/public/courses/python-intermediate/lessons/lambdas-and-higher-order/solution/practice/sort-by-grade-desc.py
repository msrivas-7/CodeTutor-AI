def sort_by_grade_desc(students):
    return sorted(students, key=lambda s: s[1], reverse=True)
