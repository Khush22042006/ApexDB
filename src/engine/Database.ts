/**
 * ApexDB Enterprise Database Engine
 *
 * Integrates:
 * - Persistent Page-based Storage with Checksums & Corruption Detection
 * - Buffer Pool with Clock & LRU Replacement and Strict WAL Invariants
 * - Multi-Version Concurrency Control (MVCC) with Snapshot Isolation
 * - B+ Tree, Learned CDF, and Vector/Hybrid Search Indexing
 * - Git-like Database Branching (Copy-on-Write) & Time-Travel Queries
 * - Autonomous Workload Monitoring, Missing Index Recommendations & Safe Shadow Testing
 * - AI Agent Sandbox with Dangerous Query Risk Detection & Human Approval
 * - Query X-Ray with Estimated-vs-Actual Cardinality and EXPLAIN WHY Data Provenance
 */

import {
  TableSchema,
  Row,
  RecordId,
  QueryResult,
  WalRecordType,
  PageType,
  QueryPlanNode,
  BranchMergeResult,
  Value,
} from './types.ts';
import { DiskManager } from './storage/DiskManager.ts';
import { BufferPool } from './storage/BufferPool.ts';
import { SlottedPage } from './storage/SlottedPage.ts';
import { WALManager, RecoveryStep } from './wal/WALManager.ts';
import { BPlusTree, BPlusKey } from './index/BPlusTree.ts';
import { VectorIndex } from './index/VectorIndex.ts';
import { LearnedIndex } from './index/LearnedIndex.ts';
import { MVCCEngine, TxnSnapshot } from './mvcc/MVCCEngine.ts';
import { BranchManager } from './branching/BranchManager.ts';
import { WorkloadAdvisor } from './autonomous/WorkloadAdvisor.ts';
import { AgentSandbox } from './safety/AgentSandbox.ts';
import { QueryXRay } from './provenance/QueryXRay.ts';
import { Parser } from './sql/Parser.ts';
import {
  SQLStatement,
  CreateTableStatement,
  DropTableStatement,
  CreateIndexStatement,
  InsertStatement,
  SelectStatement,
  UpdateStatement,
  DeleteStatement,
  Expression,
} from './sql/AST.ts';
import {
  evaluateExpression,
  SeqScanExecutor,
  IndexScanExecutor,
  FilterExecutor,
  ProjectExecutor,
  SortExecutor,
  LimitExecutor,
  NestedLoopJoinExecutor,
  ValuesScanExecutor,
  VolcanoExecutor,
} from './query/QueryEngine.ts';

export class Database {
  public diskManager: DiskManager;
  public bufferPool: BufferPool;
  public wal: WALManager;
  public mvcc: MVCCEngine;
  public branchManager: BranchManager;
  public advisor: WorkloadAdvisor;
  public agentSandbox: AgentSandbox;

  // Indexes
  private schemas: Map<string, TableSchema> = new Map();
  private indexes: Map<string, BPlusTree> = new Map(); // "tableName.columnName" -> BPlusTree
  public vectorIndexes: Map<string, VectorIndex> = new Map();
  public learnedIndexes: Map<string, LearnedIndex> = new Map();

  private currentTxnId: number | null = null;
  private autoIncrementCounters: Map<string, number> = new Map();
  private branchSnapshots: Map<string, Map<string, Row[]>> = new Map();

  constructor(poolSize: number = 16) {
    this.diskManager = new DiskManager();
    this.bufferPool = new BufferPool(this.diskManager, poolSize);
    this.wal = new WALManager();
    this.mvcc = new MVCCEngine();
    this.branchManager = new BranchManager();
    this.advisor = new WorkloadAdvisor();
    this.agentSandbox = new AgentSandbox();

    // Enforce WAL flush invariant whenever buffer pool flushes dirty pages
    this.bufferPool.onBeforeFlushPage = (pageLsn: number) => {
      this.wal.flushToLsn(pageLsn);
    };

    // Seed default sample database
    this.seedDefaultDatabase();
  }

  public reset(): void {
    this.bufferPool.reset();
    this.diskManager.reset();
    this.wal.reset();
    this.mvcc.reset();
    this.branchManager.reset();
    this.advisor.reset();
    this.agentSandbox.reset();
    this.schemas.clear();
    this.indexes.clear();
    this.vectorIndexes.clear();
    this.learnedIndexes.clear();
    this.currentTxnId = null;
    this.autoIncrementCounters.clear();
    this.branchSnapshots.clear();
  }

