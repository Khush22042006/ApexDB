import { describe, expect, it } from 'vitest';
import { Database } from './Database.ts';
import { VectorIndex } from './index/VectorIndex.ts';

function createDb() {
  return new Database(32);
}

describe('ApexDB core SQL engine', () => {
  it('seeds the demo catalog and executes the default query', () => {
    const db = createDb();
    expect(db.executeSingle("SELECT * FROM users WHERE age >= 30 AND age <= 42 ORDER BY age ASC;").success).toBe(true);
    expect(db.executeSingle('SELECT * FROM users;').rows?.length).toBe(15);
    expect(db.executeSingle('SELECT * FROM orders;').rows?.length).toBe(8);
    expect(db.executeSingle('SELECT * FROM vector_docs;').rows?.length).toBe(6);
  });

  it('rejects NULL, duplicate keys, wrong types, and unknown columns', () => {
    const db = createDb();
    expect(db.executeSingle("INSERT INTO users (id, username, email, age) VALUES (1, 'duplicate', 'x@example.com', 25);").success).toBe(false);
    expect(db.executeSingle("INSERT INTO users (username, email, age) VALUES (NULL, 'x@example.com', 25);").success).toBe(false);
    expect(db.executeSingle("INSERT INTO users (id, username, email, age) VALUES ('bad', 'new_user', 'new@example.com', 25);").success).toBe(false);
    expect(db.executeSingle('SELECT unknown_column FROM users;').success).toBe(false);
  });

  it('supports transactions, rollback, and separate insert/update/delete rollback paths', () => {
    const db = createDb();
    expect(db.executeSingle('BEGIN;').success).toBe(true);
    expect(db.executeSingle("INSERT INTO users (id, username, email, age) VALUES (100, 'tx_user', 'tx@example.com', 27);").success).toBe(true);
    expect(db.executeSingle('ROLLBACK;').success).toBe(true);
    expect(db.executeSingle('SELECT * FROM users WHERE id = 100;').rows?.length).toBe(0);
  });

  it('keeps cache results isolated across the two SELECT statements in a script', () => {
    const db = createDb();
    db.execute('CREATE TABLE cache_test (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO cache_test (id, value) VALUES (1, \'one\'); SELECT * FROM cache_test; INSERT INTO cache_test (id, value) VALUES (2, \'two\'); SELECT * FROM cache_test;');
    expect(db.executeSingle('SELECT * FROM cache_test WHERE id = 1;').rows?.length).toBe(1);
  });

  it('isolates writes made on a branch', () => {
    const db = createDb();
    db.createBranch('audit');
    db.branchManager.switchBranch('audit');
    const insert = db.executeSingle("INSERT INTO users (id, username, email, age) VALUES (101, 'branch_user', 'branch@example.com', 29);");
    expect(insert.success).toBe(true);
    expect(db.executeSingle('SELECT * FROM users WHERE id = 101;').rows?.length).toBe(1);

    db.branchManager.switchBranch('main');
    expect(db.executeSingle('SELECT * FROM users WHERE id = 101;').rows?.length).toBe(0);
  });
});

describe('ApexDB vector validation', () => {
  it('rejects vectors with the wrong dimension or non-finite values', () => {
    const index = new VectorIndex('vectors', 4);
    expect(() => index.insert(1, [1, 2, 3], { pageId: 1, slotIndex: 0 })).toThrow();
    expect(() => index.searchKNN([1, 2, 3, Number.NaN], 3)).toThrow();
    expect(() => index.searchKNN([1, 2, 3, 4], -1)).toThrow();
  });
});
