/**
 * ApexDB Query X-Ray & Data Provenance (EXPLAIN WHY / WHY NOT)
 *
 * Implements:
 * 1. Estimated vs. Actual execution statistics profiling.
 * 2. Data Provenance: Explains why rows were selected or rejected by predicates/MVCC.
 */

import { QueryPlanNode, Row } from '../types.ts';
import { Expression } from '../sql/AST.ts';
import { evaluateExpression } from '../query/QueryEngine.ts';

export interface ProvenanceTrace {
  row: Row;
  included: boolean;
  explanation: string;
  failedPredicate?: string;
}

export class QueryXRay {
  /**
   * Generates Estimated vs Actual metrics for a Volcano plan node
   */
  public static enrichPlanNode(
    node: QueryPlanNode,
    actualRows: number,
    durationMs: number,
    bufferHits: number,
    diskReads: number
  ): QueryPlanNode {
    return {
      ...node,
      actualRows,
      actualTimeMs: Math.round(durationMs * 100) / 100,
      bufferHits,
      diskReads,
    };
  }

  /**
   * Evaluates why candidate rows were rejected or included by a WHERE clause
   */
  public static explainWhy(
    candidateRows: Row[],
    predicate?: Expression,
    targetPk?: string | number
  ): ProvenanceTrace[] {
    const traces: ProvenanceTrace[] = [];

    for (const r of candidateRows) {
      const pk = r.id ?? r.order_id ?? Object.values(r)[0];
      if (targetPk !== undefined && String(pk) !== String(targetPk)) {
        continue;
      }

      // Check MVCC visibility first
      if (r._xmax && r._xmax > 0) {
        traces.push({
          row: r,
          included: false,
          explanation: `Omitted by MVCC: Deleted/superseded by transaction #${r._xmax}`,
        });
        continue;
      }

      if (!predicate) {
        traces.push({
          row: r,
          included: true,
          explanation: `Included: No WHERE filter specified; row is active in MVCC snapshot.`,
        });
        continue;
      }

      const passes = evaluateExpression(predicate, r);
      if (Boolean(passes)) {
        traces.push({
          row: r,
          included: true,
          explanation: `Included: Satisfied predicate condition with column values [${Object.entries(r)
            .filter(([k]) => !k.startsWith('_'))
            .map(([k, v]) => `${k}=${v}`)
            .join(', ')}]`,
        });
      } else {
        const failedReason = QueryXRay.identifyFailingSubclause(predicate, r);
        traces.push({
          row: r,
          included: false,
          explanation: `Rejected by predicate: ${failedReason}`,
          failedPredicate: failedReason,
        });
      }
    }

    return traces;
  }

  private static identifyFailingSubclause(expr: Expression, row: Row): string {
    if (expr.type === 'Binary') {
      if (expr.operator === 'AND') {
        const leftPass = Boolean(evaluateExpression(expr.left!, row));
        const rightPass = Boolean(evaluateExpression(expr.right!, row));
        if (!leftPass) return QueryXRay.identifyFailingSubclause(expr.left!, row);
        if (!rightPass) return QueryXRay.identifyFailingSubclause(expr.right!, row);
      }

      const leftVal = evaluateExpression(expr.left!, row);
      const rightVal = evaluateExpression(expr.right!, row);
      const colName = expr.left?.name || 'column';
      return `${colName} (${leftVal}) does not satisfy ${expr.operator} ${rightVal}`;
    }
    return 'Expression evaluated to false';
  }
}
