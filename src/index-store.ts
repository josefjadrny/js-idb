import type { FieldType } from './types.js';

interface IndexEntry {
  value: string | number | boolean;
  id: string;
}

/** Sorted array + binary search index over a single field */
export class Index {
  readonly field: string;
  readonly fieldType: FieldType;
  readonly ignoreCase: boolean;
  private entries: IndexEntry[] = [];

  constructor(field: string, fieldType: FieldType, ignoreCase = false) {
    this.field = field;
    this.fieldType = fieldType;
    this.ignoreCase = ignoreCase;
  }

  private normalize(value: string | number | boolean): string | number | boolean {
    if (this.ignoreCase && typeof value === 'string') {
      return value.toLowerCase();
    }
    return value;
  }

  /** Returns index of first entry with value >= target */
  private lowerBound(target: string | number | boolean): number {
    let lo = 0;
    let hi = this.entries.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.compare(this.entries[mid]!.value, target) < 0) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo;
  }

  private compare(a: string | number | boolean, b: string | number | boolean): number {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  }

  add(id: string, value: string | number | boolean): void {
    const normalized = this.normalize(value);
    const entry: IndexEntry = { value: normalized, id };
    const idx = this.lowerBound(normalized);
    this.entries.splice(idx, 0, entry);
  }

  remove(id: string, value: string | number | boolean): void {
    const normalized = this.normalize(value);
    const idx = this.lowerBound(normalized);
    for (let i = idx; i < this.entries.length; i++) {
      const entry = this.entries[i]!;
      if (entry.value !== normalized) break;
      if (entry.id === id) {
        this.entries.splice(i, 1);
        return;
      }
    }
  }

  /**
   * Query patterns:
   *   Strings: 'josef' (exact), 'josef%' (prefix), '%josef' (suffix), '%josef%' (contains)
   *   Numbers: '30' (exact), '>10', '>=20', '<50', '<=30'
   *   Booleans: 'true', 'false'
   */
  find(query: string): string[] {
    if (this.fieldType === 'number') {
      const rangeMatch = query.match(/^(>=?|<=?)(.+)$/);
      if (rangeMatch) {
        const op = rangeMatch[1]!;
        const num = Number(rangeMatch[2]);
        if (Number.isNaN(num)) {
          throw new Error(`Invalid numeric query: "${query}"`);
        }
        return this.rangeQuery(op, num);
      }
      const num = Number(query);
      if (!Number.isNaN(num)) {
        return this.exactQuery(num);
      }
      throw new Error(`Invalid query for number field: "${query}"`);
    }

    if (this.fieldType === 'boolean') {
      if (query === 'true') return this.exactQuery(true);
      if (query === 'false') return this.exactQuery(false);
      throw new Error(`Invalid query for boolean field: "${query}" (use "true" or "false")`);
    }

    const startsWithWild = query.startsWith('%');
    const endsWithWild = query.endsWith('%');

    if (startsWithWild && endsWithWild && query.length > 1) {
      return this.containsQuery(query.slice(1, -1));
    }
    if (endsWithWild) {
      return this.prefixQuery(query.slice(0, -1));
    }
    if (startsWithWild) {
      return this.suffixQuery(query.slice(1));
    }

    const normalized = this.ignoreCase ? query.toLowerCase() : query;
    return this.exactQuery(normalized);
  }

  private exactQuery(target: string | number | boolean): string[] {
    const idx = this.lowerBound(target);
    const results: string[] = [];
    for (let i = idx; i < this.entries.length; i++) {
      const entry = this.entries[i]!;
      if (entry.value !== target) break;
      results.push(entry.id);
    }
    return results;
  }

  /** O(log n + k) — binary search to prefix start, scan forward */
  private prefixQuery(prefix: string): string[] {
    const normalized = this.ignoreCase ? prefix.toLowerCase() : prefix;
    const idx = this.lowerBound(normalized);
    const results: string[] = [];
    for (let i = idx; i < this.entries.length; i++) {
      const entry = this.entries[i]!;
      const val = String(entry.value);
      if (!val.startsWith(normalized)) break;
      results.push(entry.id);
    }
    return results;
  }

  /** O(n) — must scan all entries */
  private suffixQuery(suffix: string): string[] {
    const normalized = this.ignoreCase ? suffix.toLowerCase() : suffix;
    return this.entries
      .filter(e => String(e.value).endsWith(normalized))
      .map(e => e.id);
  }

  /** O(n) — must scan all entries */
  private containsQuery(sub: string): string[] {
    const normalized = this.ignoreCase ? sub.toLowerCase() : sub;
    return this.entries
      .filter(e => String(e.value).includes(normalized))
      .map(e => e.id);
  }

  private rangeQuery(op: string, target: number): string[] {
    const results: string[] = [];

    if (op === '>' || op === '>=') {
      const idx = this.lowerBound(target);
      for (let i = idx; i < this.entries.length; i++) {
        const entry = this.entries[i]!;
        const val = entry.value as number;
        if (op === '>' && val === target) continue;
        results.push(entry.id);
      }
    } else {
      const idx = this.lowerBound(target);
      for (let i = 0; i < idx; i++) {
        results.push(this.entries[i]!.id);
      }
      if (op === '<=') {
        for (let i = idx; i < this.entries.length; i++) {
          const entry = this.entries[i]!;
          if (entry.value !== target) break;
          results.push(entry.id);
        }
      }
    }

    return results;
  }

  clear(): void {
    this.entries = [];
  }

  get size(): number {
    return this.entries.length;
  }
}
