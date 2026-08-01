# Debugging Basics — Fix the Bugs!
# This code has 4 bugs. Fix them all so it prints:
#   All bugs fixed!
#   Result: [4, 8, 12, 16, 20]

def double_evens(numbers)
    result = []
    for n in numbers:
        if n % 2 == 1:
            result.append(n * 2)
    return results

nums = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
doubled = double_evens(nums)

print("All bugs fixed!")
print("Result: " + doubled)
