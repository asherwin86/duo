import type { Os } from '@doan-labs/duo-sdk'
import { Placeholder, Row, Text } from '@doan-labs/duo-uikit'
import { Nav, Page, useNav } from '@doan-labs/duo-uikit/nav.tsx'
import { shared } from '@doan-labs/duo-uikit/styles.ts'
import * as stylex from '@stylexjs/stylex'
import { useEffect, useSyncExternalStore } from 'react'
import { downloads, fileKind, megabytes, saveToComputer } from './downloads.ts'
import { styles } from './styles.ts'

/** name, emoji, children — a leaf is a file, anything with children is a folder. */
type Node_ = { n: string; i: string; kids?: Node_[]; size?: string; real?: { type: string; at: number; bytes: number } }
/** What Downloads holds: the files Safari saved, then the one that was always there. */
const downloadKids = (saved: Parameters<typeof file>[0][]): Node_[] => [
  ...saved.map(file),
  { n: 'iPhone_Duo.usdz', i: '🧊', size: '8.1 MB' }
]
const tree = (kept: Node_[]): Node_[] => [
  {
    n: 'iCloud Drive',
    i: '☁️',
    kids: [
      {
        n: 'Freeform',
        i: '📁',
        kids: [
          { n: 'Hinge sketch', i: '🖼', size: '1.2 MB' },
          { n: 'Rail chamfer', i: '🖼', size: '840 KB' }
        ]
      },
      { n: 'Keynote', i: '📁', kids: [{ n: 'Duo launch.key', i: '📊', size: '48.3 MB' }] },
      {
        n: 'Screens',
        i: '📁',
        kids: [
          { n: 'inner@2x.png', i: '🖼', size: '2.1 MB' },
          { n: 'outer@2x.png', i: '🖼', size: '1.4 MB' }
        ]
      },
      { n: 'Specs.pdf', i: '📕', size: '312 KB' }
    ]
  },
  {
    n: 'On My iPhone',
    i: '📱',
    kids: [
      { n: 'Voice Memos', i: '📁', kids: [{ n: 'Recording 1.m4a', i: '🎙', size: '2.8 MB' }] },
      { n: 'Downloads', i: '📁', kids: kept }
    ]
  },
  { n: 'Recently Deleted', i: '🗑', kids: [] }
]

/** A folder as an icon grid, or a file as its emoji and size. */
const Node = ({ node, back, os }: { node: Node_; back: () => void; os: Os }) => {
  const { push } = useNav()
  // The Downloads folder reads the live list, so a file saved or deleted elsewhere shows at once.
  const live = useSyncExternalStore(downloads.subscribe, downloads.get)
  const kids = node.n === 'Downloads' ? downloadKids(live) : (node.kids ?? [])
  if (node.real)
    return (
      <Page title={node.n} back={back}>
        <Placeholder>
          <div {...stylex.props(styles.bigIcon)}>{node.i}</div>
          {node.size}
          <Text size="caption" xstyle={[styles.note]}>
            {`${fileKind(node.n)}. No app on this iPhone can open it.`}
          </Text>
        </Placeholder>
        <div {...stylex.props(styles.actions)}>
          <Row
            onClick={() =>
              void os.downloads?.get(node.n).then((blob) => {
                if (blob) saveToComputer(blob, node.n)
              })
            }
          >
            Save to Computer
          </Row>
          <Row
            onClick={() => {
              void os.downloads?.del(node.n).then(() => downloads.refresh(os))
              back()
            }}
          >
            Delete
          </Row>
        </div>
      </Page>
    )
  return (
    <Page title={node.n} back={back}>
      {kids.length ? (
        <div {...stylex.props(styles.dz)}>
          {kids.map((k) => (
            <div key={k.n} {...stylex.props(styles.f)} onClick={() => push((b) => <Node node={k} back={b} os={os} />)}>
              <i {...stylex.props(styles.fIcon)}>{k.i}</i>
              <span>{k.n}</span>
              {k.size && (
                <Text size="caption" xstyle={[styles.size]}>
                  {k.size}
                </Text>
              )}
            </div>
          ))}
        </div>
      ) : (
        <Placeholder>
          {node.size ? <div {...stylex.props(styles.bigIcon)}>{node.i}</div> : ''}
          {node.size ?? 'Empty'}
        </Placeholder>
      )}
      {kids.length ? (
        <Text
          as="div"
          size="caption"
          xstyle={[styles.count]}
        >{`${kids.length} item${kids.length > 1 ? 's' : ''}`}</Text>
      ) : null}
    </Page>
  )
}

const Browse = ({ os }: { os: Os }) => {
  const { push } = useNav()
  const live = useSyncExternalStore(downloads.subscribe, downloads.get)
  const FILES = tree(downloadKids(live))
  return (
    <Page title="Browse">
      <div {...stylex.props(styles.sec)}>LOCATIONS</div>
      {FILES.map((f) => (
        <Row key={f.n} onClick={() => push((b) => <Node node={f} back={b} os={os} />)}>
          <span {...stylex.props(styles.locIcon)}>{f.i}</span>
          {f.n}
          <span {...stylex.props(shared.rowR)}>›</span>
        </Row>
      ))}
    </Page>
  )
}

/** A saved download as a tree leaf: its name, an icon for its kind and its real size. */
const file = (f: { name: string; size: number; type: string; at: number }): Node_ => ({
  n: f.name,
  i: fileKind(f.name) === 'iOS app' ? '📱' : '🤖',
  size: megabytes(f.size),
  real: { type: f.type, at: f.at, bytes: f.size }
})

export const Files = ({ os }: { os: Os }) => {
  // The live display keeps the list fresh; the mirror only draws what it is given.
  useEffect(() => {
    void downloads.refresh(os)
    if (os.mirror) return
    const id = setInterval(() => void downloads.refresh(os), 3000)
    return () => clearInterval(id)
  }, [os])
  return (
    <Nav>
      <Browse os={os} />
    </Nav>
  )
}
