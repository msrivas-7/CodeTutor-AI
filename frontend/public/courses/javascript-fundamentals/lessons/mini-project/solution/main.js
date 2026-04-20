function addHabit(habits, name) {
  return [...habits, { name, done: false }];
}

function markDone(habits, name) {
  return habits.map((h) => (h.name === name ? { ...h, done: true } : h));
}

function summary(habits) {
  const done = habits.filter((h) => h.done).length;
  return `${done} of ${habits.length} habits done`;
}

function main() {
  let habits = [];
  habits = addHabit(habits, "read");
  habits = addHabit(habits, "walk");
  habits = addHabit(habits, "meditate");
  habits = markDone(habits, "walk");
  for (const h of habits) {
    console.log(`${h.name}: ${h.done ? "done" : "todo"}`);
  }
  console.log(summary(habits));
}

main();
