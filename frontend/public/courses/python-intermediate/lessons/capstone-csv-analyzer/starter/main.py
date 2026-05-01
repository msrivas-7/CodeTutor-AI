sales = [
    ("2026-01-01", "widget", 100),
    ("2026-01-02", "widget", 150),
    ("2026-01-03", "gadget", 200),
    ("2026-01-03", "widget", 50),
]

# Phase 1: write sales.csv with header "date,product,amount" then one row per tuple.
# TODO: with open("sales.csv", "w") as f: ...

# Phase 2: read sales.csv back as a list of lines (no trailing newlines).
# TODO: lines = ...
lines = []

# Phase 3: parse each non-header line into a tuple (date, product, int(amount)).
# TODO: build `rows` from lines[1:].
rows = []

# Phase 4: aggregate and report.
# TODO: total = sum of every row's amount
total = 0

# TODO: products = sorted list of unique product names (set comprehension over rows)
products = []

# TODO: build totals_by_product dict, then top = max(...) with a lambda key
totals_by_product = {}
top = ""

print(f"total sales: {total}")
print(f"products: {products}")
print(f"top product: {top} ({totals_by_product.get(top, 0)})")
