/**
 * ApexDB Query Planner & Volcano Execution Engine
 *
 * Implements Volcano Iterator Model (open -> next -> close)
 * Supports SeqScan, B+ Tree IndexScan, Filter, Join, Project, Sort, and Limit.
 */

import { Row, Value, RecordId, QueryPlanNode } from '../types.ts';
import { Expression, SelectStatement, BinaryOp, JoinClause } from '../sql/AST.ts';
import { BufferPool } from '../storage/BufferPool.ts';
import { BPlusTree, BPlusKey } from '../index/BPlusTree.ts';
import { TableSchema } from '../types.ts';

export function evaluateExpression(expr: Expression, row: Row): Value {
  switch (expr.type) {
    case 'Literal':
      return expr.value ?? null;

    case 'Identifier': {
      const colName = expr.name!;
      if (expr.table && row[`${expr.table}.${colName}`] !== undefined) {
        return row[`${expr.table}.${colName}`];
      }
      const key = Object.keys(row).find((candidate) => candidate.toLowerCase() === colName.toLowerCase());
      if (key !== undefined) return row[key];
      if (expr.table) {
        const qualifiedKey = Object.keys(row).find(
          (candidate) => candidate.toLowerCase() === `${expr.table}.${colName}`.toLowerCase()
        );
        if (qualifiedKey !== undefined) return row[qualifiedKey];
      }
      return null;
    }

    case 'Binary': {
      const leftVal = evaluateExpression(expr.left!, row);
      const rightVal = evaluateExpression(expr.right!, row);

      switch (expr.operator as BinaryOp) {
        case '=':
          return leftVal !== null && rightVal !== null && leftVal === rightVal;
        case '!=':
        case '<>':
          return leftVal !== null && rightVal !== null && leftVal !== rightVal;
        case '<':
          return leftVal !== null && rightVal !== null && (leftVal as any) < (rightVal as any);
        case '<=':
          return leftVal !== null && rightVal !== null && (leftVal as any) <= (rightVal as any);
        case '>':
          return leftVal !== null && rightVal !== null && (leftVal as any) > (rightVal as any);
        case '>=':
          return leftVal !== null && rightVal !== null && (leftVal as any) >= (rightVal as any);
        case 'LIKE': {
          if (typeof leftVal !== 'string' || typeof rightVal !== 'string') return false;
          const escapedPattern = rightVal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const regexStr = '^' + escapedPattern.replace(/%/g, '.*').replace(/_/g, '.') + '$';
          const reg = new RegExp(regexStr, 'i');
          return reg.test(leftVal);
        }
        case 'AND':
          return Boolean(leftVal) && Boolean(rightVal);
        case 'OR':
          return Boolean(leftVal) || Boolean(rightVal);
        case '+':
          return (Number(leftVal) || 0) + (Number(rightVal) || 0);
        case '-':
          return (Number(leftVal) || 0) - (Number(rightVal) || 0);
        case '*':
          return (Number(leftVal) || 0) * (Number(rightVal) || 0);
        case '/':
          return (Number(rightVal) || 0) !== 0 ? (Number(leftVal) || 0) / (Number(rightVal) || 1) : 0;
        default:
          return null;
      }
    }

    default:
      return null;
  }
}

export interface VolcanoExecutor {
  open(): void;
  next(): Row | null;
  close(): void;
  getPlanNode(): QueryPlanNode;
}

/**
 * Sequential Scan across heap pages
 */
export class SeqScanExecutor implements VolcanoExecutor {
  private bufferPool: BufferPool;
  private schema: TableSchema;
  private currentPageId: number;
  private currentSlotIndex: number = 0;
  private currentSlotCount: number = 0;
  private rowsYielded: number = 0;

  constructor(bufferPool: BufferPool, schema: TableSchema) {
    this.bufferPool = bufferPool;
    this.schema = schema;
    this.currentPageId = schema.rootPageId;
  }

  public open(): void {
    this.currentPageId = this.schema.rootPageId;
    this.currentSlotIndex = 0;
    this.rowsYielded = 0;
    this.loadPageSlots();
  }

