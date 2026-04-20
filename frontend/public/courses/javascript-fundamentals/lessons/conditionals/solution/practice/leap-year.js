const year = 2024;
if (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) {
  console.log("leap");
} else {
  console.log("not leap");
}
