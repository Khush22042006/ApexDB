/**
 * ApexDB SQL Recursive Descent Parser
 *
 * Transforms tokens into typed SQL AST nodes.
 */

import { Lexer, Token, TokenType } from './Lexer.ts';
import {
  SQLStatement,
  CreateTableStatement,
  DropTableStatement,
  CreateIndexStatement,
  InsertStatement,
  SelectStatement,
  SelectItem,
  UpdateStatement,
  DeleteStatement,
  TransactionStatement,
  Expression,
  BinaryOp,
  ColumnDefAST,
} from './AST.ts';
import { DataType, Value } from '../types.ts';

export class Parser {
  private tokens: Token[] = [];
  private current: number = 0;

  constructor(sql: string) {
    const lexer = new Lexer(sql);
    this.tokens = lexer.tokenize();
  }

  public static parseAll(sql: string): SQLStatement[] {
    const parser = new Parser(sql);
    const statements: SQLStatement[] = [];
    while (!parser.isAtEnd()) {
      if (parser.match(TokenType.SEMICOLON)) {
        continue;
      }
      statements.push(parser.parseStatement());
      parser.match(TokenType.SEMICOLON);
    }
    return statements;
  }

  public parseStatement(): SQLStatement {
    if (this.matchKeyword('EXPLAIN')) {
      const select = this.parseSelectStatement();
      select.isExplain = true;
      return select;
    }

    if (this.matchKeyword('SELECT')) {
      return this.parseSelectStatement();
    }
    if (this.matchKeyword('INSERT')) {
      return this.parseInsertStatement();
    }
    if (this.matchKeyword('UPDATE')) {
      return this.parseUpdateStatement();
    }
    if (this.matchKeyword('DELETE')) {
      return this.parseDeleteStatement();
    }
    if (this.matchKeyword('CREATE')) {
      if (this.matchKeyword('TABLE')) {
        return this.parseCreateTableStatement();
      }
      if (this.matchKeyword('INDEX')) {
        return this.parseCreateIndexStatement();
      }
      throw new Error(`Unexpected token after CREATE: ${this.peek().value}`);
    }
    if (this.matchKeyword('DROP')) {
      if (this.matchKeyword('TABLE')) {
        return this.parseDropTableStatement();
      }
      throw new Error(`Unexpected token after DROP: ${this.peek().value}`);
    }
    if (this.matchKeyword('BEGIN')) {
      this.matchKeyword('TRANSACTION');
      return { type: 'BEGIN' } as TransactionStatement;
    }
    if (this.matchKeyword('COMMIT')) {
      return { type: 'COMMIT' } as TransactionStatement;
    }
    if (this.matchKeyword('ROLLBACK')) {
      return { type: 'ROLLBACK' } as TransactionStatement;
    }
    if (this.matchKeyword('CHECKPOINT')) {
      return { type: 'CHECKPOINT' } as TransactionStatement;
    }

    throw new Error(`Syntax error near '${this.peek().value || 'EOF'}'`);
  }

  private parseCreateTableStatement(): CreateTableStatement {
    let ifNotExists = false;
    if (this.matchKeyword('IF')) {
      this.consumeKeyword('NOT');
      this.consumeKeyword('EXISTS');
      ifNotExists = true;
    }

    const tableName = this.consumeIdentifier('Expected table name');
    this.consume(TokenType.LPAREN, "Expected '(' after table name");

    const columns: ColumnDefAST[] = [];
    while (!this.check(TokenType.RPAREN) && !this.isAtEnd()) {
      const colName = this.consumeIdentifier('Expected column name');
      const colType = this.parseDataType();

      let primaryKey = false;
      let autoIncrement = false;
      let nullable = true;
      let unique = false;
      let defaultValue: Value | undefined;

      while (!this.check(TokenType.COMMA) && !this.check(TokenType.RPAREN) && !this.isAtEnd()) {
        if (this.matchKeyword('PRIMARY')) {
          this.consumeKeyword('KEY');
          primaryKey = true;
        } else if (this.matchKeyword('AUTO_INCREMENT')) {
          autoIncrement = true;
        } else if (this.matchKeyword('NOT')) {
          this.consume(TokenType.NULL, "Expected NULL after 'NOT'");
          nullable = false;
        } else if (this.matchKeyword('UNIQUE')) {
          unique = true;
        } else if (this.matchKeyword('DEFAULT')) {
          const defaultExpression = this.parsePrimary();
          if (defaultExpression.type !== 'Literal') {
            throw new Error(`DEFAULT for column '${colName}' must be a literal`);
          }
          defaultValue = defaultExpression.value;
        } else {
          break;
        }
      }

      columns.push({
        name: colName,
        type: colType,
        primaryKey,
        autoIncrement,
        nullable,
        unique,
        defaultValue,
      });

      if (!this.match(TokenType.COMMA)) {
        break;
      }
    }

    this.consume(TokenType.RPAREN, "Expected ')' after column definitions");

    return {
      type: 'CREATE_TABLE',
      tableName,
      ifNotExists,
      columns,
    };
  }

