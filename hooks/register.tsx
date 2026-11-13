import { atom, read, update } from 'claude-code'
import type { CoreEngineInterface, Register, SessionRateLimit } from 'claude-code'

import type { Limit, Place, Snapshot } from '../types'

const snapshot = atom({ plugin: 'usage-band', key: 'snapshot' } as const, null)
const alerted = atom({ plugin: 'usage-band', key: 'alerted' } as const, [])
const place = atom({ plugin: 'usage-band', key: 'place' } as const, null)

const EDITOR_APP = 'Zed'
const PLACE_LABEL = { worktree: '워크트리', main: '메인', folder: '폴더' } as const

const WARN = 70
const CRIT = 90
const BAR_WIDTH = 56
const BAR_HEIGHT = 6
const TERMINAL_CELLS = 8

// SVG는 이미지로 그려져 테마 색을 못 받으므로 라이트·다크 양쪽에서 읽히는 색만 쓴다
const BAR_TRACK = 'rgba(128,128,128,0.28)'
const BAR_FILL = { normal: 'rgba(128,128,128,0.85)', warn: '#d98a12', crit: '#e5484d' } as const

const LABELS: Record<string, string> = { five_hour: '5시간', seven_day: '주간', spend_limit: '지출 한도' }
const ORDER = ['five_hour', 'seven_day']
const DAYS = ['일', '월', '화', '수', '목', '금', '토']

type Level = 'normal' | 'warn' | 'crit'

type Meter = { key: string; label: string; percent: number | undefined; reset: string | undefined }

const levelOf = (percent: number | undefined): Level =>
  percent === undefined ? 'normal' : percent >= CRIT ? 'crit' : percent >= WARN ? 'warn' : 'normal'

const textColor = (level: Level) => (level === 'crit' ? 'error' : level === 'warn' ? 'warning' : undefined)

const labelOf = (kind: string) => LABELS[kind] ?? kind

const rank = (kind: string) => {
  const i = ORDER.indexOf(kind)

  return i === -1 ? ORDER.length : i
}

const pad = (n: number) => String(n).padStart(2, '0')

export const formatReset = (resetsAt: string | undefined, now: number): string | undefined => {
  if (!resetsAt) {
    return undefined
  }

  const at = new Date(resetsAt)

  if (Number.isNaN(at.getTime())) {
    return undefined
  }

  const today = new Date(now)
  const isToday = at.toDateString() === today.toDateString()
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`

  return isToday ? `${time} 초기화` : `${DAYS[at.getDay()]} ${time} 초기화`
}

const formatPercent = (percent: number | undefined) =>
  percent === undefined ? '–' : `${Math.round(percent)}%`

const barSvg = (percent: number | undefined, level: Level) => {
  const clamped = percent === undefined ? 0 : Math.max(0, Math.min(100, percent))
  const fill = (clamped / 100) * BAR_WIDTH
  const r = BAR_HEIGHT / 2
  const fillRect =
    fill > 0 ? `<rect width="${fill.toFixed(1)}" height="${BAR_HEIGHT}" rx="${r}" fill="${BAR_FILL[level]}"/>` : ''

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${BAR_WIDTH}" height="${BAR_HEIGHT}" viewBox="0 0 ${BAR_WIDTH} ${BAR_HEIGHT}">` +
    `<rect width="${BAR_WIDTH}" height="${BAR_HEIGHT}" rx="${r}" fill="${BAR_TRACK}"/>${fillRect}</svg>`
  )
}

const barText = (percent: number | undefined) => {
  const clamped = percent === undefined ? 0 : Math.max(0, Math.min(100, percent))
  const filled = Math.round((clamped / 100) * TERMINAL_CELLS)

  return '▰'.repeat(filled) + '▱'.repeat(TERMINAL_CELLS - filled)
}

const toLimits = (limits: readonly SessionRateLimit[]): Limit[] =>
  limits
    .map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt }))
    .sort((a, b) => rank(a.kind) - rank(b.kind))

type Dollar = Pick<CoreEngineInterface, 'state' | 'ui' | 'clock'>

type PlaceDollar = Pick<CoreEngineInterface, 'state' | 'session' | 'process'>

const baseName = (path: string) => path.replace(/\/+$/, '').split('/').pop() || path

// git worktree면 --git-dir과 --git-common-dir이 서로 다르다
export const parsePlace = (cwd: string, exitCode: number, stdout: string): Place => {
  const [top, gitDir, commonDir, head] = stdout.trim().split('\n')

  if (exitCode !== 0 || !top || !gitDir || !commonDir) {
    return { path: cwd, name: baseName(cwd), kind: 'folder' }
  }

  const branch = head && head !== 'HEAD' ? head : undefined

  return { path: top, name: baseName(top), branch, kind: gitDir === commonDir ? 'main' : 'worktree' }
}

const locate = async ($: PlaceDollar) => {
  const cwd = await $.session.cwd().catch(() => undefined)

  if (!cwd) {
    return
  }

  const r = await $.process
    .run(['git', 'rev-parse', '--path-format=absolute', '--show-toplevel', '--git-dir', '--git-common-dir', '--abbrev-ref', 'HEAD'], {
      cwd,
      timeoutMs: 5000,
    })
    .catch(() => undefined)
  const found = parsePlace(cwd, r?.exitCode ?? 1, r?.stdout ?? '')
  const before = await read($, place)
  const isSame =
    before?.path === found.path && before.branch === found.branch && before.kind === found.kind

  if (!isSame) {
    await update($, place, () => found)
  }
}

