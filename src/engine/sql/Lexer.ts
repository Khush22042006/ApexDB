/**
 * ApexDB SQL Lexer / Tokenizer
 *
 * Scans SQL string into a stream of typed tokens.
 */

export enum TokenType {
  KEYWORD = 'KEYWORD',
  IDENTIFIER = 'IDENTIFIER',
  NUMBER = 'NUMBER',
  STRING = 'STRING',
  BOOLEAN = 'BOOLEAN',
  NULL = 'NULL',
  OPERATOR = 'OPERATOR',
  COMMA = 'COMMA',
  DOT = 'DOT',
  STAR = 'STAR',
  LPAREN = 'LPAREN',
  RPAREN = 'RPAREN',
  SEMICOLON = 'SEMICOLON',
  EOF = 'EOF',
}

export interface Token {
  type: TokenType;
  value: string;
  pos: number;
}

const KEYWORDS = new Set([
  'SELECT',
  'AS',
  'FROM',
  'WHERE',
  'INSERT',
  'INTO',
  'VALUES',
  'UPDATE',
  'SET',
  'DELETE',
  'CREATE',
  'TABLE',
  'DROP',
  'INDEX',
  'ON',
  'PRIMARY',
  'KEY',
  'AUTO_INCREMENT',
  'NOT',
  'NULL',
  'DEFAULT',
  'UNIQUE',
  'AND',
  'OR',
  'LIKE',
  'ORDER',
  'BY',
  'ASC',
  'DESC',
  'LIMIT',
  'JOIN',
  'INNER',
  'LEFT',
  'EXPLAIN',
  'BEGIN',
  'TRANSACTION',
  'COMMIT',
  'ROLLBACK',
  'CHECKPOINT',
  'IF',
  'EXISTS',
  'INTEGER',
  'INT',
  'FLOAT',
  'TEXT',
  'VARCHAR',
  'BOOLEAN',
  'BOOL',
  'TRUE',
  'FALSE',
]);

export class Lexer {
  private input: string;
  private pos: number = 0;

  constructor(input: string) {
    this.input = input.trim();
  }

  public tokenize(): Token[] {
    const tokens: Token[] = [];
    while (this.pos < this.input.length) {
      const ch = this.input[this.pos];

      // Whitespace
      if (/\s/.test(ch)) {
        this.pos++;
        continue;
      }

      // Single line comments --
      if (ch === '-' && this.input[this.pos + 1] === '-') {
        while (this.pos < this.input.length && this.input[this.pos] !== '\n') {
          this.pos++;
        }
        continue;
      }

      // Punctuation
      if (ch === ',') {
        tokens.push({ type: TokenType.COMMA, value: ',', pos: this.pos++ });
        continue;
      }
      if (ch === ';') {
        tokens.push({ type: TokenType.SEMICOLON, value: ';', pos: this.pos++ });
        continue;
      }
      if (ch === '.') {
        tokens.push({ type: TokenType.DOT, value: '.', pos: this.pos++ });
        continue;
      }
      if (ch === '(') {
        tokens.push({ type: TokenType.LPAREN, value: '(', pos: this.pos++ });
        continue;
      }
      if (ch === ')') {
        tokens.push({ type: TokenType.RPAREN, value: ')', pos: this.pos++ });
        continue;
      }
      if (ch === '*') {
        tokens.push({ type: TokenType.STAR, value: '*', pos: this.pos++ });
        continue;
      }

      // Comparison / Math operators
      if (ch === '=' || ch === '<' || ch === '>' || ch === '!' || ch === '+' || ch === '-' || ch === '/') {
        const next = this.input[this.pos + 1];
        if ((ch === '<' && next === '=') || (ch === '>' && next === '=') || (ch === '!' && next === '=') || (ch === '<' && next === '>')) {
          tokens.push({ type: TokenType.OPERATOR, value: ch + next, pos: this.pos });
          this.pos += 2;
          continue;
        }
        tokens.push({ type: TokenType.OPERATOR, value: ch, pos: this.pos++ });
        continue;
      }

      // String literals: 'text' or "text"
      if (ch === "'" || ch === '"') {
        const quote = ch;
        const startPos = this.pos;
        this.pos++;
        let val = '';
        let closed = false;
        while (this.pos < this.input.length) {
          if (this.input[this.pos] === '\\' && this.pos + 1 < this.input.length) {
            this.pos++;
            val += this.input[this.pos];
            this.pos++;
            continue;
          }
          if (this.input[this.pos] === quote) {
            if (this.input[this.pos + 1] === quote) {
              val += quote;
              this.pos += 2;
              continue;
            }
            this.pos++;
            closed = true;
            break;
          }
          val += this.input[this.pos++];
        }
        if (!closed) throw new Error(`Unterminated string literal at position ${startPos}`);
        tokens.push({ type: TokenType.STRING, value: val, pos: startPos });
        continue;
      }

      // Numbers: 123 or 123.45
      if (/\d/.test(ch)) {
        const startPos = this.pos;
        let numStr = '';
        while (this.pos < this.input.length && /\d/.test(this.input[this.pos])) {
          numStr += this.input[this.pos++];
        }
        if (this.input[this.pos] === '.') {
          numStr += this.input[this.pos++];
          if (!/\d/.test(this.input[this.pos] ?? '')) {
            throw new Error(`Malformed number at position ${startPos}`);
          }
          while (this.pos < this.input.length && /\d/.test(this.input[this.pos])) {
            numStr += this.input[this.pos++];
          }
        }
        tokens.push({ type: TokenType.NUMBER, value: numStr, pos: startPos });
        continue;
      }

      // Identifiers & Keywords
      if (/[a-zA-Z_]/.test(ch)) {
        const startPos = this.pos;
        let ident = '';
        while (this.pos < this.input.length && /[a-zA-Z0-9_]/.test(this.input[this.pos])) {
          ident += this.input[this.pos++];
        }

        const upper = ident.toUpperCase();
        if (upper === 'TRUE' || upper === 'FALSE') {
          tokens.push({ type: TokenType.BOOLEAN, value: upper, pos: startPos });
        } else if (upper === 'NULL') {
          tokens.push({ type: TokenType.NULL, value: upper, pos: startPos });
        } else if (KEYWORDS.has(upper)) {
          tokens.push({ type: TokenType.KEYWORD, value: upper, pos: startPos });
        } else {
          tokens.push({ type: TokenType.IDENTIFIER, value: ident, pos: startPos });
        }
        continue;
      }

      throw new Error(`Unexpected character '${ch}' at position ${this.pos}`);
    }

    tokens.push({ type: TokenType.EOF, value: '', pos: this.pos });
    return tokens;
  }
}
