import { create } from "zustand";
import type { Language, ProjectFile } from "../types";

interface Starter {
  files: ProjectFile[];
  // Pre-filled stdin so first-run "just works". Each starter's main reads
  // stdin and falls back to a helpful message if the textarea is cleared.
  stdin: string;
}

const STARTER: Record<Language, Starter> = {
  python: {
    stdin: "12 4 7 9 15 3 8 11 6 10\n",
    files: [
      {
        path: "main.py",
        content:
          'import sys\n' +
          'from stats import mean, median, variance\n\n' +
          'tokens = sys.stdin.read().split()\n' +
          'if not tokens:\n' +
          '    print("(no input — paste whitespace-separated numbers into the stdin tab)")\n' +
          '    sys.exit(0)\n\n' +
          'values = [float(t) for t in tokens]\n' +
          'print(f"values : {values}")\n' +
          'print(f"mean   : {mean(values):.2f}")\n' +
          'print(f"median : {median(values):.2f}")\n' +
          'print(f"var    : {variance(values):.2f}")\n',
      },
      {
        path: "stats.py",
        content:
          'def mean(values):\n' +
          '    return sum(values) / len(values)\n\n\n' +
          'def median(values):\n' +
          '    s = sorted(values)\n' +
          '    n = len(s)\n' +
          '    mid = n // 2\n' +
          '    if n % 2 == 0:\n' +
          '        return (s[mid - 1] + s[mid]) / 2\n' +
          '    return s[mid]\n\n\n' +
          'def variance(values):\n' +
          '    mu = mean(values)\n' +
          '    return sum((x - mu) ** 2 for x in values) / len(values)\n',
      },
    ],
  },
  javascript: {
    stdin:
      'the quick brown fox jumps over the lazy dog\n' +
      'the dog barks and the fox runs away\n' +
      'the quick fox is quick and the dog is lazy\n',
    files: [
      {
        path: "main.js",
        content:
          'const { wordFrequency, topN } = require("./frequency.js");\n\n' +
          'let text = "";\n' +
          'process.stdin.setEncoding("utf8");\n' +
          'process.stdin.on("data", (chunk) => { text += chunk; });\n' +
          'process.stdin.on("end", () => {\n' +
          '  if (!text.trim()) {\n' +
          '    console.log("(no input — paste text into the stdin tab)");\n' +
          '    return;\n' +
          '  }\n' +
          '  const freq = wordFrequency(text);\n' +
          '  const top = topN(freq, 5);\n' +
          '  console.log("top 5 words:");\n' +
          '  for (const [word, count] of top) {\n' +
          '    console.log(`  ${word.padEnd(10)} ${count}`);\n' +
          '  }\n' +
          '});\n',
      },
      {
        path: "frequency.js",
        content:
          'function wordFrequency(text) {\n' +
          '  const counts = new Map();\n' +
          '  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];\n' +
          '  for (const w of words) {\n' +
          '    counts.set(w, (counts.get(w) ?? 0) + 1);\n' +
          '  }\n' +
          '  return counts;\n' +
          '}\n\n' +
          'function topN(freq, n) {\n' +
          '  return [...freq.entries()]\n' +
          '    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))\n' +
          '    .slice(0, n);\n' +
          '}\n\n' +
          'module.exports = { wordFrequency, topN };\n',
      },
    ],
  },
  c: {
    stdin: "3 1 4 1 5 9 2 6 5 3\n",
    files: [
      {
        path: "main.c",
        content:
          '#include <stdio.h>\n' +
          '#include "mathx.h"\n\n' +
          '#define CAP 100\n\n' +
          'int main(void) {\n' +
          '    int nums[CAP];\n' +
          '    int n = 0, x;\n' +
          '    while (n < CAP && scanf("%d", &x) == 1) {\n' +
          '        nums[n++] = x;\n' +
          '    }\n' +
          '    if (n == 0) {\n' +
          '        printf("(no input — paste whitespace-separated integers into the stdin tab)\\n");\n' +
          '        return 0;\n' +
          '    }\n' +
          '    printf("count  = %d\\n", n);\n' +
          '    printf("sum    = %d\\n", array_sum(nums, n));\n' +
          '    printf("max    = %d\\n", array_max(nums, n));\n' +
          '    printf("%d! = %ld\\n", n, factorial(n));\n' +
          '    return 0;\n' +
          '}\n',
      },
      {
        path: "mathx.c",
        content:
          '#include "mathx.h"\n\n' +
          'int array_sum(const int *arr, int n) {\n' +
          '    int total = 0;\n' +
          '    for (int i = 0; i < n; i++) {\n' +
          '        total += arr[i];\n' +
          '    }\n' +
          '    return total;\n' +
          '}\n\n' +
          'int array_max(const int *arr, int n) {\n' +
          '    int best = arr[0];\n' +
          '    for (int i = 1; i < n; i++) {\n' +
          '        if (arr[i] > best) best = arr[i];\n' +
          '    }\n' +
          '    return best;\n' +
          '}\n\n' +
          'long factorial(int n) {\n' +
          '    long r = 1;\n' +
          '    for (int i = 2; i <= n; i++) {\n' +
          '        r *= i;\n' +
          '    }\n' +
          '    return r;\n' +
          '}\n',
      },
      {
        path: "mathx.h",
        content:
          '#ifndef MATHX_H\n' +
          '#define MATHX_H\n\n' +
          'int array_sum(const int *arr, int n);\n' +
          'int array_max(const int *arr, int n);\n' +
          'long factorial(int n);\n\n' +
          '#endif\n',
      },
    ],
  },
  cpp: {
    stdin:
      'racecar\n' +
      'hello\n' +
      'A man a plan a canal Panama\n' +
      'not a palindrome\n' +
      'step on no pets\n',
    files: [
      {
        path: "main.cpp",
        content:
          '#include <iostream>\n' +
          '#include <string>\n' +
          '#include "strings.h"\n\n' +
          'int main() {\n' +
          '    std::string line;\n' +
          '    bool any = false;\n' +
          '    while (std::getline(std::cin, line)) {\n' +
          '        any = true;\n' +
          '        std::cout << (is_palindrome(line) ? "[yes] " : "[no ] ")\n' +
          '                  << line << "  (reversed: " << reverse(line) << ")\\n";\n' +
          '    }\n' +
          '    if (!any) {\n' +
          '        std::cout << "(no input — paste one phrase per line into the stdin tab)\\n";\n' +
          '    }\n' +
          '    return 0;\n' +
          '}\n',
      },
      {
        path: "strings.cpp",
        content:
          '#include <cctype>\n' +
          '#include <string>\n' +
          '#include "strings.h"\n\n' +
          'std::string reverse(const std::string &s) {\n' +
          '    return std::string(s.rbegin(), s.rend());\n' +
          '}\n\n' +
          'bool is_palindrome(const std::string &s) {\n' +
          '    std::string cleaned;\n' +
          '    for (char c : s) {\n' +
          '        if (std::isalnum(static_cast<unsigned char>(c))) {\n' +
          '            cleaned.push_back(std::tolower(static_cast<unsigned char>(c)));\n' +
          '        }\n' +
          '    }\n' +
          '    int i = 0;\n' +
          '    int j = static_cast<int>(cleaned.size()) - 1;\n' +
          '    while (i < j) {\n' +
          '        if (cleaned[i] != cleaned[j]) return false;\n' +
          '        i++;\n' +
          '        j--;\n' +
          '    }\n' +
          '    return true;\n' +
          '}\n',
      },
      {
        path: "strings.h",
        content:
          '#pragma once\n\n' +
          '#include <string>\n\n' +
          'std::string reverse(const std::string &s);\n' +
          'bool is_palindrome(const std::string &s);\n',
      },
    ],
  },
  typescript: {
    stdin:
      'name,score\n' +
      'alice,92\n' +
      'bob,78\n' +
      'carol,85\n' +
      'dave,64\n' +
      'eve,90\n',
    files: [
      {
        path: "main.ts",
        content:
          'import { parseCsv, summarize } from "./csv.js";\n\n' +
          'let raw = "";\n' +
          'process.stdin.setEncoding("utf8");\n' +
          'process.stdin.on("data", (chunk: string) => { raw += chunk; });\n' +
          'process.stdin.on("end", () => {\n' +
          '  if (!raw.trim()) {\n' +
          '    console.log("(no input — paste CSV into the stdin tab)");\n' +
          '    return;\n' +
          '  }\n' +
          '  const rows = parseCsv(raw);\n' +
          '  const scores = rows.map((r) => Number(r.score)).filter((n) => !Number.isNaN(n));\n' +
          '  const stats = summarize(scores);\n' +
          '  console.log(`rows   : ${rows.length}`);\n' +
          '  console.log(`mean   : ${stats.mean.toFixed(2)}`);\n' +
          '  console.log(`min    : ${stats.min}`);\n' +
          '  console.log(`max    : ${stats.max}`);\n' +
          '});\n',
      },
      {
        path: "csv.ts",
        content:
          'export interface Row {\n' +
          '  [key: string]: string;\n' +
          '}\n\n' +
          'export function parseCsv(text: string): Row[] {\n' +
          '  const lines = text.trim().split(/\\r?\\n/);\n' +
          '  const header = lines[0].split(",");\n' +
          '  return lines.slice(1).map((line) => {\n' +
          '    const cells = line.split(",");\n' +
          '    const row: Row = {};\n' +
          '    header.forEach((h, i) => {\n' +
          '      row[h] = cells[i] ?? "";\n' +
          '    });\n' +
          '    return row;\n' +
          '  });\n' +
          '}\n\n' +
          'export interface Stats {\n' +
          '  mean: number;\n' +
          '  min: number;\n' +
          '  max: number;\n' +
          '}\n\n' +
          'export function summarize(nums: number[]): Stats {\n' +
          '  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;\n' +
          '  return { mean, min: Math.min(...nums), max: Math.max(...nums) };\n' +
          '}\n',
      },
    ],
  },
  go: {
    stdin: "3 1 4 1 5 9 2 6 5 3\n",
    files: [
      {
        path: "main.go",
        content:
          'package main\n\n' +
          'import (\n' +
          '\t"bufio"\n' +
          '\t"fmt"\n' +
          '\t"os"\n' +
          '\t"strconv"\n' +
          ')\n\n' +
          'func main() {\n' +
          '\tscanner := bufio.NewScanner(os.Stdin)\n' +
          '\tscanner.Split(bufio.ScanWords)\n' +
          '\tscanner.Buffer(make([]byte, 64*1024), 1024*1024)\n' +
          '\tnums := []int{}\n' +
          '\tfor scanner.Scan() {\n' +
          '\t\tn, err := strconv.Atoi(scanner.Text())\n' +
          '\t\tif err != nil {\n' +
          '\t\t\tcontinue\n' +
          '\t\t}\n' +
          '\t\tnums = append(nums, n)\n' +
          '\t}\n' +
          '\tif len(nums) == 0 {\n' +
          '\t\tfmt.Println("(no input — paste whitespace-separated integers into the stdin tab)")\n' +
          '\t\treturn\n' +
          '\t}\n' +
          '\tfmt.Printf("values : %v\\n", nums)\n' +
          '\tfmt.Printf("sum    : %d\\n", Sum(nums))\n' +
          '\tfmt.Printf("max    : %d\\n", Max(nums))\n' +
          '\tfmt.Printf("count! : %d\\n", Factorial(len(nums)))\n' +
          '}\n',
      },
      {
        path: "mathx.go",
        content:
          'package main\n\n' +
          'func Sum(xs []int) int {\n' +
          '\ttotal := 0\n' +
          '\tfor _, v := range xs {\n' +
          '\t\ttotal += v\n' +
          '\t}\n' +
          '\treturn total\n' +
          '}\n\n' +
          'func Max(xs []int) int {\n' +
          '\tbest := xs[0]\n' +
          '\tfor _, v := range xs[1:] {\n' +
          '\t\tif v > best {\n' +
          '\t\t\tbest = v\n' +
          '\t\t}\n' +
          '\t}\n' +
          '\treturn best\n' +
          '}\n\n' +
          'func Factorial(n int) int64 {\n' +
          '\tvar r int64 = 1\n' +
          '\tfor i := 2; i <= n; i++ {\n' +
          '\t\tr *= int64(i)\n' +
          '\t}\n' +
          '\treturn r\n' +
          '}\n',
      },
    ],
  },
  rust: {
    stdin:
      'circle 2.5\n' +
      'rect 4 3\n' +
      'circle 1.0\n' +
      'rect 5 2\n',
    files: [
      {
        path: "main.rs",
        content:
          'mod shapes;\n\n' +
          'use shapes::{Circle, Rectangle, Shape};\n' +
          'use std::io::{self, BufRead};\n\n' +
          'fn main() {\n' +
          '    let stdin = io::stdin();\n' +
          '    let mut shapes: Vec<Box<dyn Shape>> = Vec::new();\n' +
          '    for line in stdin.lock().lines() {\n' +
          '        let line = line.unwrap_or_default();\n' +
          '        let parts: Vec<&str> = line.split_whitespace().collect();\n' +
          '        if parts.is_empty() { continue; }\n' +
          '        match parts[0] {\n' +
          '            "circle" if parts.len() >= 2 => {\n' +
          '                if let Ok(r) = parts[1].parse() {\n' +
          '                    shapes.push(Box::new(Circle { radius: r }));\n' +
          '                }\n' +
          '            }\n' +
          '            "rect" | "rectangle" if parts.len() >= 3 => {\n' +
          '                if let (Ok(w), Ok(h)) = (parts[1].parse(), parts[2].parse()) {\n' +
          '                    shapes.push(Box::new(Rectangle { width: w, height: h }));\n' +
          '                }\n' +
          '            }\n' +
          '            _ => {}\n' +
          '        }\n' +
          '    }\n' +
          '    if shapes.is_empty() {\n' +
          '        println!("(no input — paste shape specs into the stdin tab, e.g. `circle 2.5` or `rect 4 3`)");\n' +
          '        return;\n' +
          '    }\n' +
          '    for s in &shapes {\n' +
          '        println!("{:<10} area = {:.2}", s.name(), s.area());\n' +
          '    }\n' +
          '    let total: f64 = shapes.iter().map(|s| s.area()).sum();\n' +
          '    println!("total area = {:.2}", total);\n' +
          '}\n',
      },
      {
        path: "shapes.rs",
        content:
          'pub trait Shape {\n' +
          '    fn area(&self) -> f64;\n' +
          '    fn name(&self) -> &\'static str;\n' +
          '}\n\n' +
          'pub struct Circle {\n' +
          '    pub radius: f64,\n' +
          '}\n\n' +
          'impl Shape for Circle {\n' +
          '    fn area(&self) -> f64 {\n' +
          '        std::f64::consts::PI * self.radius * self.radius\n' +
          '    }\n' +
          '    fn name(&self) -> &\'static str {\n' +
          '        "circle"\n' +
          '    }\n' +
          '}\n\n' +
          'pub struct Rectangle {\n' +
          '    pub width: f64,\n' +
          '    pub height: f64,\n' +
          '}\n\n' +
          'impl Shape for Rectangle {\n' +
          '    fn area(&self) -> f64 {\n' +
          '        self.width * self.height\n' +
          '    }\n' +
          '    fn name(&self) -> &\'static str {\n' +
          '        "rectangle"\n' +
          '    }\n' +
          '}\n',
      },
    ],
  },
  ruby: {
    stdin:
      'apple 3 0.50\n' +
      'bread 2 2.25\n' +
      'cheese 1 4.80\n' +
      'apple 2 0.50\n',
    files: [
      {
        path: "main.rb",
        content:
          'require_relative "inventory"\n\n' +
          'inv = Inventory.new\n' +
          'any = false\n\n' +
          'STDIN.each_line do |line|\n' +
          '  parts = line.split\n' +
          '  next if parts.size < 3\n' +
          '  any = true\n' +
          '  inv.add(parts[0], parts[1].to_i, parts[2].to_f)\n' +
          'end\n\n' +
          'unless any\n' +
          '  puts "(no input — paste lines like `apple 3 0.50` into the stdin tab)"\n' +
          '  exit\n' +
          'end\n\n' +
          'inv.each do |item, qty, unit|\n' +
          '  printf("  %-8s x%-2d @ %.2f\\n", item, qty, unit)\n' +
          'end\n\n' +
          'printf("total: %.2f\\n", inv.total)\n',
      },
      {
        path: "inventory.rb",
        content:
          'class Inventory\n' +
          '  def initialize\n' +
          '    @items = Hash.new { |h, k| h[k] = { qty: 0, unit: 0.0 } }\n' +
          '  end\n\n' +
          '  def add(name, qty, unit)\n' +
          '    @items[name][:qty] += qty\n' +
          '    @items[name][:unit] = unit\n' +
          '  end\n\n' +
          '  def each\n' +
          '    @items.each { |name, v| yield name, v[:qty], v[:unit] }\n' +
          '  end\n\n' +
          '  def total\n' +
          '    @items.values.sum { |v| v[:qty] * v[:unit] }\n' +
          '  end\n' +
          'end\n',
      },
    ],
  },
  java: {
    stdin:
      '1 2 3\n' +
      '4 5 6\n' +
      '7 8 9\n',
    files: [
      {
        path: "Main.java",
        content:
          'import java.util.ArrayList;\n' +
          'import java.util.List;\n' +
          'import java.util.Scanner;\n\n' +
          'public class Main {\n' +
          '    public static void main(String[] args) {\n' +
          '        Scanner sc = new Scanner(System.in);\n' +
          '        List<int[]> rows = new ArrayList<>();\n' +
          '        while (sc.hasNextLine()) {\n' +
          '            String line = sc.nextLine().trim();\n' +
          '            if (line.isEmpty()) continue;\n' +
          '            String[] parts = line.split("\\\\s+");\n' +
          '            int[] row = new int[parts.length];\n' +
          '            for (int i = 0; i < parts.length; i++) {\n' +
          '                try { row[i] = Integer.parseInt(parts[i]); }\n' +
          '                catch (NumberFormatException e) { row[i] = 0; }\n' +
          '            }\n' +
          '            rows.add(row);\n' +
          '        }\n' +
          '        if (rows.isEmpty()) {\n' +
          '            System.out.println("(no input — paste matrix rows into the stdin tab)");\n' +
          '            return;\n' +
          '        }\n' +
          '        int[][] m = rows.toArray(new int[0][]);\n\n' +
          '        System.out.println("original:");\n' +
          '        Matrix.print(m);\n\n' +
          '        System.out.println("\\ntranspose:");\n' +
          '        Matrix.print(Matrix.transpose(m));\n\n' +
          '        System.out.println("\\nsum = " + Matrix.sum(m));\n' +
          '        System.out.println("trace = " + Matrix.trace(m));\n' +
          '    }\n' +
          '}\n',
      },
      {
        path: "Matrix.java",
        content:
          'public class Matrix {\n' +
          '    public static int[][] transpose(int[][] m) {\n' +
          '        int rows = m.length;\n' +
          '        int cols = m[0].length;\n' +
          '        int[][] t = new int[cols][rows];\n' +
          '        for (int i = 0; i < rows; i++) {\n' +
          '            for (int j = 0; j < cols; j++) {\n' +
          '                t[j][i] = m[i][j];\n' +
          '            }\n' +
          '        }\n' +
          '        return t;\n' +
          '    }\n\n' +
          '    public static int sum(int[][] m) {\n' +
          '        int total = 0;\n' +
          '        for (int[] row : m) {\n' +
          '            for (int v : row) total += v;\n' +
          '        }\n' +
          '        return total;\n' +
          '    }\n\n' +
          '    public static int trace(int[][] m) {\n' +
          '        int t = 0;\n' +
          '        int n = Math.min(m.length, m[0].length);\n' +
          '        for (int i = 0; i < n; i++) t += m[i][i];\n' +
          '        return t;\n' +
          '    }\n\n' +
          '    public static void print(int[][] m) {\n' +
          '        for (int[] row : m) {\n' +
          '            StringBuilder sb = new StringBuilder("  ");\n' +
          '            for (int v : row) sb.append(String.format("%4d", v));\n' +
          '            System.out.println(sb);\n' +
          '        }\n' +
          '    }\n' +
          '}\n',
      },
    ],
  },
};

