def fibonacci():
    a, b = 0, 1
    while True:
        yield a
        a, b = b, a + b


fib = fibonacci()
first_10 = [next(fib) for _ in range(10)]

print(f"first 10 fib: {first_10}")
print(f"sum: {sum(first_10)}")
