# Capstone: CSV Sales Analyzer

The course's first capstone. There's no new concept here — every piece of this lesson is something you've already seen. The point is to wire those pieces together into the shape of a real one-off script: read a file, parse it, aggregate, report. That's most of what data scripts do for a living.

You'll build a small sales analyzer:

1. Write a few sales records to a CSV file (so the script is self-contained).
2. Read them back and parse each line into a typed tuple.
3. Compute a total, the unique product list, and the best-selling product.
4. Print three lines of summary.

## What you'll learn

- Round-trip data through a CSV file using `with open` for both write and read
- Parse and type-convert string columns into structured rows
- Aggregate rows by group with a dict, then pick a top entry with `max(..., key=lambda)`

## Instructions

The starter has the input data — a list of `(date, product, amount)` tuples — and the prints scaffolded.

Your job in `main.py`:

1. **Write `sales.csv`** with a header line `date,product,amount` and one row per tuple, comma-separated.
2. **Read** the file back into `lines` (a list of strings, no trailing newlines).
3. **Parse** each non-header line into a tuple `(date, product, int(amount))` and collect the parsed rows into a list called `rows`.
4. **Compute three values**:
   - `total` — sum of all `amount`s
   - `products` — sorted list of unique product names (use a set comprehension)
   - `top` — the product with the largest total. First aggregate amounts per product into a `totals_by_product` dict, then pick the winning key with `max(d, key=lambda p: d[p])`. The starter's print line already pulls the total back out of the dict via `totals_by_product[top]` — you don't need a separate variable.
5. **Print** three lines:

```
total sales: 500
products: ['gadget', 'widget']
top product: widget (300)
```

## Key concepts (review)

This capstone composes things you already know — here's a one-line refresher of each:

- **`with open(path, "w") as f:`** — write mode, truncates first; close is automatic.
- **`with open(path, "r") as f:`** — read mode; default if you don't specify.
- **`f.read().splitlines()`** — read whole file as a string, split into lines without trailing `\n`.
- **`line.split(",")`** — break a string on commas; returns a list of cells.
- **`int(s)`** — convert a string to an int; raises `ValueError` if it can't.
- **Set comprehension** — `{x for x in xs}` to build a set; `sorted(...)` to get a deterministic list.
- **Dict aggregation** — start with `{}`, iterate, do `d[key] = d.get(key, 0) + amount`.
- **`max(iterable, key=func)`** — pick the element where `func(element)` is largest.

### Putting it together

The "aggregate then pick a winner" shape is the most useful one in this lesson. You'll see it constantly:

```python
totals = {}
for date, product, amount in rows:
    totals[product] = totals.get(product, 0) + amount

top = max(totals, key=lambda p: totals[p])
```

`totals.get(product, 0)` is the canonical "give me the current value, or 0 if missing" pattern — it lets the loop work whether or not we've seen the key before. `max(totals, key=lambda p: totals[p])` iterates the keys and asks for the one with the largest value.

### A note on the `csv` module

In real code you'd reach for the standard library's `csv` module — `csv.reader` handles quoted fields with embedded commas and newlines, which `split(",")` does not. We're parsing manually here so the code shows every step. Once a comma-inside-a-quoted-string shows up in your data, the manual approach falls over and `csv` becomes the right call.

## Hints

(These are surfaced by the tutor on request — they don't auto-reveal.)

1. The script has four phases. Phase 1: write the file with a header line and one row per record. Phase 2: read it back and split into lines. Phase 3: parse each non-header line into a typed tuple. Phase 4: aggregate and report.
2. Aggregate shape:
```python
totals = {}
for date, product, amount in rows:
    totals[product] = totals.get(product, 0) + amount

top = max(totals, key=lambda p: totals[p])
print(f"top product: {top} ({totals[top]})")
```
The total over everything is `sum(r[2] for r in rows)` — a generator expression you've seen before. The product set is `sorted({r[1] for r in rows})` — a set comprehension.
3. The full pipeline at the smallest possible scale, two records of two products:
```python
rows = [("d1", "a", 10), ("d2", "b", 20), ("d3", "a", 5)]
totals = {}
for d, p, n in rows:
    totals[p] = totals.get(p, 0) + n
# totals == {"a": 15, "b": 20}
max(totals, key=lambda p: totals[p])  # "b"
```