  private parseDropTableStatement(): DropTableStatement {
    let ifExists = false;
    if (this.matchKeyword('IF')) {
      this.consumeKeyword('EXISTS');
      ifExists = true;
    }
    const tableName = this.consumeIdentifier('Expected table name');
    return {
      type: 'DROP_TABLE',
      tableName,
      ifExists,
    };
  }

  private parseCreateIndexStatement(): CreateIndexStatement {
    let ifNotExists = false;
    if (this.matchKeyword('IF')) {
      this.consumeKeyword('NOT');
      this.consumeKeyword('EXISTS');
      ifNotExists = true;
    }
    const indexName = this.consumeIdentifier('Expected index name');
    this.consumeKeyword('ON');
    const tableName = this.consumeIdentifier('Expected table name');
    this.consume(TokenType.LPAREN, "Expected '(' before column name");
    const columnName = this.consumeIdentifier('Expected column name for index');
    this.consume(TokenType.RPAREN, "Expected ')' after column name");

    return {
      type: 'CREATE_INDEX',
      indexName,
      tableName,
      columnName,
      ifNotExists,
    };
  }

  private parseInsertStatement(): InsertStatement {
    this.consumeKeyword('INTO');
    const tableName = this.consumeIdentifier('Expected table name');

    let columns: string[] | undefined;
    if (this.match(TokenType.LPAREN)) {
      columns = [];
      while (!this.check(TokenType.RPAREN) && !this.isAtEnd()) {
        columns.push(this.consumeIdentifier('Expected column name'));
        if (!this.match(TokenType.COMMA)) break;
      }
      this.consume(TokenType.RPAREN, "Expected ')' after column list");
    }

    this.consumeKeyword('VALUES');

    const valueRows: Expression[][] = [];
    while (!this.isAtEnd()) {
      this.consume(TokenType.LPAREN, "Expected '(' before values list");
      const rowExprs: Expression[] = [];
      while (!this.check(TokenType.RPAREN) && !this.isAtEnd()) {
        rowExprs.push(this.parseExpression());
        if (!this.match(TokenType.COMMA)) break;
      }
      this.consume(TokenType.RPAREN, "Expected ')' after values list");
      valueRows.push(rowExprs);

      if (!this.match(TokenType.COMMA)) break;
    }

    return {
      type: 'INSERT',
      tableName,
      columns,
      values: valueRows,
    };
  }

