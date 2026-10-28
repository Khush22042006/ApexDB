/**
 * ApexDB AI Agent Sandbox & Query Risk Safety Guardrails
 *
 * Enforces production safety for autonomous AI agents:
 * 1. Analyzes incoming queries for catastrophic risk (DROP, bulk unconstrained DELETE/UPDATE).
 * 2. Isolates agent operations inside sandboxed Copy-on-Write branches.
 * 3. Human Approval Workflow for dangerous mutations.
 */

import { DangerousQueryWarning, PendingApprovalAction, RiskLevel } from '../types.ts';
import { SQLStatement } from '../sql/AST.ts';

export class AgentSandbox {
  private pendingApprovals: Map<string, PendingApprovalAction> = new Map();
  public requireHumanApprovalForDangerous: boolean = true;

  constructor() {
    this.reset();
  }

  public reset(): void {
    this.pendingApprovals.clear();
  }

  /**
   * Assesses risk level of a parsed SQL statement
   */
  public analyzeRisk(stmt: SQLStatement, sqlRaw: string, tableRowCount: number = 0): DangerousQueryWarning {
    const reasons: string[] = [];
    let level: RiskLevel = 'LOW';
    let requiresApproval = false;
    let affectedRows = 0;

    switch (stmt.type) {
      case 'DROP_TABLE':
        level = 'CRITICAL';
        requiresApproval = true;
        reasons.push(`Irreversible deletion of table '${stmt.tableName}' and all associated index metadata.`);
        affectedRows = tableRowCount;
        break;

      case 'DELETE':
        if (!stmt.where) {
          level = 'CRITICAL';
          requiresApproval = true;
          reasons.push(`Unconstrained DELETE with NO WHERE clause: would wipe all ${tableRowCount} rows from '${stmt.tableName}'.`);
          affectedRows = tableRowCount;
        } else {
          level = 'MEDIUM';
          affectedRows = Math.min(tableRowCount, 5);
        }
        break;

      case 'UPDATE':
        if (!stmt.where) {
          level = 'HIGH';
          requiresApproval = true;
          reasons.push(`Unconstrained UPDATE with NO WHERE clause: will overwrite all ${tableRowCount} rows in '${stmt.tableName}'.`);
          affectedRows = tableRowCount;
        } else {
          level = 'LOW';
          affectedRows = 1;
        }
        break;

      case 'CREATE_TABLE':
      case 'CREATE_INDEX':
        level = 'MEDIUM';
        reasons.push(`Schema DDL alteration: creates new catalog object.`);
        break;

      case 'SELECT':
      default:
        level = 'LOW';
        break;
    }

    return {
      level,
      reasons,
      requiresApproval: this.requireHumanApprovalForDangerous && requiresApproval,
      affectedEstimatedRows: affectedRows,
    };
  }

  /**
   * Creates a pending approval ticket for dangerous agent action
   */
  public enqueueApproval(params: {
    agentId: string;
    branch: string;
    sql: string;
    risk: DangerousQueryWarning;
  }): PendingApprovalAction {
    const id = `req_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const action: PendingApprovalAction = {
      id,
      agentId: params.agentId,
      branch: params.branch,
      sql: params.sql,
      risk: params.risk,
      timestamp: Date.now(),
      status: 'PENDING',
    };
    this.pendingApprovals.set(id, action);
    return action;
  }

  public approve(id: string): PendingApprovalAction | null {
    const action = this.pendingApprovals.get(id);
    if (!action) return null;
    action.status = 'APPROVED';
    return action;
  }

  public reject(id: string): PendingApprovalAction | null {
    const action = this.pendingApprovals.get(id);
    if (!action) return null;
    action.status = 'REJECTED';
    return action;
  }

  public getPendingList(): PendingApprovalAction[] {
    return Array.from(this.pendingApprovals.values()).filter((a) => a.status === 'PENDING');
  }

  public getAllApprovals(): PendingApprovalAction[] {
    return Array.from(this.pendingApprovals.values());
  }
}
