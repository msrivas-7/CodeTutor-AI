class Query:
    def __init__(self, rows):
        # TODO: store list(rows) on self.rows
        pass

    def where(self, predicate):
        # TODO: return a new Query of records matching predicate
        pass

    def sort_by(self, key):
        # TODO: return a new Query of records sorted by key
        pass

    def first(self):
        # TODO: return the first record, or None if empty
        pass

    def __iter__(self):
        # TODO: hand off to the underlying list's iterator
        pass

    def __len__(self):
        # TODO: report how many rows the Query holds
        pass

    def __repr__(self):
        # TODO: return a short string like "Query(N rows)" — N is the row count
        pass


users = [
    {"name": "Alice", "age": 30, "role": "admin"},
    {"name": "Bob", "age": 25, "role": "user"},
    {"name": "Cara", "age": 35, "role": "admin"},
]

# TODO: q = Query(users); admins = q.where(...); oldest = admins.sort_by(...).first()
q = Query(users)
admins = Query([])
oldest_admin = {"name": ""}

print(f"all users: {len(q)}")
print(f"admins: {len(admins)}")
print(f"oldest admin: {oldest_admin['name']}")
