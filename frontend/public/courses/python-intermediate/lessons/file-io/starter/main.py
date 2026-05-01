notes = ["pick up groceries", "call mom", "finish lesson"]

# TODO: write each note to "notes.txt" (one per line) using `with open(..., "w") as f:`.

# TODO: read "notes.txt" back into a list of lines (no trailing newlines)
#       using `with open(..., "r") as f:`. Call the list `lines`.
lines = []

print(f"wrote {len(lines)} notes:")
for i in range(1, len(lines) + 1):
    print(f"{i}. {lines[i - 1]}")