  private loadPageSlots(): void {
    if (this.currentPageId === 0 && this.schema.rowCount === 0) {
      this.currentSlotCount = 0;
      return;
    }
    const page = this.bufferPool.fetchPage(this.currentPageId);
    this.currentSlotCount = page.getSlotCount();
    this.bufferPool.unpinPage(this.currentPageId, false);
  }

  public next(): Row | null {
    while (this.currentPageId !== 0 || this.currentSlotIndex < this.currentSlotCount) {
      if (this.currentSlotIndex >= this.currentSlotCount) {
        // Move to next page in chain
        const page = this.bufferPool.fetchPage(this.currentPageId);
        const nextPageId = page.getNextPageId();
        this.bufferPool.unpinPage(this.currentPageId, false);

        if (nextPageId === 0) {
          break; // end of table
        }
        this.currentPageId = nextPageId;
        this.currentSlotIndex = 0;
        this.loadPageSlots();
        continue;
      }

      const page = this.bufferPool.fetchPage(this.currentPageId);
      const row = page.getRow(this.currentSlotIndex);
      this.bufferPool.unpinPage(this.currentPageId, false);
      this.currentSlotIndex++;

      if (row !== null) {
        this.rowsYielded++;
        return row;
      }
    }
    return null;
  }

  public close(): void {
    // cleanup
  }

  public getPlanNode(): QueryPlanNode {
    return {
      nodeType: 'SeqScan',
      details: `Full table scan on '${this.schema.name}' (pages: ~${Math.max(1, Math.ceil(this.schema.rowCount / 15))})`,
      estimatedCost: this.schema.rowCount * 1.0,
      actualRows: this.rowsYielded,
    };
  }
}

export class ValuesScanExecutor implements VolcanoExecutor {
  private rows: Row[];
  private cursor = 0;

  constructor(rows: Row[]) {
    this.rows = rows;
  }

  public open(): void {
    this.cursor = 0;
  }

  public next(): Row | null {
    return this.rows[this.cursor++] ?? null;
  }

  public close(): void {}

  public getPlanNode(): QueryPlanNode {
    return {
      nodeType: 'SeqScan',
      details: `Branch snapshot scan (${this.rows.length} rows)`,
      estimatedCost: this.rows.length,
      actualRows: Math.min(this.cursor, this.rows.length),
    };
  }
}

/**
 * B+ Tree Index Scan using an existing index
 */
export class IndexScanExecutor implements VolcanoExecutor {
  private bufferPool: BufferPool;
  private schema: TableSchema;
  private tree: BPlusTree;
  private indexCol: string;
  private ridsToFetch: RecordId[] = [];
  private currentRidIdx: number = 0;
  private rowsYielded: number = 0;
  private scanDetails: string;

  constructor(
    bufferPool: BufferPool,
    schema: TableSchema,
    tree: BPlusTree,
    indexCol: string,
    lookup: { op: '=' | 'RANGE'; key?: BPlusKey; minKey?: BPlusKey; maxKey?: BPlusKey }
  ) {
    this.bufferPool = bufferPool;
    this.schema = schema;
    this.tree = tree;
    this.indexCol = indexCol;

    if (lookup.op === '=') {
      const res = tree.rangeSearch(lookup.key!, lookup.key!);
      this.ridsToFetch = res.results.map((entry) => entry.rid);
      this.scanDetails = `B+Tree point lookup on ${schema.name}.${indexCol} = '${lookup.key}' (${res.comparisons} comparisons)`;
    } else {
      const res = tree.rangeSearch(lookup.minKey ?? null, lookup.maxKey ?? null);
      this.ridsToFetch = res.results.map((r) => r.rid);
      this.scanDetails = `B+Tree range scan on ${schema.name}.${indexCol} in [${lookup.minKey ?? '-inf'}, ${lookup.maxKey ?? '+inf'}] (${res.leavesVisited} leaves, ${res.comparisons} comps)`;
    }
  }

  public open(): void {
    this.currentRidIdx = 0;
    this.rowsYielded = 0;
  }

