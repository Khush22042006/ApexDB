/**
 * ApexDB Enterprise Engine - Type Definitions and Core Constants
 * Includes Slotted Storage, Buffer Pool, MVCC, B+ Tree, Vector Search,
 * Branching (Git-like), Autonomous Optimization, and Agent Safety.
 */

export type DataType = 'INTEGER' | 'FLOAT' | 'TEXT' | 'BOOLEAN' | 'VECTOR';

export type Value = number | string | boolean | number[] | null | undefined;

export interface ColumnDefinition {
  name: string;
  type: DataType;
  primaryKey?: boolean;
  autoIncrement?: boolean;
  nullable?: boolean;
  unique?: boolean;
  defaultValue?: Value;
  checkExpr?: string; // e.g. "age >= 18"
  vectorDimensions?: number; // for VECTOR type
}

export interface TableSchema {
  name: string;
  columns: ColumnDefinition[];
  primaryKey: string;
  indexes: string[]; // column names that have B+ tree indexes
  vectorIndexes: string[]; // column names that have Vector cosine indexes
  rootPageId: number;
  indexRootPages: Record<string, number>;
  rowCount: number;
}

export interface RecordId {
  pageId: number;
  slotIndex: number;
}

// MVCC Tuple Header
export interface Row {
  [colName: string]: Value;
  _xmin?: number; // Txn that created this version
  _xmax?: number; // Txn that deleted/superseded this version (0 if active)
  _cid?: number;  // Command ID within transaction
  _versionId?: string; // Unique version identifier
  _timestamp?: number; // Epoch ms when created
}

export const PAGE_SIZE = 4096;
export const PAGE_HEADER_SIZE = 36; // 32B base + 4B checksum

export enum PageType {
  HEAP_PAGE = 0,
  BPLUS_INTERNAL = 1,
  BPLUS_LEAF = 2,
  OVERFLOW_PAGE = 3,
  VECTOR_PAGE = 4,
}

export interface PageHeader {
  pageId: number;
  pageType: PageType;
  slotCount: number;
  freeSpaceLower: number;
  freeSpaceUpper: number;
  pageLsn: number;
  nextPageId: number;
  prevPageId: number;
  checksum: number; // Adler-32 checksum for corruption detection
}

export interface Slot {
  offset: number;
  length: number;
  isDeleted: boolean;
}

export interface BufferFrame {
  frameId: number;
  pageId: number | null;
  pinCount: number;
  isDirty: boolean;
  pageLsn: number;
  data: Uint8Array;
  lastAccessed: number;
  referenceBit: boolean;
  isCorrupted?: boolean;
}

export enum WalRecordType {
  BEGIN = 'BEGIN',
  INSERT = 'INSERT',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  COMMIT = 'COMMIT',
  ABORT = 'ABORT',
  CHECKPOINT = 'CHECKPOINT',
  BRANCH_CREATE = 'BRANCH_CREATE',
  BRANCH_MERGE = 'BRANCH_MERGE',
  CORRUPTION_DETECTED = 'CORRUPTION_DETECTED',
}

export interface WalRecord {
  lsn: number;
  prevLsn: number;
  txnId: number;
  type: WalRecordType;
  tableName?: string;
  pageId?: number;
  slotIndex?: number;
  beforeRow?: Row | null;
  afterRow?: Row | null;
  timestamp: number;
  branch?: string;
}

export interface QueryPlanNode {
  nodeType:
    | 'SeqScan'
    | 'IndexScan'
    | 'VectorScan'
    | 'LearnedScan'
    | 'Filter'
    | 'Project'
    | 'Sort'
    | 'Limit'
    | 'HashJoin'
    | 'NestedLoopJoin'
    | 'MaterializedCacheHit';
  details: string;
  estimatedCost: number;
  estimatedRows?: number;
  actualRows?: number;
  actualTimeMs?: number;
  bufferHits?: number;
  diskReads?: number;
  children?: QueryPlanNode[];
  whyNotReasons?: { rowId: string | number; reason: string }[];
}

export interface QueryResult {
  statement: string;
  success: boolean;
  columns?: string[];
  rows?: Row[];
  affectedRows?: number;
  executionTimeMs: number;
  error?: string;
  queryPlan?: QueryPlanNode;
  cacheHit?: boolean;
  provenanceWhy?: string[];
  branch?: string;
  metrics: {
    diskReads: number;
    diskWrites: number;
    bufferHits: number;
    bufferMisses: number;
    walRecordsLogged: number;
    costEstimate?: number;
  };
}

// Git-like Database Branching
export interface BranchInfo {
  name: string;
  parentBranch: string | null;
  createdLsn: number;
  createdTimestamp: number;
  headLsn: number;
  activeTxnId: number | null;
  description: string;
}

export interface BranchDiffRow {
  tableName: string;
  action: 'ADDED' | 'MODIFIED' | 'DELETED';
  primaryKey: Value;
  baseRow?: Row;
  targetRow?: Row;
}

export interface BranchMergeResult {
  success: boolean;
  sourceBranch: string;
  targetBranch: string;
  appliedChanges: number;
  conflicts: { tableName: string; primaryKey: Value; message: string }[];
  mergeLsn: number;
}

// Autonomous Index Optimization
export interface WorkloadStat {
  queryHash: string;
  sqlPattern: string;
  frequency: number;
  avgDurationMs: number;
  maxDurationMs: number;
  targetTable: string;
  filterColumns: string[];
  joinColumns: string[];
  lastSeen: number;
}

export interface IndexRecommendation {
  id: string;
  tableName: string;
  columnName: string;
  reason: string;
  estimatedSpeedup: string;
  status: 'PENDING_SHADOW_TEST' | 'SHADOW_TESTING' | 'PROMOTED_LIVE' | 'REJECTED';
  shadowSpeedupResult?: string;
  shadowTestDurationMs?: number;
}

// AI Agent Safety & Risk Detection
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface DangerousQueryWarning {
  level: RiskLevel;
  reasons: string[];
  requiresApproval: boolean;
  affectedEstimatedRows: number;
}

export interface PendingApprovalAction {
  id: string;
  agentId: string;
  branch: string;
  sql: string;
  risk: DangerousQueryWarning;
  timestamp: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
}