export function starterStdin(lang: Language): string {
  return STARTER[lang].stdin;
}

interface ProjectState {
  language: Language;
  files: Record<string, string>;
  activeFile: string | null;
  order: string[];
  // Files currently open as editor tabs, in tab-strip order. The active tab
  // is always the one matching `activeFile`. Separated from `order` (the
  // file-tree order) so the user can reorder tabs independently.
  openTabs: string[];
  setLanguage: (lang: Language) => void;
  setActive: (path: string) => void;
  openFile: (path: string) => void;
  closeTab: (path: string) => void;
  setContent: (path: string, content: string) => void;
  createFile: (path: string, content?: string) => { ok: boolean; error?: string };
  deleteFile: (path: string) => void;
  renameFile: (from: string, to: string) => { ok: boolean; error?: string };
  snapshot: () => ProjectFile[];
  resetToStarter: (lang: Language) => void;
}

function seedFor(lang: Language) {
  const seed = STARTER[lang].files;
  const first = seed[0]?.path ?? null;
  return {
    files: Object.fromEntries(seed.map((f) => [f.path, f.content])),
    order: seed.map((f) => f.path),
    activeFile: first,
    openTabs: first ? [first] : [],
  };
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  language: "python",
  ...seedFor("python"),
  setLanguage: (lang) => set({ language: lang }),
  setActive: (path) => set({ activeFile: path }),
  openFile: (path) =>
    set((s) => ({
      activeFile: path,
      openTabs: s.openTabs.includes(path) ? s.openTabs : [...s.openTabs, path],
    })),
  closeTab: (path) =>
    set((s) => {
      const idx = s.openTabs.indexOf(path);
      if (idx === -1) return s;
      const openTabs = s.openTabs.filter((p) => p !== path);
      // If we closed the active tab, promote the neighbor (prefer the one to
      // the left so closing rightmost tabs doesn't jump the focus around).
      const activeFile =
        s.activeFile === path
          ? openTabs[idx - 1] ?? openTabs[0] ?? null
          : s.activeFile;
      return { openTabs, activeFile };
    }),
  setContent: (path, content) =>
    set((s) => ({ files: { ...s.files, [path]: content } })),
  createFile: (path, content = "") => {
    const s = get();
    if (s.files[path]) return { ok: false, error: "file exists" };
    if (!/^[A-Za-z0-9_./-]+$/.test(path) || path.includes("..")) {
      return { ok: false, error: "invalid path" };
    }
    set({
      files: { ...s.files, [path]: content },
      order: [...s.order, path],
      activeFile: path,
      openTabs: [...s.openTabs, path],
    });
    return { ok: true };
  },
  deleteFile: (path) =>
    set((s) => {
      if (!s.files[path]) return s;
      const files = { ...s.files };
      delete files[path];
      const order = s.order.filter((p) => p !== path);
      const tabIdx = s.openTabs.indexOf(path);
      const openTabs = s.openTabs.filter((p) => p !== path);
      const activeFile =
        s.activeFile === path
          ? tabIdx >= 0
            ? openTabs[tabIdx - 1] ?? openTabs[0] ?? order[0] ?? null
            : order[0] ?? null
          : s.activeFile;
      return { files, order, activeFile, openTabs };
    }),
  renameFile: (from, to) => {
    const s = get();
    if (!s.files[from]) return { ok: false, error: "source not found" };
    if (s.files[to]) return { ok: false, error: "destination exists" };
    if (!/^[A-Za-z0-9_./-]+$/.test(to) || to.includes("..")) {
      return { ok: false, error: "invalid path" };
    }
    const files = { ...s.files, [to]: s.files[from] };
    delete files[from];
    const order = s.order.map((p) => (p === from ? to : p));
    const openTabs = s.openTabs.map((p) => (p === from ? to : p));
    const activeFile = s.activeFile === from ? to : s.activeFile;
    set({ files, order, activeFile, openTabs });
    return { ok: true };
  },
  snapshot: () => {
    const s = get();
    return s.order.map((p) => ({ path: p, content: s.files[p] ?? "" }));
  },
  resetToStarter: (lang) =>
    set({ language: lang, ...seedFor(lang) }),
}));
