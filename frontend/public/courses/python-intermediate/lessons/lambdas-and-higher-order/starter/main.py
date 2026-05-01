books = [("Moby Dick", 635), ("Frog", 32), ("Anne", 320)]

# 1. Sort books by page count (ascending), then build a list of just the titles.
#    Use sorted(books, key=lambda b: b[1]).
sorted_titles = []  # TODO

# 2. Keep books with more than 200 pages, then extract their titles.
#    Use filter(lambda b: b[1] > 200, books).
long_titles = []  # TODO

# 3. Uppercase every title.
#    Use map(lambda b: b[0].upper(), books).
titles_upper = []  # TODO

print(f"sorted by pages: {sorted_titles}")
print(f"long books: {long_titles}")
print(f"titles upper: {titles_upper}")
