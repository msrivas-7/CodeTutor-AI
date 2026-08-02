def analyze_sales(sales, path="sales.csv"):
    # Phase 1: write path with the CSV header and one row per tuple.
    # TODO: with open(path, "w") as f: ...

    # Phase 2: read the same file back into lines.
    lines = []

    # Phase 3: parse typed (date, product, amount) rows.
    rows = []

    # Phase 4: derive the report from rows, not from hard-coded sample values.
    total = 0
    products = []
    totals_by_product = {}
    top = ""
    return total, products, top, totals_by_product


sales = [
    ("2026-01-01", "widget", 100),
    ("2026-01-02", "widget", 150),
    ("2026-01-03", "gadget", 200),
    ("2026-01-03", "widget", 50),
]

total, products, top, totals_by_product = analyze_sales(sales)

print(f"total sales: {total}")
print(f"products: {products}")
print(f"top product: {top} ({totals_by_product.get(top, 0)})")