  public seedDefaultDatabase(): void {
    this.reset();

    // 1. Create table: users
    this.executeSingle(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTO_INCREMENT,
        username TEXT NOT NULL,
        email TEXT NOT NULL,
        age INTEGER,
        department TEXT
      );
    `);

    // 2. Create table: orders
    this.executeSingle(`
      CREATE TABLE orders (
        order_id INTEGER PRIMARY KEY AUTO_INCREMENT,
        user_id INTEGER NOT NULL,
        amount FLOAT,
        status TEXT
      );
    `);

    // 3. Create table: vector_docs for Semantic Hybrid Search
    this.executeSingle(`
      CREATE TABLE vector_docs (
        doc_id INTEGER PRIMARY KEY AUTO_INCREMENT,
        title TEXT NOT NULL,
        category TEXT NOT NULL
      );
    `);

    // Insert sample users
    const sampleUsers = [
      { id: 1, username: 'alice_chen', email: 'alice@systems.dev', age: 29, department: 'Engineering' },
      { id: 2, username: 'bob_miller', email: 'bob@infra.net', age: 34, department: 'DevOps' },
      { id: 3, username: 'clara_oswald', email: 'clara@quant.io', age: 26, department: 'Analytics' },
      { id: 4, username: 'david_kim', email: 'david@kernel.org', age: 41, department: 'Engineering' },
      { id: 5, username: 'elena_rostova', email: 'elena@cyber.io', age: 31, department: 'Security' },
      { id: 6, username: 'frank_wright', email: 'frank@systems.dev', age: 38, department: 'Architecture' },
      { id: 7, username: 'grace_hopper', email: 'grace@navy.gov', age: 45, department: 'Engineering' },
      { id: 8, username: 'hector_salamanca', email: 'hector@cartel.biz', age: 52, department: 'Logistics' },
      { id: 9, username: 'iris_west', email: 'iris@central.news', age: 28, department: 'Editorial' },
      { id: 10, username: 'james_holden', email: 'james@roci.space', age: 35, department: 'Operations' },
      { id: 11, username: 'katherine_johnson', email: 'katherine@nasa.gov', age: 42, department: 'Analytics' },
      { id: 12, username: 'leo_fitz', email: 'leo@shield.agency', age: 30, department: 'Engineering' },
      { id: 13, username: 'maya_lin', email: 'maya@studio.art', age: 33, department: 'Design' },
      { id: 14, username: 'naomi_nagata', email: 'naomi@belters.org', age: 36, department: 'Engineering' },
      { id: 15, username: 'oscar_isaac', email: 'oscar@cinema.com', age: 44, department: 'Media' },
    ];

    for (const u of sampleUsers) {
      this.executeSingle(
        `INSERT INTO users (id, username, email, age, department) VALUES (${u.id}, '${u.username}', '${u.email}', ${u.age}, '${u.department}');`
      );
    }

    // Insert sample orders
    const sampleOrders = [
      { order_id: 101, user_id: 1, amount: 249.5, status: 'DELIVERED' },
      { order_id: 102, user_id: 1, amount: 49.99, status: 'DELIVERED' },
      { order_id: 103, user_id: 2, amount: 1200.0, status: 'PENDING' },
      { order_id: 104, user_id: 3, amount: 89.0, status: 'SHIPPED' },
      { order_id: 105, user_id: 4, amount: 560.25, status: 'DELIVERED' },
      { order_id: 106, user_id: 5, amount: 310.0, status: 'PENDING' },
      { order_id: 107, user_id: 7, amount: 75.0, status: 'DELIVERED' },
      { order_id: 108, user_id: 10, amount: 940.0, status: 'PROCESSING' },
    ];

    for (const o of sampleOrders) {
      this.executeSingle(
        `INSERT INTO orders (order_id, user_id, amount, status) VALUES (${o.order_id}, ${o.user_id}, ${o.amount}, '${o.status}');`
      );
    }

    // Insert sample vector documents
    const sampleDocs = [
      { id: 1, title: 'Linux Kernel Page Cache Management & TLB Invalidation', category: 'Operating Systems', vec: [0.88, 0.12, 0.45, 0.05] },
      { id: 2, title: 'Distributed Raft Consensus Protocol in Distributed Systems', category: 'Databases', vec: [0.15, 0.92, 0.35, 0.82] },
      { id: 3, title: 'Zero-Knowledge Proofs and Succinct Non-Interactive Arguments', category: 'Cryptography', vec: [0.05, 0.22, 0.94, 0.31] },
      { id: 4, title: 'PostgreSQL Buffer Pool & Clock Sweep Eviction Algorithms', category: 'Databases', vec: [0.25, 0.89, 0.40, 0.78] },
      { id: 5, title: 'High-Performance Asynchronous IO with io_uring in C', category: 'Operating Systems', vec: [0.85, 0.18, 0.39, 0.12] },
      { id: 6, title: 'Neural Vector Indexing with Hierarchical Navigable Small World', category: 'AI & Search', vec: [0.35, 0.45, 0.15, 0.95] },
    ];

    const vecIdx = new VectorIndex('vec_docs_embedding', 4);
    for (const d of sampleDocs) {
      this.executeSingle(`INSERT INTO vector_docs (doc_id, title, category) VALUES (${d.id}, '${d.title}', '${d.category}');`);
      vecIdx.insert(d.id, d.vec, { pageId: 2, slotIndex: d.id - 1 }, { title: d.title, text: `${d.title} ${d.category}` });
    }
    this.vectorIndexes.set('vector_docs.embedding', vecIdx);

    // Create B+ Tree index on users(age)
    this.executeSingle(`CREATE INDEX idx_users_age ON users (age);`);

    // Build Learned CDF Index for users.age
    const learnedAge = new LearnedIndex('learned_users_age');
    learnedAge.train(sampleUsers.map((u, i) => ({ key: u.age, rid: { pageId: 0, slotIndex: i } })));
    this.learnedIndexes.set('users.age', learnedAge);

    // Checkpoint so seed is flushed safely to disk
    this.checkpoint();
  }

  /**
   * Executes SQL with AI Agent Risk Guardrails, Materialized Caching,
   * Autonomous Workload Telemetry, and EXPLAIN WHY Provenance.
   */
  public execute(sql: string, options?: { asOfTimestamp?: number; bypassApproval?: boolean; isAgentQuery?: boolean }): QueryResult[] {
    const results: QueryResult[] = [];
    let statements: SQLStatement[];

    try {
      statements = Parser.parseAll(sql);
    } catch (err: any) {
      return [
        {
          statement: sql,
          success: false,
          error: err.message || 'Syntax error',
          executionTimeMs: 0,
          metrics: this.captureDeltaMetrics(0, 0, 0, 0, 0),
        },
      ];
    }

    for (const stmt of statements) {
      results.push(this.executeStatement(stmt, sql, options, statements.length === 1));
    }

    return results;
  }

  public executeSingle(sql: string, options?: { asOfTimestamp?: number }): QueryResult {
    const res = this.execute(sql, options);
    return res[0];
  }

  private executeStatement(
    stmt: SQLStatement,
    rawSql: string,
    options?: { asOfTimestamp?: number; bypassApproval?: boolean; isAgentQuery?: boolean },
    allowCache: boolean = true
  ): QueryResult {
    // 1. AI Agent Safety Guardrail: check for catastrophic mutation risks
    const targetTbl = (stmt as any).tableName?.toLowerCase() || (stmt as any).fromTable?.toLowerCase() || '';
    const tblCount = targetTbl && this.schemas.has(targetTbl) ? this.schemas.get(targetTbl)!.rowCount : 0;
    const risk = this.agentSandbox.analyzeRisk(stmt, rawSql, tblCount);
    const cacheKey = `${this.branchManager.activeBranch}:${rawSql}`;

    if (risk.requiresApproval && !options?.bypassApproval) {
      const pendingTicket = this.agentSandbox.enqueueApproval({
        agentId: options?.isAgentQuery ? 'autonomous-agent-01' : 'user-session',
        branch: this.branchManager.activeBranch,
        sql: rawSql,
        risk,
      });

      return {
        statement: rawSql,
        success: false,
        error: `BLOCKED BY AGENT SAFETY GUARDRAIL (${risk.level} RISK): ${risk.reasons.join(' ')} Operator approval required (Ticket ${pendingTicket.id}).`,
        executionTimeMs: 0,
        metrics: this.captureDeltaMetrics(0, 0, 0, 0, 0),
      };
    }

    // 2. Materialized Query Result Caching for SELECT
    if (allowCache && stmt.type === 'SELECT' && !stmt.isExplain && options?.asOfTimestamp === undefined && this.currentTxnId === null) {
      const cached = this.advisor.getCachedQuery(cacheKey);
      if (cached) {
        return {
          statement: rawSql,
          success: true,
          columns: cached.columns,
          rows: cached.rows,
          affectedRows: cached.rows.length,
          executionTimeMs: 0.12,
          cacheHit: true,
          metrics: this.captureDeltaMetrics(0, 0, 0, 0, 0),
        };
      }
    }

    const startRead = this.diskManager.readsCount;
    const startWrite = this.diskManager.writesCount;
    const startHits = this.bufferPool.hits;
    const startMisses = this.bufferPool.misses;
    const startWal = this.wal.getAllRecords().length;
    const startTime = performance.now();

    try {
      let result: QueryResult;
      switch (stmt.type) {
        case 'CREATE_TABLE':
          result = this.handleCreateTable(stmt, startTime, startRead, startWrite, startHits, startMisses, startWal);
          break;
        case 'DROP_TABLE':
          result = this.handleDropTable(stmt, startTime, startRead, startWrite, startHits, startMisses, startWal);
          break;
        case 'CREATE_INDEX':
          result = this.handleCreateIndex(stmt, startTime, startRead, startWrite, startHits, startMisses, startWal);
          break;
        case 'INSERT':
          result = this.handleInsert(stmt, startTime, startRead, startWrite, startHits, startMisses, startWal);
          break;
        case 'SELECT':
          result = this.handleSelect(stmt, startTime, startRead, startWrite, startHits, startMisses, startWal, options?.asOfTimestamp);
          break;
        case 'UPDATE':
          result = this.handleUpdate(stmt, startTime, startRead, startWrite, startHits, startMisses, startWal);
          break;
        case 'DELETE':
          result = this.handleDelete(stmt, startTime, startRead, startWrite, startHits, startMisses, startWal);
          break;
        case 'BEGIN':
          result = this.handleBegin(startTime, startRead, startWrite, startHits, startMisses, startWal);
          break;
        case 'COMMIT':
          result = this.handleCommit(startTime, startRead, startWrite, startHits, startMisses, startWal);
          break;
        case 'ROLLBACK':
          result = this.handleRollback(startTime, startRead, startWrite, startHits, startMisses, startWal);
          break;
        case 'CHECKPOINT':
          result = this.handleCheckpointStmt(startTime, startRead, startWrite, startHits, startMisses, startWal);
          break;
        default:
          throw new Error(`Unsupported statement type: ${(stmt as any).type}`);
      }

      // Record query in autonomous workload analyzer
      const elapsed = Math.round((performance.now() - startTime) * 100) / 100;
      this.advisor.recordQuery({
        sql: rawSql,
        targetTable: targetTbl,
        durationMs: elapsed,
        filterColumns: stmt.type === 'SELECT' && stmt.where?.left?.name ? [stmt.where.left.name] : [],
      });

      // Cache result if SELECT and successful
      if (allowCache && stmt.type === 'SELECT' && result.success && result.rows && options?.asOfTimestamp === undefined && this.currentTxnId === null) {
        const tables = [targetTbl];
        if (stmt.join) tables.push(stmt.join.table.toLowerCase());
        this.advisor.cacheQuery(cacheKey, result.rows, result.columns || [], tables);
      }

      // Invalidate query cache if table was mutated
      if (['INSERT', 'UPDATE', 'DELETE', 'DROP_TABLE'].includes(stmt.type)) {
        this.advisor.invalidateTable(targetTbl);
      }

      return result;
    } catch (err: any) {
      const elapsed = Math.round((performance.now() - startTime) * 100) / 100;
      return {
        statement: (stmt as any).type,
        success: false,
        error: err.message || String(err),
        executionTimeMs: elapsed,
        metrics: this.captureDeltaMetrics(startRead, startWrite, startHits, startMisses, startWal),
      };
    }
  }

  // --- Statement Handlers ---

  private handleCreateTable(
    stmt: CreateTableStatement,
    startTime: number,
    startRead: number,
    startWrite: number,
    startHits: number,
    startMisses: number,
    startWal: number
  ): QueryResult {
    const tblName = stmt.tableName.toLowerCase();
    if (this.schemas.has(tblName)) {
      if (stmt.ifNotExists) {
        return this.createSuccessResult(`Table '${tblName}' already exists`, startTime, startRead, startWrite, startHits, startMisses, startWal, 0);
      }
      throw new Error(`Table '${tblName}' already exists`);
    }

    if (stmt.columns.length === 0) throw new Error('CREATE TABLE requires at least one column');
    const columnNames = stmt.columns.map((column) => column.name.toLowerCase());
    if (new Set(columnNames).size !== columnNames.length) throw new Error('CREATE TABLE contains duplicate column names');
    if (stmt.columns.filter((column) => column.primaryKey).length > 1) {
      throw new Error('Only one primary-key column is supported');
    }
    if (stmt.columns.some((column) => column.autoIncrement && (column.type !== 'INTEGER' || !column.primaryKey))) {
      throw new Error('AUTO_INCREMENT requires an INTEGER primary-key column');
    }

    const { pageId, page } = this.bufferPool.newPage();
    page.initialize(pageId, PageType.HEAP_PAGE);
    this.bufferPool.unpinPage(pageId, true);

    const pkCol = stmt.columns.find((c) => c.primaryKey)?.name || stmt.columns[0]?.name || 'id';

    const schema: TableSchema = {
      name: tblName,
      columns: stmt.columns.map((c) => ({
        name: c.name,
        type: c.type,
        primaryKey: c.primaryKey,
        autoIncrement: c.autoIncrement,
        nullable: c.nullable,
        unique: c.unique,
        defaultValue: c.defaultValue,
      })),
      primaryKey: pkCol,
      indexes: [],
      vectorIndexes: [],
      rootPageId: pageId,
      indexRootPages: {},
      rowCount: 0,
    };

    this.schemas.set(tblName, schema);
    this.autoIncrementCounters.set(tblName, 1);
    this.createIndexInternal(tblName, `pk_${tblName}_${pkCol}`, pkCol);

    return this.createSuccessResult(
      `Table '${tblName}' created with primary key '${pkCol}'`,
      startTime,
      startRead,
      startWrite,
      startHits,
      startMisses,
      startWal,
      0
    );
  }

  private handleDropTable(
    stmt: DropTableStatement,
    startTime: number,
    startRead: number,
    startWrite: number,
    startHits: number,
    startMisses: number,
    startWal: number
  ): QueryResult {
    const tblName = stmt.tableName.toLowerCase();
    if (!this.schemas.has(tblName)) {
      if (stmt.ifExists) {
        return this.createSuccessResult(`Table '${tblName}' does not exist`, startTime, startRead, startWrite, startHits, startMisses, startWal, 0);
      }
      throw new Error(`Table '${tblName}' does not exist`);
    }

    this.schemas.delete(tblName);
    for (const key of Array.from(this.indexes.keys())) {
      if (key.startsWith(`${tblName}.`)) this.indexes.delete(key);
    }
    for (const key of Array.from(this.vectorIndexes.keys())) {
      if (key.startsWith(`${tblName}.`)) this.vectorIndexes.delete(key);
    }
    for (const key of Array.from(this.learnedIndexes.keys())) {
      if (key.startsWith(`${tblName}.`)) this.learnedIndexes.delete(key);
    }

    return this.createSuccessResult(`Table '${tblName}' dropped`, startTime, startRead, startWrite, startHits, startMisses, startWal, 0);
  }

  private handleCreateIndex(
    stmt: CreateIndexStatement,
    startTime: number,
    startRead: number,
    startWrite: number,
    startHits: number,
    startMisses: number,
    startWal: number
  ): QueryResult {
    const tblName = stmt.tableName.toLowerCase();
    const colName = stmt.columnName;
    const schema = this.getTableSchema(tblName);

    const colExists = schema.columns.some((c) => c.name.toLowerCase() === colName.toLowerCase());
    if (!colExists) {
      throw new Error(`Column '${colName}' does not exist on table '${tblName}'`);
    }

    const canonicalColumnName = schema.columns.find((column) => column.name.toLowerCase() === colName.toLowerCase())!.name;
    this.createIndexInternal(tblName, stmt.indexName, canonicalColumnName);

    return this.createSuccessResult(
      `Index '${stmt.indexName}' created on ${tblName}(${canonicalColumnName})`,
      startTime,
      startRead,
      startWrite,
      startHits,
      startMisses,
      startWal,
      0
    );
  }

  public createIndexInternal(tableName: string, indexName: string, columnName: string): void {
    const schema = this.getTableSchema(tableName);
    const column = schema.columns.find((candidate) => candidate.name.toLowerCase() === columnName.toLowerCase());
    if (!column) throw new Error(`Column '${columnName}' does not exist on table '${tableName}'`);
    const canonicalColumnName = column.name;
    const key = `${schema.name}.${canonicalColumnName.toLowerCase()}`;
    const tree = new BPlusTree(4);

    let currentPageId = schema.rootPageId;
    while (true) {
      const page = this.bufferPool.fetchPage(currentPageId);
      const slotCount = page.getSlotCount();
      for (let s = 0; s < slotCount; s++) {
        const row = page.getRow(s);
        if (row !== null && (!row._xmax || row._xmax === 0)) {
          const val = row[canonicalColumnName];
          if (val !== undefined && val !== null) {
            tree.insert(val as BPlusKey, { pageId: currentPageId, slotIndex: s });
          }
        }
      }
      const nextPage = page.getNextPageId();
      this.bufferPool.unpinPage(currentPageId, false);
      if (nextPage === 0) break;
      currentPageId = nextPage;
    }

    this.indexes.set(key, tree);
    if (!schema.indexes.some((existing) => existing.toLowerCase() === canonicalColumnName.toLowerCase())) {
      schema.indexes.push(canonicalColumnName);
    }
  }

  private rebuildIndexes(schema: TableSchema): void {
    for (const columnName of schema.indexes) {
      this.createIndexInternal(schema.name, `idx_${schema.name}_${columnName}`, columnName);
    }
  }

  private handleInsert(
    stmt: InsertStatement,
    startTime: number,
    startRead: number,
    startWrite: number,
    startHits: number,
    startMisses: number,
    startWal: number
  ): QueryResult {
    const tblName = stmt.tableName.toLowerCase();
    const schema = this.getTableSchema(tblName);
    const columnNames = stmt.columns?.length ? stmt.columns : schema.columns.map((column) => column.name);
    const normalizedNames = columnNames.map((name) => {
      const column = schema.columns.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase());
      if (!column) throw new Error(`Column '${name}' does not exist on table '${tblName}'`);
      return column.name;
    });
    if (new Set(normalizedNames).size !== normalizedNames.length) {
      throw new Error('INSERT column list contains duplicates');
    }

    const nextAutoIncrement = this.autoIncrementCounters.get(tblName) || 1;
    let autoIncrementValue = nextAutoIncrement;
    const activeBranch = this.branchManager.activeBranch;
    const existingRows = this.getBranchRows(activeBranch, tblName);
    const preparedRows: Row[] = [];

    for (const values of stmt.values) {
      if (values.length !== normalizedNames.length) {
        throw new Error(`INSERT has ${values.length} values for ${normalizedNames.length} columns`);
      }

      const row: Row = {};
      normalizedNames.forEach((columnName, index) => {
        row[columnName] = evaluateExpression(values[index], {});
      });

      for (const column of schema.columns) {
        if (row[column.name] === undefined && column.defaultValue !== undefined) {
          row[column.name] = column.defaultValue;
        }
        if (column.autoIncrement && (row[column.name] === null || row[column.name] === undefined)) {
          row[column.name] = autoIncrementValue++;
        }
        const value = row[column.name];
        const isPrimaryKey = column.name === schema.primaryKey;
        if ((value === null || value === undefined) && (!column.nullable || isPrimaryKey)) {
          throw new Error(`Column '${column.name}' cannot be NULL`);
        }
        if (column.unique && value !== null && value !== undefined &&
            (existingRows.some((existing) => existing[column.name] === value) ||
             preparedRows.some((existing) => existing[column.name] === value))) {
          throw new Error(`Duplicate value '${String(value)}' for unique column '${column.name}'`);
        }
        if (value !== null && value !== undefined) {
          const validType =
            (column.type === 'INTEGER' && typeof value === 'number' && Number.isInteger(value)) ||
            (column.type === 'FLOAT' && typeof value === 'number' && Number.isFinite(value)) ||
            (column.type === 'TEXT' && typeof value === 'string') ||
            (column.type === 'BOOLEAN' && typeof value === 'boolean') ||
            column.type === 'VECTOR';
          if (!validType) throw new Error(`Invalid value for ${column.type} column '${column.name}'`);
        }
      }

      const primaryKey = row[schema.primaryKey];
      if (existingRows.some((existing) => existing[schema.primaryKey] === primaryKey) ||
          preparedRows.some((existing) => existing[schema.primaryKey] === primaryKey)) {
        throw new Error(`Duplicate primary key '${String(primaryKey)}' for table '${tblName}'`);
      }
      preparedRows.push(row);
    }

    if (autoIncrementValue > nextAutoIncrement) {
      this.autoIncrementCounters.set(tblName, autoIncrementValue);
    }
    for (const column of schema.columns) {
      if (column.autoIncrement) {
        for (const row of preparedRows) {
          const value = row[column.name];
          if (typeof value === 'number' && value >= autoIncrementValue) {
            autoIncrementValue = Math.floor(value) + 1;
          }
        }
        this.autoIncrementCounters.set(tblName, autoIncrementValue);
      }
    }

    let insertedCount = 0;
    const txnId = this.currentTxnId ?? this.wal.startTransaction();
    const isAutoTxn = this.currentTxnId === null;
    if (isAutoTxn) this.mvcc.registerTxn(txnId);

    for (const row of preparedRows) {
      row._xmin = txnId;
      row._xmax = 0;
      row._timestamp = this.mvcc.getNextTimestamp();
      row._versionId = `v_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

      const rid = activeBranch === 'main' ? this.insertRowIntoHeap(schema, row, txnId) : null;

      if (activeBranch !== 'main') {
        this.branchManager.recordInsert(tblName, row, schema.primaryKey);
      }

      for (const colName of activeBranch === 'main' ? schema.indexes : []) {
        const indexKey = `${tblName}.${colName.toLowerCase()}`;
        const tree = this.indexes.get(indexKey);
        if (rid && tree && row[colName] !== undefined && row[colName] !== null) {
          tree.insert(row[colName] as BPlusKey, rid);
        }
      }

      if (activeBranch === 'main') schema.rowCount++;
      insertedCount++;
    }

