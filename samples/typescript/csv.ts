export interface Row {
  [key: string]: string;
}

export function parseCsv(text: string): Row[] {
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    const row: Row = {};
    header.forEach((h, i) => {
      row[h] = cells[i] ?? "";
    });
    return row;
  });
}

export interface Stats {
  mean: number;
  min: number;
  max: number;
}

export function summarize(nums: number[]): Stats {
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  return { mean, min: Math.min(...nums), max: Math.max(...nums) };
}
