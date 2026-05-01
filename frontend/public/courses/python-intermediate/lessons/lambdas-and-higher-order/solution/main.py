books = [("Moby Dick", 635), ("Frog", 32), ("Anne", 320)]

sorted_titles = [b[0] for b in sorted(books, key=lambda b: b[1])]
long_titles = [b[0] for b in filter(lambda b: b[1] > 200, books)]
titles_upper = list(map(lambda b: b[0].upper(), books))

print(f"sorted by pages: {sorted_titles}")
print(f"long books: {long_titles}")
print(f"titles upper: {titles_upper}")
