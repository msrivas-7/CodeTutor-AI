notes = ["pick up groceries", "call mom", "finish lesson"]

with open("notes.txt", "w") as f:
    for note in notes:
        f.write(note + "\n")

with open("notes.txt", "r") as f:
    lines = f.read().splitlines()

print(f"wrote {len(lines)} notes:")
for i in range(1, len(lines) + 1):
    print(f"{i}. {lines[i - 1]}")
