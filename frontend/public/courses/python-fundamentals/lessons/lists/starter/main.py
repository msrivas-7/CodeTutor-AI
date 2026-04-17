# Lists — Clean and Summarize

raw = input("Enter comma-separated numbers: ")
parts = raw.split(",")
numbers = []
for x in parts:
    numbers.append(int(x.strip()))

print(f"Original: {numbers}")

# TODO: Append 0 to the list

# TODO: Remove negative numbers (build a new list, don't modify while iterating)

# TODO: Print the cleaned list

# TODO: Print the sum and average of the cleaned list
