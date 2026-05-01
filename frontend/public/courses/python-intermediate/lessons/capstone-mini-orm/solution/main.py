class Query:
    def __init__(self, rows):
        self.rows = list(rows)

    def where(self, predicate):
        return Query([r for r in self.rows if predicate(r)])

    def sort_by(self, key):
        return Query(sorted(self.rows, key=key))

    def first(self):
        return self.rows[0] if self.rows else None

    def __iter__(self):
        return iter(self.rows)

    def __len__(self):
        return len(self.rows)

    def __repr__(self):
        return f"Query({len(self.rows)} rows)"


users = [
    {"name": "Alice", "age": 30, "role": "admin"},
    {"name": "Bob", "age": 25, "role": "user"},
    {"name": "Cara", "age": 35, "role": "admin"},
]

q = Query(users)
admins = q.where(lambda r: r["role"] == "admin")
oldest_admin = admins.sort_by(lambda r: -r["age"]).first()

print(f"all users: {len(q)}")
print(f"admins: {len(admins)}")
print(f"oldest admin: {oldest_admin['name']}")
