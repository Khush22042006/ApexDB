/**
 * ApexDB B+ Tree Index Engine
 *
 * Implements a balanced B+ Tree data structure for database primary & secondary indexing:
 * - Internal nodes store routing keys and child node references
 * - Leaf nodes store keys and RecordIds (pageId, slotIndex)
 * - Leaf nodes form a doubly-linked list for O(K) range scans
 * - Dynamic node splitting and root elevation
 */

import { RecordId } from '../types.ts';

export type BPlusKey = number | string;

export interface BPlusNodeVisual {
  id: string;
  isLeaf: boolean;
  keys: BPlusKey[];
  children?: BPlusNodeVisual[];
  records?: RecordId[];
  nextLeafId?: string | null;
  prevLeafId?: string | null;
  depth: number;
}

export class BPlusTreeNode {
  public id: string;
  public isLeaf: boolean;
  public keys: BPlusKey[] = [];
  public children: BPlusTreeNode[] = []; // for internal nodes
  public records: RecordId[] = []; // for leaf nodes
  public parent: BPlusTreeNode | null = null;
  public nextLeaf: BPlusTreeNode | null = null;
  public prevLeaf: BPlusTreeNode | null = null;

  constructor(isLeaf: boolean, id?: string) {
    this.isLeaf = isLeaf;
    this.id = id || Math.random().toString(36).substring(2, 8);
  }
}

export class BPlusTree {
  public root: BPlusTreeNode;
  public order: number; // Max children for internal node, max keys = order - 1
  private nodeCounter: number = 0;

  constructor(order: number = 4) {
    this.order = Math.max(3, order);
    this.root = this.createNode(true);
  }

  private createNode(isLeaf: boolean): BPlusTreeNode {
    const node = new BPlusTreeNode(isLeaf, `n${++this.nodeCounter}`);
    return node;
  }

  public clear(): void {
    this.nodeCounter = 0;
    this.root = this.createNode(true);
    this.root = this.createNode(true);
  }

  public setOrder(newOrder: number): void {
    const all = this.getAllEntries();
    this.order = Math.max(3, newOrder);
    this.clear();
    for (const item of all) {
      this.insert(item.key, item.rid);
    }
    this.clear();
    for (const item of all) {
      this.insert(item.key, item.rid);
    }
  }

  private compareKeys(a: BPlusKey, b: BPlusKey): number {
    if (typeof a === 'number' && typeof b === 'number') {
      return a - b;
    }
    const strA = String(a);
    const strB = String(b);
    return strA.localeCompare(strB);
  }

  /**
   * Search for a single key. Returns the RecordId and the search path followed.
   */
  public search(key: BPlusKey): {
    found: boolean;
    rid: RecordId | null;
    path: { nodeId: string; isLeaf: boolean; keys: BPlusKey[] }[];
    comparisons: number;
  } {
    let current = this.root;
    const path: { nodeId: string; isLeaf: boolean; keys: BPlusKey[] }[] = [];
    let comparisons = 0;

    while (!current.isLeaf) {
      path.push({
        nodeId: current.id,
        isLeaf: false,
        keys: [...current.keys],
      });

      let childIdx = 0;
      while (childIdx < current.keys.length) {
        comparisons++;
        if (this.compareKeys(key, current.keys[childIdx]) < 0) {
          break;
        }
        childIdx++;
      }
      current = current.children[childIdx];
    }

    // Now at leaf node
    path.push({
      nodeId: current.id,
      isLeaf: true,
      keys: [...current.keys],
    });

    for (let i = 0; i < current.keys.length; i++) {
      comparisons++;
      if (this.compareKeys(key, current.keys[i]) === 0) {
        return {
          found: true,
          rid: current.records[i],
          path,
          comparisons,
        };
      }
    }

    return {
      found: false,
      rid: null,
      path,
      comparisons,
    };
  }

  /**
   * Range search: walks to min key in O(log N), then follows nextLeaf pointers.
   */
  public rangeSearch(
    minKey: BPlusKey | null,
    maxKey: BPlusKey | null
  ): {
    results: { key: BPlusKey; rid: RecordId }[];
    leavesVisited: number;
    comparisons: number;
  } {
    const results: { key: BPlusKey; rid: RecordId }[] = [];
    let comparisons = 0;
    let leavesVisited = 0;

    // Find the starting leaf node
    let current = this.root;
    while (!current.isLeaf) {
      let childIdx = 0;
      if (minKey !== null) {
        while (childIdx < current.keys.length) {
          comparisons++;
          if (this.compareKeys(minKey, current.keys[childIdx]) <= 0) {
            break;
          }
          childIdx++;
        }
      }
      current = current.children[childIdx];
    }

    // Traverse the leaf linked list
    let leaf: BPlusTreeNode | null = current;
    while (leaf !== null) {
      leavesVisited++;
      for (let i = 0; i < leaf.keys.length; i++) {
        const k = leaf.keys[i];
        comparisons++;

        const satisfiesMin = minKey === null || this.compareKeys(k, minKey) >= 0;
        const satisfiesMax = maxKey === null || this.compareKeys(k, maxKey) <= 0;

        if (satisfiesMin && satisfiesMax) {
          results.push({ key: k, rid: leaf.records[i] });
        } else if (maxKey !== null && this.compareKeys(k, maxKey) > 0) {
          return { results, leavesVisited, comparisons };
        }
      }
      leaf = leaf.nextLeaf;
    }

    return { results, leavesVisited, comparisons };
  }

