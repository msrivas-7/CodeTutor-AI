# Objects

Arrays hold ordered lists. **Objects** hold labeled properties — values stored under named keys.

## What you'll learn

- Create objects with `{ key: value }` literals
- Read, write, and delete properties
- Iterate over an object's keys or entries

## Instructions

Write a function `formatPerson(person)` that takes an object with `name` and `age` properties and returns a string like `"Ada is 36 years old."`.

Example:

```javascript
formatPerson({ name: "Ada", age: 36 }); // "Ada is 36 years old."
```

## Key concepts

### Object literals

Wrap `key: value` pairs in `{ ... }`:

```javascript
const person = { name: "Ada", age: 36 };
```

Keys are strings (you can leave quotes off if they're valid identifiers). Values can be any type — numbers, strings, arrays, even other objects.

### Reading and writing properties

Two ways to access a property:

```javascript
person.name;        // "Ada"   — dot notation
person["name"];    // "Ada"   — bracket notation
```

Dot notation is shorter; use brackets when the key is in a variable (`person[keyName]`).

Assign with `=`:

```javascript
person.age = 37;
person.city = "London";   // adds a new property
delete person.city;        // removes it
```

### Iterating

`Object.keys(obj)` gives you an array of keys; `Object.entries(obj)` gives `[key, value]` pairs:

```javascript
for (const key of Object.keys(person)) {
  console.log(key, person[key]);
}

for (const [key, value] of Object.entries(person)) {
  console.log(`${key}: ${value}`);
}
```

### Arrays vs. objects

Use an **array** for an ordered list of similar things (`[1, 2, 3]`, `["a", "b"]`). Use an **object** when values have distinct names (`{ name, age, city }`).

## Hints

1. You can pull `name` and `age` straight out of the `person` argument with `person.name` and `person.age`.
2. Template literals (`` `...${value}...` ``) make it easy to build the output string.
3. `` return `${person.name} is ${person.age} years old.`; ``
