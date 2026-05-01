inputs = ["42", "hello", "7", "", "-3"]

parsed = []
skipped = []

for s in inputs:
    try:
        parsed.append(int(s))
    except ValueError:
        skipped.append(s)

print(f"parsed: {parsed}")
print(f"skipped: {skipped}")