  /**
   * Insert a key and its RecordId into the B+ Tree.
   */
  public insert(key: BPlusKey, rid: RecordId): void {
    let current = this.root;

    // Traverse to target leaf
    while (!current.isLeaf) {
      let idx = 0;
      while (idx < current.keys.length && this.compareKeys(key, current.keys[idx]) >= 0) {
        idx++;
      }
      current = current.children[idx];
    }

    // Insert key and rid into leaf in sorted order
    let insertIdx = 0;
    while (insertIdx < current.keys.length && this.compareKeys(key, current.keys[insertIdx]) >= 0) {
      insertIdx++;
    }

    current.keys.splice(insertIdx, 0, key);
    current.records.splice(insertIdx, 0, rid);

    // If leaf overflows (keys >= order)
    if (current.keys.length >= this.order) {
      this.splitLeaf(current);
    }
  }

  private splitLeaf(leaf: BPlusTreeNode): void {
    const mid = Math.ceil(leaf.keys.length / 2);
    const newLeaf = this.createNode(true);
    newLeaf.parent = leaf.parent;

    // Distribute keys and records
    newLeaf.keys = leaf.keys.splice(mid);
    newLeaf.records = leaf.records.splice(mid);

    // Update leaf linked list
    newLeaf.nextLeaf = leaf.nextLeaf;
    newLeaf.prevLeaf = leaf;
    if (leaf.nextLeaf) {
      leaf.nextLeaf.prevLeaf = newLeaf;
    }
    leaf.nextLeaf = newLeaf;

    const promotedKey = newLeaf.keys[0];

    if (leaf === this.root) {
      const newRoot = this.createNode(false);
      newRoot.keys = [promotedKey];
      newRoot.children = [leaf, newLeaf];
      leaf.parent = newRoot;
      newLeaf.parent = newRoot;
      this.root = newRoot;
    } else {
      this.insertIntoParent(leaf, promotedKey, newLeaf);
    }
  }

  private insertIntoParent(left: BPlusTreeNode, key: BPlusKey, right: BPlusTreeNode): void {
    const parent = left.parent!;
    let insertIdx = 0;
    while (insertIdx < parent.keys.length && this.compareKeys(key, parent.keys[insertIdx]) > 0) {
      insertIdx++;
    }

    parent.keys.splice(insertIdx, 0, key);
    parent.children.splice(insertIdx + 1, 0, right);
    right.parent = parent;

    // Check if internal node overflows (children > order, or keys >= order)
    if (parent.keys.length >= this.order) {
      this.splitInternal(parent);
    }
  }

  private splitInternal(node: BPlusTreeNode): void {
    const mid = Math.floor(node.keys.length / 2);
    const promotedKey = node.keys[mid];

    const newNode = this.createNode(false);
    newNode.parent = node.parent;

    // Right child keys are strictly after mid
    newNode.keys = node.keys.splice(mid + 1);
    // Remove the promoted key from left node
    node.keys.splice(mid, 1);

    // Distribute children
    newNode.children = node.children.splice(mid + 1);
    for (const child of newNode.children) {
      child.parent = newNode;
    }

    if (node === this.root) {
      const newRoot = this.createNode(false);
      newRoot.keys = [promotedKey];
      newRoot.children = [node, newNode];
      node.parent = newRoot;
      newNode.parent = newRoot;
      this.root = newRoot;
    } else {
      this.insertIntoParent(node, promotedKey, newNode);
    }
  }

  /**
   * Delete a key from the B+ Tree.
   */
  public delete(key: BPlusKey): boolean {
    let current = this.root;
    while (!current.isLeaf) {
      let idx = 0;
      while (idx < current.keys.length && this.compareKeys(key, current.keys[idx]) >= 0) {
        idx++;
      }
      current = current.children[idx];
    }

    const idx = current.keys.findIndex((k) => this.compareKeys(k, key) === 0);
    if (idx === -1) return false;

    current.keys.splice(idx, 1);
    current.records.splice(idx, 1);

    // If root became empty leaf, it's fine
    if (current === this.root) {
      return true;
    }

    // Simplification for visualization: ensure underflow rebalancing or leaf cleanup
    return true;
  }

  public getAllEntries(): { key: BPlusKey; rid: RecordId }[] {
    const entries: { key: BPlusKey; rid: RecordId }[] = [];
    let current: BPlusTreeNode | null = this.root;
    while (current && !current.isLeaf) {
      current = current.children[0] || null;
    }

    while (current) {
      for (let i = 0; i < current.keys.length; i++) {
        entries.push({ key: current.keys[i], rid: current.records[i] });
      }
      current = current.nextLeaf;
    }
    return entries;
  }

  public getHeight(): number {
    let h = 1;
    let node = this.root;
    while (!node.isLeaf && node.children.length > 0) {
      h++;
      node = node.children[0];
    }
    return h;
  }

  /**
   * Serializes the B+ Tree into a visual tree hierarchy for SVG rendering.
   */
  public exportVisualTree(): BPlusNodeVisual {
    const serializeNode = (node: BPlusTreeNode, depth: number): BPlusNodeVisual => {
      const visual: BPlusNodeVisual = {
        id: node.id,
        isLeaf: node.isLeaf,
        keys: [...node.keys],
        depth,
      };

      if (node.isLeaf) {
        visual.records = [...node.records];
        visual.nextLeafId = node.nextLeaf ? node.nextLeaf.id : null;
        visual.prevLeafId = node.prevLeaf ? node.prevLeaf.id : null;
      } else {
        visual.children = node.children.map((child) => serializeNode(child, depth + 1));
      }

      return visual;
    };

    return serializeNode(this.root, 0);
  }
}
