import type { CommitView } from '../../../shared/protocol'

export const LANE_WIDTH = 14
export const HEAD_HEIGHT = 24
const NODE_Y = HEAD_HEIGHT / 2
const NODE_RADIUS = 4.5

const laneX = (column: number) => column * LANE_WIDTH + LANE_WIDTH / 2

function nodeKind(commit: CommitView): string {
  if (commit.isWorkingCopy) {
    return 'node-wc'
  }
  if (commit.hasConflict) {
    return 'node-conflict'
  }
  if (commit.isImmutable) {
    return 'node-immutable'
  }
  if (commit.isHidden || commit.isDivergent) {
    return 'node-odd'
  }
  return commit.isEmpty ? 'node-empty' : 'node-mutable'
}

function Node({ commit, x }: { commit: CommitView; x: number }) {
  const kind = nodeKind(commit)
  const mineClass = commit.isMine ? '' : ' node-other'
  if (kind === 'node-immutable') {
    const s = NODE_RADIUS
    return (
      <path
        className={`node ${kind}${mineClass}`}
        d={`M ${x} ${NODE_Y - s - 0.5} L ${x + s + 0.5} ${NODE_Y} L ${x} ${NODE_Y + s + 0.5} L ${x - s - 0.5} ${NODE_Y} Z`}
      />
    )
  }
  if (kind === 'node-conflict') {
    const s = NODE_RADIUS - 1
    return (
      <g className={`node ${kind}`}>
        <circle cx={x} cy={NODE_Y} r={NODE_RADIUS + 0.5} />
        <path
          d={`M ${x - s} ${NODE_Y - s} L ${x + s} ${NODE_Y + s} M ${x + s} ${NODE_Y - s} L ${x - s} ${NODE_Y + s}`}
        />
      </g>
    )
  }
  if (kind === 'node-wc') {
    return (
      <g className={`node ${kind}`}>
        <circle className="halo" cx={x} cy={NODE_Y} r={NODE_RADIUS + 2.5} />
        <circle cx={x} cy={NODE_Y} r={NODE_RADIUS} />
      </g>
    )
  }
  return <circle className={`node ${kind}${mineClass}`} cx={x} cy={NODE_Y} r={NODE_RADIUS} />
}

interface GraphCellProps {
  commit: CommitView
  lanes: number
}

export function GraphCell({ commit, lanes }: GraphCellProps) {
  const { row } = commit
  const x = laneX(row.column)
  const width = lanes * LANE_WIDTH
  return (
    <div className="graph-cell" style={{ width }} aria-hidden="true">
      <svg width={width} height="100%">
        {row.passThrough.map((lane) => (
          <line
            key={`p${lane.column}`}
            className={lane.isElided ? 'edge elided' : 'edge'}
            x1={laneX(lane.column)}
            x2={laneX(lane.column)}
            y1={0}
            y2="100%"
          />
        ))}
        {row.incoming.map((edge) => {
          const from = laneX(edge.fromColumn)
          const d =
            from === x
              ? `M ${x} 0 L ${x} ${NODE_Y}`
              : `M ${from} 0 C ${from} ${NODE_Y} ${x} 0 ${x} ${NODE_Y}`
          return <path key={`i${edge.fromColumn}`} className="edge" d={d} />
        })}
        {row.outgoing.map((edge) => {
          const to = laneX(edge.toColumn)
          const className = edge.isElided ? 'edge elided' : 'edge'
          const curve =
            to === x
              ? `M ${x} ${NODE_Y} L ${x} ${HEAD_HEIGHT}`
              : `M ${x} ${NODE_Y} C ${x} ${HEAD_HEIGHT} ${to} ${NODE_Y} ${to} ${HEAD_HEIGHT}`
          return (
            <g key={`o${edge.toColumn}`}>
              <path className={className} d={curve} />
              <line className={className} x1={to} x2={to} y1={HEAD_HEIGHT} y2="100%" />
            </g>
          )
        })}
        <Node commit={commit} x={x} />
      </svg>
    </div>
  )
}
