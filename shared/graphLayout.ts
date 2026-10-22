export interface GraphEdgeInput {
  id: string
  isElided: boolean
}

export interface GraphNodeInput {
  id: string
  parents: GraphEdgeInput[]
}

export interface LaneSegment {
  column: number
  isElided: boolean
}

export interface IncomingEdge {
  fromColumn: number
}

export interface OutgoingEdge {
  toColumn: number
  isElided: boolean
}

export interface GraphRow {
  id: string
  column: number
  width: number
  incoming: IncomingEdge[]
  outgoing: OutgoingEdge[]
  passThrough: LaneSegment[]
}

type Lane = { target: string; isElided: boolean } | null

function firstFree(lanes: readonly Lane[], from = 0): number {
  for (let i = from; i < lanes.length; i++) {
    if (lanes[i] === null) {
      return i
    }
  }
  return lanes.length
}

function withLane(lanes: readonly Lane[], index: number, lane: Lane): Lane[] {
  const next = [...lanes]
  while (next.length <= index) {
    next.push(null)
  }
  next[index] = lane
  return next
}

function trimTrailing(lanes: readonly Lane[]): Lane[] {
  let end = lanes.length
  while (end > 0 && lanes[end - 1] === null) {
    end--
  }
  return lanes.slice(0, end)
}

export function layoutGraph(nodes: readonly GraphNodeInput[]): GraphRow[] {
  let lanes: Lane[] = []
  const rows: GraphRow[] = []

  for (const node of nodes) {
    const matching = lanes.flatMap((lane, i) => (lane?.target === node.id ? [i] : []))
    const column = matching[0] ?? firstFree(lanes)
    const passThrough = lanes.flatMap((lane, i) =>
      lane !== null && !matching.includes(i) ? [{ column: i, isElided: lane.isElided }] : [],
    )
    lanes = lanes.map((lane, i) => (matching.includes(i) ? null : lane))

    const outgoing: OutgoingEdge[] = []
    node.parents.forEach((parent, index) => {
      const existing = lanes.findIndex((lane) => lane?.target === parent.id)
      if (existing >= 0) {
        outgoing.push({ toColumn: existing, isElided: parent.isElided })
        return
      }
      const slot = index === 0 && (lanes[column] ?? null) === null ? column : firstFree(lanes, column)
      lanes = withLane(lanes, slot, { target: parent.id, isElided: parent.isElided })
      outgoing.push({ toColumn: slot, isElided: parent.isElided })
    })

    const usedColumns = [
      column,
      ...matching,
      ...passThrough.map((p) => p.column),
      ...outgoing.map((o) => o.toColumn),
    ]
    rows.push({
      id: node.id,
      column,
      width: Math.max(...usedColumns) + 1,
      incoming: matching.map((fromColumn) => ({ fromColumn })),
      outgoing,
      passThrough,
    })
    lanes = trimTrailing(lanes)
  }
  return rows
}