  private parseSelectStatement(): SelectStatement {
    const columns: SelectItem[] = [];

    if (this.match(TokenType.STAR)) {
      // SELECT *
    } else {
      while (!this.isAtEnd()) {
        const expr = this.parseExpression();
        let alias: string | undefined;
        if (this.matchKeyword('AS')) {
          alias = this.consumeIdentifier('Expected column alias');
        } else if (this.check(TokenType.IDENTIFIER) && !this.checkKeyword('FROM')) {
          alias = this.consumeIdentifier('Expected column alias');
        }
        columns.push({ expression: expr, alias });
        if (!this.match(TokenType.COMMA)) break;
      }
    }

    this.consumeKeyword('FROM');
    const fromTable = this.consumeIdentifier('Expected table name');

    // Optional JOIN
    let join: SelectStatement['join'];
    if (this.matchKeyword('INNER') || this.matchKeyword('JOIN')) {
      if (this.previous().value === 'INNER') {
        this.consumeKeyword('JOIN');
      }
      const joinTable = this.consumeIdentifier('Expected table to join');
      this.consumeKeyword('ON');
      const onExpr = this.parseExpression();
      join = { type: 'INNER', table: joinTable, on: onExpr };
    }

    // Optional WHERE
    let where: Expression | undefined;
    if (this.matchKeyword('WHERE')) {
      where = this.parseExpression();
    }

    // Optional ORDER BY
    let orderBy: SelectStatement['orderBy'];
    if (this.matchKeyword('ORDER')) {
      this.consumeKeyword('BY');
      const col = this.consumeIdentifier('Expected order by column name');
      let dir: 'ASC' | 'DESC' = 'ASC';
      if (this.matchKeyword('DESC')) {
        dir = 'DESC';
      } else if (this.matchKeyword('ASC')) {
        dir = 'ASC';
      }
      orderBy = { column: col, direction: dir };
    }

    // Optional LIMIT
    let limit: number | undefined;
    if (this.matchKeyword('LIMIT')) {
      const tok = this.consume(TokenType.NUMBER, 'Expected number after LIMIT');
      limit = parseInt(tok.value, 10);
    }

    return {
      type: 'SELECT',
      columns,
      fromTable,
      join,
      where,
      orderBy,
      limit,
    };
  }

  private parseUpdateStatement(): UpdateStatement {
    const tableName = this.consumeIdentifier('Expected table name');
    this.consumeKeyword('SET');

    const setList: { column: string; value: Expression }[] = [];
    while (!this.isAtEnd()) {
      const col = this.consumeIdentifier('Expected column name');
      this.consume(TokenType.OPERATOR, "Expected '=' in SET clause");
      const val = this.parseExpression();
      setList.push({ column: col, value: val });
      if (!this.match(TokenType.COMMA)) break;
    }

    let where: Expression | undefined;
    if (this.matchKeyword('WHERE')) {
      where = this.parseExpression();
    }

    return {
      type: 'UPDATE',
      tableName,
      set: setList,
      where,
    };
  }

  private parseDeleteStatement(): DeleteStatement {
    this.consumeKeyword('FROM');
    const tableName = this.consumeIdentifier('Expected table name');

    let where: Expression | undefined;
    if (this.matchKeyword('WHERE')) {
      where = this.parseExpression();
    }

    return {
      type: 'DELETE',
      tableName,
      where,
    };
  }

  // --- Expression parsing with precedence ---
  public parseExpression(): Expression {
    return this.parseOr();
  }

  private parseOr(): Expression {
    let expr = this.parseAnd();
    while (this.matchKeyword('OR')) {
      const right = this.parseAnd();
      expr = {
        type: 'Binary',
        operator: 'OR',
        left: expr,
        right,
      };
    }
    return expr;
  }

  private parseAnd(): Expression {
    let expr = this.parseEquality();
    while (this.matchKeyword('AND')) {
      const right = this.parseEquality();
      expr = {
        type: 'Binary',
        operator: 'AND',
        left: expr,
        right,
      };
    }
    return expr;
  }

  private parseEquality(): Expression {
    let expr = this.parseComparison();
    while (
      this.matchOperator('=') ||
      this.matchOperator('!=') ||
      this.matchOperator('<>') ||
      this.matchKeyword('LIKE')
    ) {
      const op = this.previous().value.toUpperCase() as BinaryOp;
      const right = this.parseComparison();
      expr = {
        type: 'Binary',
        operator: op === '<>' ? '!=' : op,
        left: expr,
        right,
      };
    }
    return expr;
  }

  private parseComparison(): Expression {
    let expr = this.parseTerm();
    while (
      this.matchOperator('<') ||
      this.matchOperator('<=') ||
      this.matchOperator('>') ||
      this.matchOperator('>=')
    ) {
      const op = this.previous().value as BinaryOp;
      const right = this.parseTerm();
      expr = {
        type: 'Binary',
        operator: op,
        left: expr,
        right,
      };
    }
    return expr;
  }

  private parseTerm(): Expression {
    let expr = this.parseFactor();
    while (this.matchOperator('+') || this.matchOperator('-')) {
      const op = this.previous().value as BinaryOp;
      const right = this.parseFactor();
      expr = {
        type: 'Binary',
        operator: op,
        left: expr,
        right,
      };
    }
    return expr;
  }