  public next(): Row | null {
    if (this.currentRidIdx >= this.ridsToFetch.length) {
      return null;
    }
    const rid = this.ridsToFetch[this.currentRidIdx++];
    const page = this.bufferPool.fetchPage(rid.pageId);
    const row = page.getRow(rid.slotIndex);
    this.bufferPool.unpinPage(rid.pageId, false);

    if (row !== null) {
      this.rowsYielded++;
      return row;
    }
    return this.next();
  }

  public close(): void {
    // cleanup
  }

  public getPlanNode(): QueryPlanNode {
    return {
      nodeType: 'IndexScan',
      details: this.scanDetails,
      estimatedCost: Math.max(1, Math.round(Math.log2(this.schema.rowCount + 1) * 0.5)),
      actualRows: this.rowsYielded,
    };
  }
}

/**
 * Filter Executor for WHERE clause evaluation
 */
export class FilterExecutor implements VolcanoExecutor {
  private child: VolcanoExecutor;
  private predicate: Expression;
  private rowsYielded: number = 0;

  constructor(child: VolcanoExecutor, predicate: Expression) {
    this.child = child;
    this.predicate = predicate;
  }

  public open(): void {
    this.child.open();
    this.rowsYielded = 0;
  }

  public next(): Row | null {
    let row: Row | null = null;
    while ((row = this.child.next()) !== null) {
      const passes = evaluateExpression(this.predicate, row);
      if (Boolean(passes)) {
        this.rowsYielded++;
        return row;
      }
    }
    return null;
  }

  public close(): void {
    this.child.close();
  }

  public getPlanNode(): QueryPlanNode {
    return {
      nodeType: 'Filter',
      details: `Predicate evaluation`,
      estimatedCost: this.child.getPlanNode().estimatedCost * 1.1,
      actualRows: this.rowsYielded,
      children: [this.child.getPlanNode()],
    };
  }
}

export class NestedLoopJoinExecutor implements VolcanoExecutor {
  private left: VolcanoExecutor;
  private right: VolcanoExecutor;
  private clause: JoinClause;
  private leftTable: string;
  private rightRows: Row[] = [];
  private currentLeft: Row | null = null;
  private rightIndex = 0;
  private rowsYielded = 0;

  constructor(left: VolcanoExecutor, right: VolcanoExecutor, clause: JoinClause, leftTable: string) {
    this.left = left;
    this.right = right;
    this.clause = clause;
    this.leftTable = leftTable;
  }

  public open(): void {
    this.left.open();
    this.right.open();
    this.rightRows = [];
    let row: Row | null;
    while ((row = this.right.next()) !== null) this.rightRows.push(row);
    this.right.close();
    this.currentLeft = null;
    this.rightIndex = 0;
    this.rowsYielded = 0;
  }

  public next(): Row | null {
    while (true) {
      if (this.currentLeft === null) {
        this.currentLeft = this.left.next();
        this.rightIndex = 0;
        if (this.currentLeft === null) return null;
      }

      while (this.rightIndex < this.rightRows.length) {
        const rightRow = this.rightRows[this.rightIndex++];
        const joined: Row = { ...this.currentLeft };
        for (const [column, value] of Object.entries(this.currentLeft)) {
          if (!column.startsWith('_')) joined[`${this.leftTable}.${column}`] = value;
        }
        for (const [column, value] of Object.entries(rightRow)) {
          if (column.startsWith('_')) continue;
          joined[`${this.clause.table}.${column}`] = value;
          if (joined[column] === undefined) joined[column] = value;
        }
        (joined as Row & { _joinRows: Row[] })._joinRows = [this.currentLeft, rightRow];

        if (Boolean(evaluateExpression(this.clause.on, joined))) {
          this.rowsYielded++;
          return joined;
        }
      }

      this.currentLeft = null;
    }
  }

  public close(): void {
    this.left.close();
  }

  public getPlanNode(): QueryPlanNode {
    return {
      nodeType: 'NestedLoopJoin',
      details: `Inner join with '${this.clause.table}'`,
      estimatedCost: this.left.getPlanNode().estimatedCost * Math.max(1, this.rightRows.length),
      actualRows: this.rowsYielded,
      children: [this.left.getPlanNode()],
    };
  }
}

/**
 * Project Executor for selecting specific columns and aliases
 */
