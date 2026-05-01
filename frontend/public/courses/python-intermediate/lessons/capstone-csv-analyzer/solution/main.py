sales = [
    ("2026-01-01", "widget", 100),
    ("2026-01-02", "widget", 150),
    ("2026-01-03", "gadget", 200),
    ("2026-01-03", "widget", 50),
]

with open("sales.csv", "w") as f:
    f.write("date,product,amount\n")
    for date, product, amount in sales:
        f.write(f"{date},{product},{amount}\n")

with open("sales.csv", "r") as f:
    lines = f.read().splitlines()

rows = []
for line in lines[1:]:
    date, product, amount = line.split(",")
    rows.append((date, product, int(amount)))

total = sum(r[2] for r in rows)
products = sorted({r[1] for r in rows})

totals_by_product = {}
for _date, product, amount in rows:
    totals_by_product[product] = totals_by_product.get(product, 0) + amount

top = max(totals_by_product, key=lambda p: totals_by_product[p])

print(f"total sales: {total}")
print(f"products: {products}")
print(f"top product: {top} ({totals_by_product[top]})")