  private parseFactor(): Expression {
    let expr = this.parsePrimary();
    while (this.matchOperator('*') || this.matchOperator('/')) {
      const op = this.previous().value as BinaryOp;
      const right = this.parsePrimary();
      expr = {
        type: 'Binary',
        operator: op,
        left: expr,
        right,
      };
    }
    return expr;
  }

  private parsePrimary(): Expression {
    if (this.match(TokenType.NUMBER)) {
      const val = parseFloat(this.previous().value);
      return { type: 'Literal', value: val };
    }
    if (this.match(TokenType.STRING)) {
      return { type: 'Literal', value: this.previous().value };
    }
    if (this.match(TokenType.BOOLEAN)) {
      return { type: 'Literal', value: this.previous().value.toUpperCase() === 'TRUE' };
    }
    if (this.match(TokenType.NULL)) {
      return { type: 'Literal', value: null };
    }
    if (this.match(TokenType.IDENTIFIER)) {
      let name = this.previous().value;
      let table: string | undefined;
      if (this.match(TokenType.DOT)) {
        table = name;
        name = this.consumeIdentifier('Expected column name after dot');
      }
      return { type: 'Identifier', name, table };
    }
    if (this.match(TokenType.LPAREN)) {
      const expr = this.parseExpression();
      this.consume(TokenType.RPAREN, "Expected ')' after expression");
      return expr;
    }

    throw new Error(`Unexpected token in expression: '${this.peek().value}'`);
  }

  private parseDataType(): DataType {
    const tok = this.peek();
    if (tok.type !== TokenType.KEYWORD) {
      throw new Error(`Expected data type, got '${tok.value}'`);
    }
    const val = tok.value.toUpperCase();
    this.advance();

    if (val === 'INT' || val === 'INTEGER') return 'INTEGER';
    if (val === 'FLOAT') return 'FLOAT';
    if (val === 'TEXT' || val === 'VARCHAR') {
      if (this.match(TokenType.LPAREN)) {
        this.consume(TokenType.NUMBER, 'Expected length inside VARCHAR(...)');
        this.consume(TokenType.RPAREN, "Expected ')'");
      }
      return 'TEXT';
    }
    if (val === 'BOOLEAN' || val === 'BOOL') return 'BOOLEAN';

    throw new Error(`Unsupported data type: ${val}`);
  }

  // --- Helper methods ---
  private match(type: TokenType): boolean {
    if (this.check(type)) {
      this.advance();
      return true;
    }
    return false;
  }

  private matchKeyword(kw: string): boolean {
    if (this.checkKeyword(kw)) {
      this.advance();
      return true;
    }
    return false;
  }

  private matchOperator(op: string): boolean {
    if (this.peek().type === TokenType.OPERATOR && this.peek().value === op) {
      this.advance();
      return true;
    }
    return false;
  }

  private check(type: TokenType): boolean {
    if (this.isAtEnd()) return false;
    return this.peek().type === type;
  }

  private checkKeyword(kw: string): boolean {
    if (this.isAtEnd()) return false;
    return this.peek().type === TokenType.KEYWORD && this.peek().value.toUpperCase() === kw;
  }

  private advance(): Token {
    if (!this.isAtEnd()) this.current++;
    return this.previous();
  }

  private isAtEnd(): boolean {
    return this.peek().type === TokenType.EOF;
  }

  private peek(): Token {
    return this.tokens[this.current] || { type: TokenType.EOF, value: '', pos: 0 };
  }

  private previous(): Token {
    return this.tokens[this.current - 1];
  }

  private consume(type: TokenType, errMsg: string): Token {
    if (this.check(type)) return this.advance();
    throw new Error(`${errMsg} (found '${this.peek().value}')`);
  }

  private consumeKeyword(kw: string): Token {
    if (this.checkKeyword(kw)) return this.advance();
    throw new Error(`Expected keyword '${kw}' (found '${this.peek().value}')`);
  }

  private consumeIdentifier(errMsg: string): string {
    if (this.check(TokenType.IDENTIFIER) || this.check(TokenType.KEYWORD)) {
      return this.advance().value;
    }
    throw new Error(`${errMsg} (found '${this.peek().value}')`);
  }
}