    if (isAutoTxn) {
      this.wal.commitTransaction(txnId);
      this.mvcc.commitTxn(txnId);
    }

    return this.createSuccessResult(
      `Inserted ${insertedCount} row${insertedCount === 1 ? '' : 's'} into '${tblName}'`,
      startTime,
      startRead,
      startWrite,
      startHits,
      startMisses,
      startWal,
      insertedCount
    );
  }

  private insertRowIntoHeap(schema: TableSchema, row: Row, txnId: number): RecordId {
    let currentPageId = schema.rootPageId;

    while (true) {
      const page = this.bufferPool.fetchPage(currentPageId);
      const slotIndex = page.insertRow(row);

      if (slotIndex !== -1) {
        const lsn = this.wal.appendRecord({
          txnId,
          type: WalRecordType.INSERT,
          tableName: schema.name,
          pageId: currentPageId,
          slotIndex,
          beforeRow: null,
          afterRow: row,
        });

        page.setPageLsn(lsn);
        this.bufferPool.unpinPage(currentPageId, true);
        return { pageId: currentPageId, slotIndex };
      }

      const nextPageId = page.getNextPageId();
      if (nextPageId !== 0) {
        this.bufferPool.unpinPage(currentPageId, false);
        currentPageId = nextPageId;
      } else {
        const { pageId: newPageId, page: newPage } = this.bufferPool.newPage();
        newPage.initialize(newPageId, PageType.HEAP_PAGE);
        newPage.setPrevPageId(currentPageId);

        page.setNextPageId(newPageId);
        this.bufferPool.unpinPage(currentPageId, true);

        const newSlotIdx = newPage.insertRow(row);
        const lsn = this.wal.appendRecord({
          txnId,
          type: WalRecordType.INSERT,
          tableName: schema.name,
          pageId: newPageId,
          slotIndex: newSlotIdx,
          beforeRow: null,
          afterRow: row,
        });
        newPage.setPageLsn(lsn);
        this.bufferPool.unpinPage(newPageId, true);

        return { pageId: newPageId, slotIndex: newSlotIdx };
      }
    }
  }

  private readTableRows(schema: TableSchema): Row[] {
    return this.readTableEntries(schema).map((entry) => entry.row);
  }

  private readTableEntries(schema: TableSchema): { row: Row; pageId: number; slotIndex: number }[] {
    const rows: { row: Row; pageId: number; slotIndex: number }[] = [];
    let pageId = schema.rootPageId;
    while (true) {
      const page = this.bufferPool.fetchPage(pageId);
      for (let slot = 0; slot < page.getSlotCount(); slot++) {
        const row = page.getRow(slot);
        if (row && (!row._xmax || row._xmax === 0)) rows.push({ row, pageId, slotIndex: slot });
      }
      const nextPageId = page.getNextPageId();
      this.bufferPool.unpinPage(pageId, false);
      if (nextPageId === 0) break;
      pageId = nextPageId;
    }
    return rows;
  }

  private validateRows(schema: TableSchema, rows: Row[]): void {
    for (const column of schema.columns) {
      const seen = new Set<Value>();
      for (const row of rows) {
        const value = row[column.name];
        const isPrimaryKey = column.name === schema.primaryKey;
        if ((value === null || value === undefined) && (!column.nullable || isPrimaryKey)) {
          throw new Error(`Column '${column.name}' cannot be NULL`);
        }
        if (value !== null && value !== undefined) {
          const validType =
            (column.type === 'INTEGER' && typeof value === 'number' && Number.isInteger(value)) ||
            (column.type === 'FLOAT' && typeof value === 'number' && Number.isFinite(value)) ||
            (column.type === 'TEXT' && typeof value === 'string') ||
            (column.type === 'BOOLEAN' && typeof value === 'boolean') ||
            column.type === 'VECTOR';
          if (!validType) throw new Error(`Invalid value for ${column.type} column '${column.name}'`);
          if ((column.unique || isPrimaryKey) && seen.has(value)) {
            throw new Error(`Duplicate value '${String(value)}' for unique column '${column.name}'`);
          }
          if (column.unique || isPrimaryKey) seen.add(value);
        }
      }
    }
  }

  private handleSelect(
    stmt: SelectStatement,
    startTime: number,
    startRead: number,
    startWrite: number,
    startHits: number,
    startMisses: number,
    startWal: number,
    asOfTimestamp?: number
  ): QueryResult {
    const tblName = stmt.fromTable.toLowerCase();
    const schema = this.getTableSchema(tblName);
    const joinSchema = stmt.join ? this.getTableSchema(stmt.join.table) : null;
    const schemas = joinSchema ? [schema, joinSchema] : [schema];
    for (const item of stmt.columns) this.validateExpressionColumns(item.expression, schemas);
    if (stmt.where) this.validateExpressionColumns(stmt.where, schemas);
    if (stmt.join) this.validateExpressionColumns(stmt.join.on, schemas);
    this.validateExpressionColumns({ type: 'Identifier', name: stmt.orderBy?.column }, schemas, true);
    const activeBranch = this.branchManager.activeBranch;

    // MVCC snapshot for isolation
    const snapshotTxnId = this.currentTxnId ?? this.mvcc.getNextTimestamp();
    const snapshot = this.mvcc.createSnapshot(snapshotTxnId);

    // Build Execution Plan (Volcano Model)
    let executor: VolcanoExecutor;
    const indexScanOpportunity = stmt.join || activeBranch !== 'main' ? null : this.detectIndexScan(schema, stmt.where);

    if (stmt.join) {
      const joinedSchema = joinSchema!;
      const leftScan = activeBranch === 'main'
        ? new SeqScanExecutor(this.bufferPool, schema)
        : new ValuesScanExecutor(this.getBranchRows(activeBranch, tblName));
      const rightScan = activeBranch === 'main'
        ? new SeqScanExecutor(this.bufferPool, joinedSchema)
        : new ValuesScanExecutor(this.getBranchRows(activeBranch, joinedSchema.name));
      executor = new NestedLoopJoinExecutor(
        leftScan,
        rightScan,
        stmt.join,
        tblName
      );
    } else if (activeBranch !== 'main') {
      executor = new ValuesScanExecutor(this.getBranchRows(activeBranch, tblName));
    } else if (indexScanOpportunity) {
      const tree = this.indexes.get(`${tblName}.${indexScanOpportunity.column.toLowerCase()}`)!;
      executor = new IndexScanExecutor(
        this.bufferPool,
        schema,
        tree,
        indexScanOpportunity.column,
        indexScanOpportunity.lookup
      );
    } else {
      executor = new SeqScanExecutor(this.bufferPool, schema);
    }

    if (stmt.where) {
      executor = new FilterExecutor(executor, stmt.where);
    }

    if (stmt.orderBy) {
      executor = new SortExecutor(executor, stmt.orderBy.column, stmt.orderBy.direction);
    }

    executor = new ProjectExecutor(executor, stmt);

    if (stmt.limit !== undefined) {
      executor = new LimitExecutor(executor, stmt.limit);
    }

    const planNode = executor.getPlanNode();

    // EXPLAIN ANALYZE handling
    if (stmt.isExplain) {
      const elapsed = Math.round((performance.now() - startTime) * 100) / 100;
      return {
        statement: `EXPLAIN SELECT ... FROM ${tblName}`,
        success: true,
        columns: ['PLAN_OPERATOR', 'EST_COST', 'DETAILS'],
        rows: [
          {
            PLAN_OPERATOR: planNode.nodeType,
            EST_COST: planNode.estimatedCost,
            DETAILS: planNode.details,
          },
        ],
        queryPlan: planNode,
        executionTimeMs: elapsed,
        metrics: this.captureDeltaMetrics(startRead, startWrite, startHits, startMisses, startWal),
      };
    }

    // Execute pipeline with MVCC Visibility Filtering
    executor.open();
    const rows: Row[] = [];
    const allCandidates: Row[] = [];
    let r: Row | null;

    while ((r = executor.next()) !== null) {
      allCandidates.push(r);

      // Check MVCC or Time-Travel visibility
      const joinedRows = (r as Row & { _joinRows?: Row[] })._joinRows;
      const isVis = joinedRows
        ? joinedRows.every((row) => asOfTimestamp
          ? this.mvcc.isVisibleAtTime(row, asOfTimestamp)
          : this.mvcc.isVisible(row, snapshot))
        : asOfTimestamp
          ? this.mvcc.isVisibleAtTime(r, asOfTimestamp)
          : this.mvcc.isVisible(r, snapshot);

      if (isVis) {
        rows.push(r);
      }
    }
    executor.close();

    const elapsed = Math.round((performance.now() - startTime) * 100) / 100;

    // Enrich Volcano Plan Node with Estimated vs Actual Metrics for Query X-Ray
    const enrichedPlan = QueryXRay.enrichPlanNode(
      planNode,
      rows.length,
      elapsed,
      this.bufferPool.hits - startHits,
      this.diskManager.readsCount - startRead
    );
    enrichedPlan.estimatedRows ??= schema.rowCount;

    // Compute EXPLAIN WHY / WHY NOT Provenance summary
    const provenanceTraces = QueryXRay.explainWhy(allCandidates.slice(0, 5), stmt.where);
    const whySummary = provenanceTraces.map((t) => t.explanation);

    const cols =
      stmt.columns.length > 0
        ? stmt.columns.map((c) => c.alias || (c.expression.type === 'Identifier' ? c.expression.name! : 'expr'))
        : rows.length > 0
        ? Object.keys(rows[0]).filter((k) => !k.startsWith('_'))
        : schema.columns.map((c) => c.name);

    const resultRows = rows.map((row) => Object.fromEntries(cols.map((column) => [column, row[column] ?? null])) as Row);

    return {
      statement: `SELECT FROM ${tblName}`,
      success: true,
      columns: cols,
      rows: resultRows,
      affectedRows: resultRows.length,
      executionTimeMs: elapsed,
      queryPlan: enrichedPlan,
      provenanceWhy: whySummary,
      branch: this.branchManager.activeBranch,
      metrics: this.captureDeltaMetrics(startRead, startWrite, startHits, startMisses, startWal),
    };
  }

  private detectIndexScan(
    schema: TableSchema,
    where?: Expression
  ): { column: string; lookup: { op: '=' | 'RANGE'; key?: BPlusKey; minKey?: BPlusKey; maxKey?: BPlusKey } } | null {
    if (!where || where.type !== 'Binary') return null;

    if (where.operator === '=' && where.left?.type === 'Identifier' && where.right?.type === 'Literal') {
      const col = where.left.name;
      if (col) {
        const indexKey = `${schema.name}.${col.toLowerCase()}`;
        if (this.indexes.has(indexKey)) {
          return {
            column: col,
            lookup: { op: '=', key: where.right.value as BPlusKey },
          };
        }
      }
    }

    if (where.operator === 'AND' && where.left?.type === 'Binary' && where.right?.type === 'Binary') {
      const left = where.left;
      const right = where.right;
      if (
        left.left?.type === 'Identifier' &&
        right.left?.type === 'Identifier' &&
        left.left.name &&
        left.left.name === right.left.name
      ) {
        const col = left.left.name;
        const indexKey = `${schema.name}.${col.toLowerCase()}`;
        if (this.indexes.has(indexKey)) {
          let minKey: BPlusKey | undefined;
          let maxKey: BPlusKey | undefined;

          if (left.operator === '>=' || left.operator === '>') {
            minKey = left.right?.value as BPlusKey;
          }
          if (right.operator === '<=' || right.operator === '<') {
            maxKey = right.right?.value as BPlusKey;
          }

          if (minKey !== undefined && maxKey !== undefined) {
            return {
              column: col,
              lookup: { op: 'RANGE', minKey, maxKey },
            };
          }
        }
      }
    }

    return null;
  }

  private handleUpdate(
    stmt: UpdateStatement,
    startTime: number,
    startRead: number,
    startWrite: number,
    startHits: number,
    startMisses: number,
    startWal: number
  ): QueryResult {
    const tblName = stmt.tableName.toLowerCase();
    const schema = this.getTableSchema(tblName);
    for (const item of stmt.set) {
      this.validateExpressionColumns(item.value, [schema]);
    }
    if (stmt.where) this.validateExpressionColumns(stmt.where, [schema]);
    const activeBranch = this.branchManager.activeBranch;
    const branchRows = activeBranch === 'main' ? null : this.getBranchRows(activeBranch, tblName);
    const entries = activeBranch === 'main' ? this.readTableEntries(schema) : [];
    const rows = branchRows ?? entries.map((entry) => entry.row);
    const setColumns = stmt.set.map((item) => {
      const column = schema.columns.find((candidate) => candidate.name.toLowerCase() === item.column.toLowerCase());
      if (!column) throw new Error(`Column '${item.column}' does not exist on table '${tblName}'`);
      return { column: column.name, value: item.value };
    });
    const planned = rows
      .filter((row) => (!row._xmax || row._xmax === 0) && (!stmt.where || Boolean(evaluateExpression(stmt.where, row))))
      .map((beforeRow) => {
        const afterRow = { ...beforeRow };
        for (const item of setColumns) afterRow[item.column] = evaluateExpression(item.value, beforeRow);
        return { beforeRow, afterRow };
      });
    const plannedByPk = new Map(planned.map(({ beforeRow, afterRow }) => [beforeRow[schema.primaryKey], afterRow]));
    const finalRows = rows.map((row) => plannedByPk.get(row[schema.primaryKey]) ?? row);
    this.validateRows(schema, finalRows);

    if (activeBranch !== 'main') {
      for (const { beforeRow, afterRow } of planned) {
        this.branchManager.recordUpdate(tblName, beforeRow[schema.primaryKey], afterRow, schema.primaryKey);
      }
    } else if (planned.length > 0) {
      const txnId = this.currentTxnId ?? this.wal.startTransaction();
      const isAutoTxn = this.currentTxnId === null;
      if (isAutoTxn) this.mvcc.registerTxn(txnId);

      for (const { beforeRow, afterRow } of planned) {
        const entry = entries.find((candidate) => candidate.row[schema.primaryKey] === beforeRow[schema.primaryKey]);
        if (!entry) throw new Error(`Could not locate row '${String(beforeRow[schema.primaryKey])}' for update`);
        const oldPage = this.bufferPool.fetchPage(entry.pageId);
        const currentRow = oldPage.getRow(entry.slotIndex);
        if (!currentRow || currentRow._xmax) {
          this.bufferPool.unpinPage(entry.pageId, false);
          throw new Error('Row changed before update could be applied');
        }
        currentRow._xmax = txnId;
        currentRow._deletedTimestamp = this.mvcc.getNextTimestamp();
        oldPage.updateRow(entry.slotIndex, currentRow);
        this.bufferPool.unpinPage(entry.pageId, true);

        afterRow._xmin = txnId;
        afterRow._xmax = 0;
        afterRow._timestamp = this.mvcc.getNextTimestamp();
        afterRow._versionId = `v_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        this.insertRowIntoHeap(schema, afterRow, txnId);

        const page = this.bufferPool.fetchPage(entry.pageId);
        const lsn = this.wal.appendRecord({
          txnId,
          type: WalRecordType.UPDATE,
          tableName: schema.name,
          pageId: entry.pageId,
          slotIndex: entry.slotIndex,
          beforeRow,
          afterRow,
        });
        page.setPageLsn(lsn);
        this.bufferPool.unpinPage(entry.pageId, true);
      }

      this.rebuildIndexes(schema);
      if (isAutoTxn) {
        this.wal.commitTransaction(txnId);
        this.mvcc.commitTxn(txnId);
      }
    }

    return this.createSuccessResult(
      `Updated ${planned.length} row${planned.length === 1 ? '' : 's'} in '${tblName}'`,
      startTime,
      startRead,
      startWrite,
      startHits,
      startMisses,
      startWal,
      planned.length
    );
  }

  private handleDelete(
    stmt: DeleteStatement,
    startTime: number,
    startRead: number,
    startWrite: number,
    startHits: number,
    startMisses: number,
    startWal: number
  ): QueryResult {
    const tblName = stmt.tableName.toLowerCase();
    const schema = this.getTableSchema(tblName);
    if (stmt.where) this.validateExpressionColumns(stmt.where, [schema]);

    if (this.branchManager.activeBranch !== 'main') {
      const rows = this.getBranchRows(this.branchManager.activeBranch, tblName);
      let deletedCount = 0;
      for (const row of rows) {
        if (!stmt.where || Boolean(evaluateExpression(stmt.where, row))) {
          this.branchManager.recordDelete(tblName, row[schema.primaryKey], schema.primaryKey);
          deletedCount++;
        }
      }
      return this.createSuccessResult(
        `Deleted ${deletedCount} row${deletedCount === 1 ? '' : 's'} from '${tblName}'`,
        startTime,
        startRead,
        startWrite,
        startHits,
        startMisses,
        startWal,
        deletedCount
      );
    }

    const txnId = this.currentTxnId ?? this.wal.startTransaction();
    const isAutoTxn = this.currentTxnId === null;
    if (isAutoTxn) this.mvcc.registerTxn(txnId);

    let deletedCount = 0;
    let currentPageId = schema.rootPageId;

    while (true) {
      const page = this.bufferPool.fetchPage(currentPageId);
      const slotCount = page.getSlotCount();

      for (let s = 0; s < slotCount; s++) {
        const row = page.getRow(s);
        if (row !== null && (!row._xmax || row._xmax === 0)) {
          const matches = !stmt.where || Boolean(evaluateExpression(stmt.where, row));
          if (matches) {
            // MVCC write-write conflict check
            const conflict = this.mvcc.checkWriteConflict(row, txnId);
            if (conflict.hasConflict) {
              this.bufferPool.unpinPage(currentPageId, false);
              throw new Error(conflict.reason);
            }

            const beforeRow = { ...row };
            row._xmax = txnId;
            (row as any)._deletedTimestamp = this.mvcc.getNextTimestamp();
            page.updateRow(s, row);

            const pk = beforeRow[schema.primaryKey];
            if (this.branchManager.activeBranch !== 'main' && pk !== undefined) {
              this.branchManager.recordDelete(tblName, pk);
            }

            const lsn = this.wal.appendRecord({
              txnId,
              type: WalRecordType.DELETE,
              tableName: schema.name,
              pageId: currentPageId,
              slotIndex: s,
              beforeRow,
              afterRow: { ...row },
            });
            page.setPageLsn(lsn);
            deletedCount++;
          }
        }
      }

      const nextPageId = page.getNextPageId();
      this.bufferPool.unpinPage(currentPageId, true);
      if (nextPageId === 0) break;
      currentPageId = nextPageId;
    }

    schema.rowCount = Math.max(0, schema.rowCount - deletedCount);
    this.rebuildIndexes(schema);

    if (isAutoTxn) {
      this.wal.commitTransaction(txnId);
      this.mvcc.commitTxn(txnId);
    }

    return this.createSuccessResult(
      `Deleted ${deletedCount} row${deletedCount === 1 ? '' : 's'} from '${tblName}'`,
      startTime,
      startRead,
      startWrite,
      startHits,
      startMisses,
      startWal,
      deletedCount
    );
  }

  private validateExpressionColumns(expression: Expression, schemas: TableSchema[], allowMissing: boolean = false): void {
    if (expression.type === 'Identifier') {
      const matchingSchemas = schemas.filter((schema) =>
        expression.table
          ? schema.name.toLowerCase() === expression.table.toLowerCase()
          : schema.columns.some((column) => column.name.toLowerCase() === expression.name?.toLowerCase())
      );
      if (matchingSchemas.length === 0) {
        if (allowMissing) return;
        throw new Error(expression.table
          ? `Unknown column '${expression.table}.${expression.name}'`
          : `Unknown column '${expression.name}'`);
      }
      if (!expression.table && matchingSchemas.length > 1) {
        throw new Error(`Ambiguous column '${expression.name}'`);
      }
      if (expression.table && !matchingSchemas[0].columns.some((column) => column.name.toLowerCase() === expression.name?.toLowerCase())) {
        throw new Error(`Unknown column '${expression.table}.${expression.name}'`);
      }
      return;
    }

    if (expression.type === 'Binary') {
      if (expression.left) this.validateExpressionColumns(expression.left, schemas);
      if (expression.right) this.validateExpressionColumns(expression.right, schemas);
    } else if (expression.type === 'Unary' && expression.operand) {
      this.validateExpressionColumns(expression.operand, schemas);
    }
  }

  private handleBegin(
    startTime: number,
    startRead: number,
    startWrite: number,
    startHits: number,
    startMisses: number,
    startWal: number
  ): QueryResult {
    if (this.currentTxnId !== null) {
      throw new Error(`Transaction #${this.currentTxnId} is already in progress`);
    }
    const txnId = this.wal.startTransaction();
    this.currentTxnId = txnId;
    this.mvcc.registerTxn(txnId);
    return this.createSuccessResult(`Transaction #${txnId} started with MVCC snapshot isolation`, startTime, startRead, startWrite, startHits, startMisses, startWal, 0);
  }

  private handleCommit(
    startTime: number,
    startRead: number,
    startWrite: number,
    startHits: number,
    startMisses: number,
    startWal: number
  ): QueryResult {
    if (this.currentTxnId === null) {
      throw new Error('No active transaction to commit');
    }
    const txnId = this.currentTxnId;
    this.wal.commitTransaction(txnId);
    this.mvcc.commitTxn(txnId);
    this.currentTxnId = null;
    return this.createSuccessResult(`Transaction #${txnId} committed`, startTime, startRead, startWrite, startHits, startMisses, startWal, 0);
  }

  private handleRollback(
    startTime: number,
    startRead: number,
    startWrite: number,
    startHits: number,
    startMisses: number,
    startWal: number
  ): QueryResult {
    if (this.currentTxnId === null) {
      throw new Error('No active transaction to rollback');
    }
    const txnId = this.currentTxnId;
    this.rollbackTxnInMemory(txnId);
    this.wal.abortTransaction(txnId);
    this.mvcc.abortTxn(txnId);
    this.currentTxnId = null;
    return this.createSuccessResult(`Transaction #${txnId} rolled back`, startTime, startRead, startWrite, startHits, startMisses, startWal, 0);
  }

  private handleCheckpointStmt(
    startTime: number,
    startRead: number,
    startWrite: number,
    startHits: number,
    startMisses: number,
    startWal: number
  ): QueryResult {
    this.checkpoint();
    return this.createSuccessResult(
      `Checkpoint complete: all dirty buffer frames flushed and WAL checkpoint logged`,
      startTime,
      startRead,
      startWrite,
      startHits,
      startMisses,
      startWal,
      0
    );
  }

  public checkpoint(): void {
    this.bufferPool.flushAll();
    this.wal.createCheckpoint();
  }

  public simulateCrash(): void {
    this.bufferPool.reset(true);
    this.wal.discardUnflushedRecords();
    this.currentTxnId = null;
  }

  public runRecovery(): {
    activeTxnIds: number[];
    committedTxnIds: number[];
    abortedTxnIds: number[];
    steps: RecoveryStep[];
  } {
    const plan = this.wal.analyzeAndPlanRecovery();
    const cachedFrames = new Map(
      this.bufferPool.getFramesSnapshot()
        .filter((frame) => frame.pageId !== null)
        .map((frame) => [frame.pageId!, frame])
    );

    for (const pageId of this.diskManager.getExistingPageIds()) {
      const diskPage = new SlottedPage(this.diskManager.readPage(pageId));
      if (diskPage.verifyChecksum()) continue;
      const cachedFrame = cachedFrames.get(pageId);
      if (cachedFrame && new SlottedPage(cachedFrame.data).verifyChecksum()) {
        this.wal.flushToLsn(cachedFrame.pageLsn);
        this.diskManager.writePage(pageId, cachedFrame.data);
      }
    }

    for (const rec of this.wal.getPersistentRecords()) {
      if (rec.lsn >= plan.redoStartLsn && rec.pageId !== undefined) {
        if (rec.type === WalRecordType.INSERT && rec.afterRow) {
          const page = this.bufferPool.fetchPage(rec.pageId);
          if (rec.slotIndex !== undefined) {
            if (page.getRow(rec.slotIndex)) {
              page.updateRow(rec.slotIndex, rec.afterRow);
            } else {
              const insertedSlot = page.insertRow(rec.afterRow);
              if (insertedSlot !== rec.slotIndex) {
                this.bufferPool.unpinPage(rec.pageId, false);
                throw new Error(`Recovery could not restore slot ${rec.slotIndex} on page ${rec.pageId}`);
              }
            }
          }
          page.setPageLsn(rec.lsn);
          this.bufferPool.unpinPage(rec.pageId, true);
        } else if (rec.type === WalRecordType.UPDATE && rec.beforeRow && rec.slotIndex !== undefined) {
          const page = this.bufferPool.fetchPage(rec.pageId);
          const row = page.getRow(rec.slotIndex);
          if (row && row._xmax !== rec.txnId) {
            row._xmax = rec.txnId;
            row._deletedTimestamp = Math.max(row._timestamp ?? 0, (rec.afterRow?._timestamp ?? 0) - 1);
            page.updateRow(rec.slotIndex, row);
          }
          page.setPageLsn(rec.lsn);
          this.bufferPool.unpinPage(rec.pageId, true);
        } else if (rec.type === WalRecordType.DELETE && rec.afterRow && rec.slotIndex !== undefined) {
          const page = this.bufferPool.fetchPage(rec.pageId);
          page.updateRow(rec.slotIndex, rec.afterRow);
          page.setPageLsn(rec.lsn);
          this.bufferPool.unpinPage(rec.pageId, true);
        }
      }
    }

    for (const txnId of plan.activeTxnIds) {
      this.rollbackTxnInMemory(txnId);
    }

    for (const schema of this.schemas.values()) {
      schema.rowCount = this.readTableRows(schema).length;
      this.rebuildIndexes(schema);
      this.advisor.invalidateTable(schema.name);
    }

    return plan;
  }

  private rollbackTxnInMemory(txnId: number): void {
    const allRecs = this.wal.getAllRecords();
    for (let i = allRecs.length - 1; i >= 0; i--) {
      const rec = allRecs[i];
      if (rec.txnId === txnId && rec.pageId !== undefined && rec.slotIndex !== undefined) {
        const page = this.bufferPool.fetchPage(rec.pageId);
        if (rec.type === WalRecordType.INSERT) {
          page.deleteRecord(rec.slotIndex);
        } else if (rec.type === WalRecordType.UPDATE && rec.beforeRow) {
          page.updateRow(rec.slotIndex, rec.beforeRow);
        } else if (rec.type === WalRecordType.DELETE && rec.beforeRow) {
          page.updateRow(rec.slotIndex, rec.beforeRow);
        }
        this.bufferPool.unpinPage(rec.pageId, true);
      }
    }

    for (const schema of this.schemas.values()) {
      let rowCount = 0;
      let pageId = schema.rootPageId;
      while (true) {
        const page = this.bufferPool.fetchPage(pageId);
        for (let slot = 0; slot < page.getSlotCount(); slot++) {
          const row = page.getRow(slot);
          if (row && (!row._xmax || row._xmax === 0)) rowCount++;
        }
        const nextPageId = page.getNextPageId();
        this.bufferPool.unpinPage(pageId, false);
        if (nextPageId === 0) break;
        pageId = nextPageId;
      }
      schema.rowCount = rowCount;
      this.rebuildIndexes(schema);
    }
  }

  public getTableSchema(name: string): TableSchema {
    const schema = this.schemas.get(name.toLowerCase());
    if (!schema) {
      throw new Error(`Table '${name}' does not exist`);
    }
    return schema;
  }

  public getAllSchemas(): TableSchema[] {
    return Array.from(this.schemas.values()).map((schema) => this.branchManager.activeBranch === 'main'
      ? schema
      : { ...schema, rowCount: this.getBranchRows(this.branchManager.activeBranch, schema.name).length });
  }

  public getTablePageCount(tableName: string): number {
    const schema = this.getTableSchema(tableName);
    const visited = new Set<number>();
    let pageId = schema.rootPageId;
    let count = 0;
    while (true) {
      if (visited.has(pageId)) throw new Error(`Page chain cycle detected for table '${schema.name}'`);
      visited.add(pageId);
      const page = this.bufferPool.fetchPage(pageId);
      const nextPageId = page.getNextPageId();
      this.bufferPool.unpinPage(pageId, false);
      count++;
      if (nextPageId === 0) return count;
      pageId = nextPageId;
    }
  }

  public getIndex(tableName: string, colName: string): BPlusTree | undefined {
    return this.indexes.get(`${tableName.toLowerCase()}.${colName.toLowerCase()}`);
  }

  public getAllIndexes(): { tableName: string; columnName: string; tree: BPlusTree }[] {
    const list: { tableName: string; columnName: string; tree: BPlusTree }[] = [];
    for (const [key, tree] of this.indexes.entries()) {
      const [tableName, columnName] = key.split('.');
      list.push({ tableName, columnName, tree });
    }
    return list;
  }

  public getCurrentTxnId(): number | null {
    return this.currentTxnId;
  }

  // --- Chaos Engineering & Integrity ---

  public injectCorruption(pageId: number): void {
    const raw = this.diskManager.readPage(pageId);
    const page = new SlottedPage(raw);
    page.injectBitFlip(50); // Flip bits at offset 50
    this.diskManager.writePage(pageId, page.raw);
  }

  public verifyDatabaseIntegrity(): { totalPages: number; corruptedPages: number[]; validPages: number[] } {
    const pageIds = this.diskManager.getExistingPageIds();
    const corrupted: number[] = [];
    const valid: number[] = [];

    for (const id of pageIds) {
      const raw = this.diskManager.readPage(id);
      const page = new SlottedPage(raw);
      if (page.verifyChecksum()) {
        valid.push(id);
      } else {
        corrupted.push(id);
      }
    }

    return {
      totalPages: pageIds.length,
      corruptedPages: corrupted,
      validPages: valid,
    };
  }

  private createSuccessResult(
    msg: string,
    startTime: number,
    startRead: number,
    startWrite: number,
    startHits: number,
    startMisses: number,
    startWal: number,
    affectedRows: number = 0
  ): QueryResult {
    const elapsed = Math.round((performance.now() - startTime) * 100) / 100;
    return {
      statement: msg,
      success: true,
      affectedRows,
      executionTimeMs: elapsed,
      branch: this.branchManager.activeBranch,
      metrics: this.captureDeltaMetrics(startRead, startWrite, startHits, startMisses, startWal),
    };
  }

  private captureDeltaMetrics(
    startRead: number,
    startWrite: number,
    startHits: number,
    startMisses: number,
    startWal: number
  ) {
    return {
      diskReads: this.diskManager.readsCount - startRead,
      diskWrites: this.diskManager.writesCount - startWrite,
      bufferHits: this.bufferPool.hits - startHits,
      bufferMisses: this.bufferPool.misses - startMisses,
      walRecordsLogged: this.wal.getAllRecords().length - startWal,
    };
  }

  public createBranch(name: string, fromBranch: string = this.branchManager.activeBranch, description: string = ''): void {
    const source = fromBranch.toLowerCase().trim();
    if (!this.branchManager.getAllBranches().some((branch) => branch.name === source)) {
      throw new Error(`Branch '${source}' does not exist`);
    }
    const branch = this.branchManager.createBranch(name, source, description);
    const snapshot = new Map<string, Row[]>();
    for (const schema of this.schemas.values()) {
      snapshot.set(schema.name, this.getBranchRows(source, schema.name));
    }
    this.branchSnapshots.set(branch.name, snapshot);
  }

  public mergeBranch(sourceBranch: string, targetBranch: string = 'main'): BranchMergeResult {
    const source = sourceBranch.toLowerCase().trim();
    const target = targetBranch.toLowerCase().trim();
    if (!this.branchManager.getAllBranches().some((branch) => branch.name === source)) {
      throw new Error(`Branch '${source}' does not exist`);
    }
    if (!this.branchManager.getAllBranches().some((branch) => branch.name === target)) {
      throw new Error(`Branch '${target}' does not exist`);
    }
    const pendingDiffs = this.branchManager.diff(target, source);
    const baseSnapshot = this.branchSnapshots.get(source);
    const conflicts: BranchMergeResult['conflicts'] = [];

    for (const diff of pendingDiffs) {
      const schema = this.getTableSchema(diff.tableName);
      const baseRows = baseSnapshot?.get(schema.name) ?? [];
      const targetRows = this.getBranchRows(target, schema.name);
      const baseRow = baseRows.find((row) => row[schema.primaryKey] === diff.primaryKey);
      const targetRow = targetRows.find((row) => row[schema.primaryKey] === diff.primaryKey);
      const rowIsUnchanged = baseRow && targetRow && schema.columns.every(
        (column) => baseRow[column.name] === targetRow[column.name]
      );

      if ((diff.action === 'ADDED' && targetRow) ||
          (diff.action !== 'ADDED' && (!baseRow || !targetRow || !rowIsUnchanged))) {
        conflicts.push({
          tableName: schema.name,
          primaryKey: diff.primaryKey,
          message: targetRow ? 'Target row changed since the branch snapshot' : 'Target row no longer exists',
        });
      }
    }

    if (conflicts.length > 0) {
      return {
        success: false,
        sourceBranch: source,
        targetBranch: target,
        appliedChanges: 0,
        conflicts,
        mergeLsn: this.wal.getNextLsn(),
      };
    }

    const previousBranch = this.branchManager.activeBranch;
    this.branchManager.switchBranch(target);
    let result: BranchMergeResult;

    try {
      result = this.branchManager.merge(source, target, (diff) => {
        const schema = this.getTableSchema(diff.tableName);
        const primaryKey = schema.primaryKey;
        let sql: string;

        if (diff.action === 'ADDED' && diff.targetRow) {
          const columns = schema.columns.map((column) => column.name);
          const values = columns.map((column) => this.toSqlLiteral(diff.targetRow![column]));
          sql = `INSERT INTO ${schema.name} (${columns.join(', ')}) VALUES (${values.join(', ')});`;
        } else if (diff.action === 'MODIFIED' && diff.targetRow) {
          const assignments = schema.columns
            .filter((column) => column.name !== primaryKey)
            .map((column) => `${column.name} = ${this.toSqlLiteral(diff.targetRow![column.name])}`);
          sql = `UPDATE ${schema.name} SET ${assignments.join(', ')} WHERE ${primaryKey} = ${this.toSqlLiteral(diff.primaryKey)};`;
        } else {
          sql = `DELETE FROM ${schema.name} WHERE ${primaryKey} = ${this.toSqlLiteral(diff.primaryKey)};`;
        }

        const results = this.execute(sql, { bypassApproval: true });
        if (results.some((queryResult) => !queryResult.success)) {
          throw new Error(results.find((queryResult) => !queryResult.success)?.error || 'Merge operation failed');
        }
      });
    } finally {
      this.branchManager.switchBranch(previousBranch);
    }

    if (result.success) {
      this.branchManager.clearOverlay(source);
      const snapshot = new Map<string, Row[]>();
      for (const schema of this.schemas.values()) snapshot.set(schema.name, this.readTableRows(schema));
      this.branchSnapshots.set(source, snapshot);
    }
    return result;
  }

  private toSqlLiteral(value: unknown): string {
    if (value === null || value === undefined) return 'NULL';
    if (typeof value === 'string') {
      return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    }
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    throw new Error('Cannot merge a value that is not supported by SQL literals');
  }

  private getBranchRows(branchName: string, tableName: string): Row[] {
    const branch = branchName.toLowerCase();
    const schema = this.getTableSchema(tableName);
    const snapshotRows = this.branchSnapshots.get(branch)?.get(schema.name);
    const rows = (snapshotRows ?? this.readTableRows(schema)).map((row) => ({ ...row }));
    if (branch === 'main') return rows;

    const overlay = this.branchManager.getOverlay(branch);
    const deleted = overlay.deletedRowPks.get(schema.name) ?? new Set();
    const modified = overlay.modifiedRows.get(schema.name) ?? new Map();
    const byPrimaryKey = new Map(rows.map((row) => [row[schema.primaryKey], row]));
    const result = rows
      .filter((row) => !deleted.has(row[schema.primaryKey]))
      .map((row) => ({ ...(modified.get(row[schema.primaryKey]) ?? row) }));
    const presentKeys = new Set(rows.map((row) => row[schema.primaryKey]));

    for (const [primaryKey, row] of modified) {
      if (!presentKeys.has(primaryKey) && !deleted.has(primaryKey)) result.push({ ...row });
    }
    for (const row of overlay.addedRows.get(schema.name) ?? []) {
      if (!deleted.has(row[schema.primaryKey])) result.push({ ...row });
    }
    return result;
  }

  public exportState(): { version: 1; schemas: TableSchema[]; tables: Record<string, Row[]> } {
    const tables: Record<string, Row[]> = {};
    const schemas = this.getAllSchemas();
    for (const schema of schemas) {
      const result = this.executeSingle(`SELECT * FROM ${schema.name};`);
      tables[schema.name] = result.success && result.rows ? result.rows.map((row) => ({ ...row })) : [];
    }
    return { version: 1, schemas, tables };
  }

  public restoreState(snapshot: { version?: number; schemas?: TableSchema[]; tables?: Record<string, Row[]> }): void {
    if (snapshot.version !== 1 || !Array.isArray(snapshot.schemas) || !snapshot.tables) {
      throw new Error('Unsupported ApexDB snapshot format');
    }
    this.reset();
    for (const schema of snapshot.schemas) {
      const columns = schema.columns.map((column) => {
        let ddl = `${column.name} ${column.type}`;
        if (column.name === schema.primaryKey) ddl += ' PRIMARY KEY';
        if (column.autoIncrement) ddl += ' AUTO_INCREMENT';
        if (!column.nullable && column.name !== schema.primaryKey) ddl += ' NOT NULL';
        if (column.unique) ddl += ' UNIQUE';
        return ddl;
      });
      const result = this.executeSingle(`CREATE TABLE ${schema.name} (${columns.join(', ')});`);
      if (!result.success) throw new Error(result.error || `Could not restore table '${schema.name}'`);

      for (const indexColumn of schema.indexes) {
        if (indexColumn !== schema.primaryKey) {
          const indexResult = this.executeSingle(`CREATE INDEX idx_${schema.name}_${indexColumn} ON ${schema.name} (${indexColumn});`);
          if (!indexResult.success) throw new Error(indexResult.error || 'Could not restore index');
        }
      }
      for (const row of snapshot.tables[schema.name] || []) {
        const names = schema.columns.map((column) => column.name).filter((name) => row[name] !== undefined);
        const values = names.map((name) => this.toSqlLiteral(row[name]));
        const result = this.executeSingle(`INSERT INTO ${schema.name} (${names.join(', ')}) VALUES (${values.join(', ')});`);
        if (!result.success) throw new Error(result.error || `Could not restore row in '${schema.name}'`);
      }
    }
  }

  public loadFromJSON(serialized: string): void {
    this.restoreState(JSON.parse(serialized));
  }
}