export class ProjectExecutor implements VolcanoExecutor {
  private child: VolcanoExecutor;
  private select: SelectStatement;
  private rowsYielded: number = 0;

  constructor(child: VolcanoExecutor, select: SelectStatement) {
    this.child = child;
    this.select = select;
  }

  public open(): void {
    this.child.open();
    this.rowsYielded = 0;
  }

  public next(): Row | null {
    const rawRow = this.child.next();
    if (!rawRow) return null;

    this.rowsYielded++;
    // If SELECT * (empty columns array), return raw row
    if (this.select.columns.length === 0) {
      return rawRow;
    }

    const projected: Row = {};
    for (const item of this.select.columns) {
      const val = evaluateExpression(item.expression, rawRow);
      const key = item.alias || (item.expression.type === 'Identifier' ? item.expression.name! : 'expr');
      projected[key] = val;
    }
    const joinedRows = (rawRow as Row & { _joinRows?: Row[] })._joinRows;
    if (joinedRows) (projected as Row & { _joinRows: Row[] })._joinRows = joinedRows;
    return projected;
  }

  public close(): void {
    this.child.close();
  }

  public getPlanNode(): QueryPlanNode {
    return {
      nodeType: 'Project',
      details: `Project columns [${this.select.columns.length === 0 ? '*' : this.select.columns.map((c) => c.alias || c.expression.name).join(', ')}]`,
      estimatedCost: this.child.getPlanNode().estimatedCost,
      actualRows: this.rowsYielded,
      children: [this.child.getPlanNode()],
    };
  }
}

/**
 * Sort Executor for ORDER BY
 */
export class SortExecutor implements VolcanoExecutor {
  private child: VolcanoExecutor;
  private col: string;
  private direction: 'ASC' | 'DESC';
  private sortedRows: Row[] = [];
  private cursor: number = 0;

  constructor(child: VolcanoExecutor, col: string, direction: 'ASC' | 'DESC' = 'ASC') {
    this.child = child;
    this.col = col;
    this.direction = direction;
  }

  public open(): void {
    this.child.open();
    this.sortedRows = [];
    this.cursor = 0;

    let row: Row | null;
    while ((row = this.child.next()) !== null) {
      this.sortedRows.push(row);
    }

    this.sortedRows.sort((a, b) => {
      const va = a[this.col];
      const vb = b[this.col];
      let cmp = 0;
      if (typeof va === 'number' && typeof vb === 'number') {
        cmp = va - vb;
      } else {
        cmp = String(va ?? '').localeCompare(String(vb ?? ''));
      }
      return this.direction === 'DESC' ? -cmp : cmp;
    });
  }

  public next(): Row | null {
    if (this.cursor < this.sortedRows.length) {
      return this.sortedRows[this.cursor++];
    }
    return null;
  }

  public close(): void {
    this.child.close();
  }

  public getPlanNode(): QueryPlanNode {
    return {
      nodeType: 'Sort',
      details: `In-memory sort on '${this.col}' ${this.direction}`,
      estimatedCost: this.child.getPlanNode().estimatedCost * 1.5,
      actualRows: this.sortedRows.length,
      children: [this.child.getPlanNode()],
    };
  }
}

/**
 * Limit Executor for LIMIT n
 */
export class LimitExecutor implements VolcanoExecutor {
  private child: VolcanoExecutor;
  private limit: number;
  private count: number = 0;

  constructor(child: VolcanoExecutor, limit: number) {
    this.child = child;
    this.limit = limit;
  }

  public open(): void {
    this.child.open();
    this.count = 0;
  }

  public next(): Row | null {
    if (this.count < this.limit) {
      const row = this.child.next();
      if (row) {
        this.count++;
        return row;
      }
    }
    return null;
  }

  public close(): void {
    this.child.close();
  }

  public getPlanNode(): QueryPlanNode {
    return {
      nodeType: 'Limit',
      details: `Limit ${this.limit}`,
      estimatedCost: Math.min(this.limit, this.child.getPlanNode().estimatedCost),
      actualRows: this.count,
      children: [this.child.getPlanNode()],
    };
  }
}
