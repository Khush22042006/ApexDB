/**
 * ApexDB SQL Abstract Syntax Tree (AST) Definitions
 */

import { DataType, Value } from '../types.ts';

export type BinaryOp = '=' | '!=' | '<>' | '<' | '<=' | '>' | '>=' | 'LIKE' | 'AND' | 'OR' | '+' | '-' | '*' | '/';

export interface Expression {
  type: 'Literal' | 'Identifier' | 'Binary' | 'Unary';
  value?: Value;
  name?: string;
  table?: string;
  operator?: BinaryOp | 'NOT' | '-';
  left?: Expression;
  right?: Expression;
  operand?: Expression;
}

export interface ColumnDefAST {
  name: string;
  type: DataType;
  primaryKey?: boolean;
  autoIncrement?: boolean;
  nullable?: boolean;
  unique?: boolean;
  defaultValue?: Value;
}

export interface CreateTableStatement {
  type: 'CREATE_TABLE';
  tableName: string;
  ifNotExists?: boolean;
  columns: ColumnDefAST[];
}

export interface DropTableStatement {
  type: 'DROP_TABLE';
  tableName: string;
  ifExists?: boolean;
}

export interface CreateIndexStatement {
  type: 'CREATE_INDEX';
  indexName: string;
  tableName: string;
  columnName: string;
  ifNotExists?: boolean;
}

export interface InsertStatement {
  type: 'INSERT';
  tableName: string;
  columns?: string[];
  values: Expression[][];
}

export interface SelectItem {
  expression: Expression;
  alias?: string;
}

export interface JoinClause {
  type: 'INNER' | 'LEFT';
  table: string;
  on: Expression;
}

export interface OrderByItem {
  column: string;
  direction: 'ASC' | 'DESC';
}

export interface SelectStatement {
  type: 'SELECT';
  isExplain?: boolean;
  distinct?: boolean;
  columns: SelectItem[]; // empty array means *
  fromTable: string;
  join?: JoinClause;
  where?: Expression;
  orderBy?: OrderByItem;
  limit?: number;
}

export interface UpdateStatement {
  type: 'UPDATE';
  tableName: string;
  set: { column: string; value: Expression }[];
  where?: Expression;
}

export interface DeleteStatement {
  type: 'DELETE';
  tableName: string;
  where?: Expression;
}

export interface TransactionStatement {
  type: 'BEGIN' | 'COMMIT' | 'ROLLBACK' | 'CHECKPOINT';
}

export type SQLStatement =
  | CreateTableStatement
  | DropTableStatement
  | CreateIndexStatement
  | InsertStatement
  | SelectStatement
  | UpdateStatement
  | DeleteStatement
  | TransactionStatement;
