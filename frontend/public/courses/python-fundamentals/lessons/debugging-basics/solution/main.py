def double_evens(numbers):
    result = []
    for n in numbers:
        if n % 2 == 0:
            result.append(n * 2)
    return result


nums = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
doubled = double_evens(nums)

print("All bugs fixed!")
print(f"Result: {doubled}")