// 90%를 넘는 순간 한도별로 토스트 한 번, 90% 아래로 내려가면 다시 알릴 수 있게 풀어준다
const remember = async ($: Dollar, context: number | undefined, rateLimits: readonly SessionRateLimit[]) => {
  const limits = toLimits(rateLimits)
  const next: Snapshot = { context, limits }
  await update($, snapshot, () => next)

  const before = (await read($, alerted)) ?? []
  const over = limits.filter(l => l.percentUsed >= CRIT)
  const fresh = over.filter(l => !before.includes(l.kind))

  if (fresh.length > 0) {
    const now = await $.clock.now()

    for (const l of fresh) {
      const reset = formatReset(l.resetsAt, now)
      $.ui.toast(`${labelOf(l.kind)} 한도 ${CRIT}% 넘음${reset ? ` · ${reset}` : ''}`)
    }
  }

  const kept = over.map(l => l.kind)
  const isSame = kept.length === before.length && kept.every(k => before.includes(k))

  if (!isSame) {
    await update($, alerted, () => kept)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const usage = await $.session.usage().catch(() => undefined)

    if (usage) {
      await remember($, usage.context.percent, usage.rateLimits)
    }

    await locate($)

    return result
  })

  on('session.measure', async ($, e, next) => {
    await remember($, e.context.percent, e.rateLimits)

    return next(e)
  })

  // 턴 중에 브랜치를 바꿨을 수 있으니 턴이 끝날 때마다 위치를 다시 읽는다
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await locate($)

    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    const snap = await read($, snapshot)
    const where = await read($, place)
    const hasUsage = !!snap && (snap.context !== undefined || snap.limits.length > 0)

    if (!hasUsage && !where) {
      return next(e)
    }

    const now = await $.clock.now()
    const meters: Meter[] =
      snap && hasUsage
        ? [
            { key: 'context', label: '컨텍스트', percent: snap.context, reset: undefined },
            ...snap.limits.map(l => ({
              key: l.kind,
              label: labelOf(l.kind),
              percent: l.percentUsed,
              reset: formatReset(l.resetsAt, now),
            })),
          ]
        : []

    const openInEditor = async () => {
      if (!where) {
        return
      }

      const r = await $.process.run(['open', '-a', EDITOR_APP, where.path]).catch(() => undefined)

      if (!r || r.exitCode !== 0) {
        $.ui.toast(`${EDITOR_APP}로 열지 못했습니다${r?.stderr ? `: ${r.stderr.trim()}` : ''}`)
      }
    }

    if (e.surface === 'desktop') {
      const { Box, Text, Svg, Button } = $.ui.resolve(e)

      return (
        <Box flexDirection="row" flexWrap="wrap" alignItems="center" justifyContent="space-between" columnGap="lg" rowGap="xs">
          <Box flexDirection="row" flexWrap="wrap" alignItems="center" columnGap="lg" rowGap="xs">
          {meters.map(m => {
            const level = levelOf(m.percent)

            return (
              <Box key={m.key} flexDirection="row" alignItems="center" gap="xs">
                <Text size="footnote" dimColor>
                  {m.label}
                </Text>
                <Svg
                  source={barSvg(m.percent, level)}
                  alt={`${m.label} ${formatPercent(m.percent)}`}
                  width={BAR_WIDTH}
                  height={BAR_HEIGHT}
                />
                <Text size="footnote" tabular color={textColor(level)} weight={level === 'normal' ? 'regular' : 'semibold'}>
                  {formatPercent(m.percent)}
                </Text>
                {m.reset ? (
                  <Text size="caption" dimColor>
                    · {m.reset}
                  </Text>
                ) : null}
              </Box>
            )
          })}
          </Box>
          {where ? (
            <Box flexDirection="row" alignItems="center" gap="xs">
              <Text size="footnote" dimColor>
                {PLACE_LABEL[where.kind]}
              </Text>
              <Text size="footnote" weight="medium">
                {where.name}
              </Text>
              {where.branch && where.branch !== where.name ? (
                <Text size="footnote" dimColor mono>
                  {where.branch}
                </Text>
              ) : null}
              <Button key="open-editor" label={`${EDITOR_APP}로 열기`} variant="secondary" onPress={openInEditor} />
            </Box>
          ) : null}
        </Box>
      )
    }

    if (e.surface === 'terminal') {
      const { Box, Text, Button } = $.ui.resolve(e)

      return (
        <Box flexDirection="row" flexWrap="wrap" columnGap={3}>
          {where ? (
            <Box flexDirection="row" gap={1}>
              <Text dimColor>{PLACE_LABEL[where.kind]}</Text>
              <Text>{where.name}</Text>
              {where.branch && where.branch !== where.name ? <Text dimColor>{where.branch}</Text> : null}
              <Button key="open-editor" label={`${EDITOR_APP}로 열기`} onPress={openInEditor} />
            </Box>
          ) : null}
          {meters.map(m => {
            const level = levelOf(m.percent)

            return (
              <Box key={m.key} flexDirection="row" gap={1}>
                <Text dimColor>{m.label}</Text>
                <Text color={textColor(level)}>{barText(m.percent)}</Text>
                <Text color={textColor(level)} bold={level !== 'normal'}>
                  {formatPercent(m.percent)}
                </Text>
                {m.reset ? <Text dimColor>· {m.reset}</Text> : null}
              </Box>
            )
          })}
        </Box>
      )
    }

    return next(e)
  })
}
