import {
  app,
  colors,
  leading,
  radius,
  shadow,
  space,
  tracking,
  typeScale,
  weight
} from '@doan-labs/duo-uikit/tokens.stylex.ts'
import * as stylex from '@stylexjs/stylex'

export const styles = stylex.create({
  center: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
    padding: space.lg,
    backgroundColor: app.bg
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: space.md,
    maxWidth: 360,
    padding: space.xl,
    textAlign: 'center',
    borderRadius: radius.xl,
    backgroundColor: app.surface
  },
  title: {
    fontSize: typeScale.title3,
    lineHeight: leading.title3,
    letterSpacing: tracking.title3,
    fontWeight: weight.semibold,
    color: app.fg
  },
  line: { color: app.label2 },
  error: { color: colors.red, textAlign: 'center' },
  page: { display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: app.bg, minHeight: 0 },
  bar: {
    display: 'flex',
    alignItems: 'center',
    gap: space.sm,
    paddingTop: space.sm,
    paddingRight: space.md,
    paddingBottom: space.sm,
    paddingLeft: space.md
  },
  barTitle: {
    flexGrow: 1,
    fontSize: typeScale.headline,
    lineHeight: leading.headline,
    letterSpacing: tracking.headline,
    fontWeight: weight.semibold,
    color: app.fg
  },
  stage: {
    position: 'relative',
    display: 'flex',
    flexGrow: 1,
    flexBasis: 0,
    justifyContent: 'center',
    minHeight: 0
  },
  // Android turns sideways when a game asks, so the canvas fills the room and the picture keeps its own shape in it.
  screen: {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    borderRadius: radius.xl,
    backgroundColor: colors.black,
    boxShadow: shadow.card,
    touchAction: 'none'
  },
  list: {
    position: 'absolute',
    top: 0,
    right: space.md,
    left: space.md,
    maxHeight: '100%',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: space.xs,
    padding: space.sm,
    borderRadius: radius.xl,
    backgroundColor: app.surface,
    boxShadow: shadow.float
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: space.sm,
    paddingTop: space.sm,
    paddingRight: space.md,
    paddingBottom: space.sm,
    paddingLeft: space.md,
    borderWidth: 0,
    borderRadius: radius.lg,
    backgroundColor: { default: 'transparent', ':hover': app.fill3 },
    color: app.fg,
    textAlign: 'left',
    cursor: 'pointer'
  },
  itemName: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 },
  nav: {
    display: 'flex',
    alignItems: 'center',
    gap: space.sm,
    paddingTop: space.sm,
    paddingRight: space.md,
    paddingBottom: space.md,
    paddingLeft: space.md
  },
  navButton: {
    width: space.xxxl,
    height: space.xxxl,
    flexShrink: 0,
    borderWidth: 0,
    borderRadius: radius.circle,
    backgroundColor: { default: app.fill3, ':hover': app.fill2 },
    color: app.fg,
    fontSize: typeScale.headline,
    lineHeight: 1,
    cursor: 'pointer'
  },
  type: {
    flexGrow: 1,
    minWidth: 0,
    paddingTop: space.sm,
    paddingRight: space.md,
    paddingBottom: space.sm,
    paddingLeft: space.md,
    borderWidth: 0,
    borderRadius: radius.pill,
    backgroundColor: app.fill3,
    color: app.fg,
    fontSize: typeScale.subheadline,
    lineHeight: leading.subheadline,
    letterSpacing: tracking.subheadline
  },
  note: { paddingRight: space.md, paddingBottom: space.sm, paddingLeft: space.md, color: app.label2 }
})
