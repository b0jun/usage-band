import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { parsePlace } from './register'

const NOW = new Date(2026, 10, 13, 10, 0).getTime()
const FIVE_HOUR_RESET = new Date(2026, 10, 13, 15, 20).toISOString()
const WEEK_RESET = new Date(2026, 10, 16, 9, 0).toISOString()

const BAND = {
  plugin: 'usage-band',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 6,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 6 },
    view: {},
  },
} as const

const measure = (context: number | undefined, fiveHour: number, week: number) => ({
  context: { window: 200000, tokens: context === undefined ? undefined : context * 2000, percent: context },
  rateLimits: [
    { kind: 'seven_day', percentUsed: week, resetsAt: WEEK_RESET },
    { kind: 'five_hour', percentUsed: fiveHour, resetsAt: FIVE_HOUR_RESET },
  ],
  changed: ['context' as const, 'rateLimits' as const],
})

test('데스크톱 띠에 컨텍스트, 5시간, 주간 순서로 값과 초기화 시각이 나온다', async ($, on) => {
  on('clock.now', () => ({ value: NOW }))
  on('session.measure', (_, e) => ({ changed: e.changed }))

  await $.session.measure(measure(42, 31, 12))

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)

  expect(texts).toEqual(['컨텍스트', '42%', '5시간', '31%', '· 15:20 초기화', '주간', '12%', '· 월 09:00 초기화'])
  expect((await ui.findAll({ type: 'Svg' })).length).toBe(3)
  await ui.unmount()
})

test('70% 이상은 warning, 90% 이상은 error 색으로 숫자를 칠한다', async ($, on) => {
  on('clock.now', () => ({ value: NOW }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('ui.toast', () => ({ value: undefined }))

  await $.session.measure(measure(74, 92, 12))

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })

  expect((await ui.find({ type: 'Text', text: '74%' }))?.props.color).toBe('warning')
  expect((await ui.find({ type: 'Text', text: '92%' }))?.props.color).toBe('error')
  expect((await ui.find({ type: 'Text', text: '12%' }))?.props.color).toBeUndefined()
  await ui.unmount()
})

test('한도가 90%를 넘는 순간 한 번만 토스트를 띄우고, 내려갔다 다시 넘으면 또 띄운다', async ($, on) => {
  const toasts: string[] = []
  on('clock.now', () => ({ value: NOW }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })

  await $.session.measure(measure(40, 91, 12))
  await $.session.measure(measure(45, 93, 12))
  expect(toasts).toEqual(['5시간 한도 90% 넘음 · 15:20 초기화'])

  await $.session.measure(measure(45, 10, 12))
  await $.session.measure(measure(45, 95, 12))
  expect(toasts.length).toBe(2)
})

test('컴팩션 직후처럼 컨텍스트 값이 없으면 그 칸은 – 로 둔다', async ($, on) => {
  on('clock.now', () => ({ value: NOW }))
  on('session.measure', (_, e) => ({ changed: e.changed }))

  await $.session.measure(measure(undefined, 31, 12))

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })

  expect((await ui.find({ type: 'Text', text: '–' }))?.text).toBe('–')
  await ui.unmount()
})

test('첫 응답 전에는 아무것도 그리지 않는다', async $ => {
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })

  expect(await ui.keepsBeneath()).toBe(true)
  expect(await ui.find({ type: 'Text' })).toBeUndefined()
  await ui.unmount()
})

test('설문이 띠를 쓰는 동안에는 양보한다', async ($, on) => {
  on('clock.now', () => ({ value: NOW }))
  on('session.measure', (_, e) => ({ changed: e.changed }))

  await $.session.measure(measure(42, 31, 12))

  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, hasSurvey: true }, surface: 'desktop' })

  expect(await ui.keepsBeneath()).toBe(true)
  await ui.unmount()
})

test('터미널에서는 칸 막대로 그린다', async ($, on) => {
  on('clock.now', () => ({ value: NOW }))
  on('session.measure', (_, e) => ({ changed: e.changed }))

  await $.session.measure(measure(50, 31, 12))

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  expect((await ui.find({ type: 'Text', text: '▰▰▰▰▱▱▱▱' }))?.text).toBe('▰▰▰▰▱▱▱▱')
  await ui.unmount()
})

test('세션이 시작되면 현재 사용량으로 띠를 채운다', async ($, on) => {
  on('clock.now', () => ({ value: NOW }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: { startedAt: NOW, context: { window: 200000, tokens: 40000, percent: 20 }, rateLimits: [] },
  }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })

  expect((await ui.find({ type: 'Text', text: '20%' }))?.text).toBe('20%')
  await ui.unmount()
})

test('git 출력으로 워크트리, 메인 체크아웃, 일반 폴더를 구분한다', async () => {
  const wt = parsePlace(
    '/repo/.claude/worktrees/feat',
    0,
    '/repo/.claude/worktrees/feat\n/repo/.git/worktrees/feat\n/repo/.git\nclaude/feat\n',
  )
  expect(wt).toEqual({ path: '/repo/.claude/worktrees/feat', name: 'feat', branch: 'claude/feat', kind: 'worktree' })

  const main = parsePlace('/repo/src', 0, '/repo\n/repo/.git\n/repo/.git\nmain\n')
  expect(main).toEqual({ path: '/repo', name: 'repo', branch: 'main', kind: 'main' })

  const detached = parsePlace('/repo', 0, '/repo\n/repo/.git\n/repo/.git\nHEAD\n')
  expect(detached.branch).toBeUndefined()

  const folder = parsePlace('/Users/me/code', 128, '')
  expect(folder).toEqual({ path: '/Users/me/code', name: 'code', kind: 'folder' })
})

test('워크트리 이름과 브랜치를 보여주고, 버튼을 누르면 Zed로 그 경로를 연다', async ($, on) => {
  const runs: (readonly string[])[] = []
  on('clock.now', () => ({ value: NOW }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: { startedAt: NOW, context: { window: 200000 }, rateLimits: [] },
  }))
  on('session.cwd', () => ({ value: '/repo/.claude/worktrees/feat' }))
  on('process.run', (_, e) => {
    runs.push(e.argv)
    const stdout =
      e.argv[0] === 'git'
        ? '/repo/.claude/worktrees/feat\n/repo/.git/worktrees/feat\n/repo/.git\nclaude/feat\n'
        : ''

    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })

  await $.session.start({ cwd: '/repo/.claude/worktrees/feat', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)

  expect(texts).toEqual(['워크트리', 'feat', 'claude/feat'])
  expect((await ui.find({ type: 'Button', key: 'open-editor' }))?.props.label).toBe('Zed에서 열기')

  await ui.press({ key: 'open-editor' })
  expect(runs.at(-1)).toEqual(['open', '-a', 'Zed', '/repo/.claude/worktrees/feat'])
  await ui.unmount()
})

test('Zed를 열지 못하면 토스트로 알린다', async ($, on) => {
  const toasts: string[] = []
  on('clock.now', () => ({ value: NOW }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: { window: 200000 }, rateLimits: [] } }))
  on('session.cwd', () => ({ value: '/Users/me/code' }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  on('process.run', (_, e) => ({
    value: {
      exitCode: e.argv[0] === 'git' ? 128 : 1,
      stdout: '',
      stderr: e.argv[0] === 'git' ? 'not a git repository' : 'Unable to find application named Zed',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))

  await $.session.start({ cwd: '/Users/me/code', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })

  expect((await ui.findAll({ type: 'Text' })).map(t => t.text)).toEqual(['폴더', 'code'])
  await ui.press({ key: 'open-editor' })
  expect(toasts).toEqual(['Zed에서 열지 못했습니다: Unable to find application named Zed'])
  await ui.unmount()
})

const standInsForMainCheckout = (on: On, runs: (readonly string[])[]) => {
  on('clock.now', () => ({ value: NOW }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: { window: 200000 }, rateLimits: [] } }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('process.run', (_, e) => {
    runs.push(e.argv)
    const stdout = e.argv[0] === 'git' ? '/repo\n/repo/.git\n/repo/.git\nmain\n' : ''

    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
}

test('설정한 에디터 이름으로 버튼 문구를 만들고 그 앱으로 연다', { options: { editor: 'Visual Studio Code' } }, async ($, on) => {
  const runs: (readonly string[])[] = []
  standInsForMainCheckout(on, runs)

  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })

  expect((await ui.find({ type: 'Button', key: 'open-editor' }))?.props.label).toBe('Visual Studio Code에서 열기')
  await ui.press({ key: 'open-editor' })
  expect(runs.at(-1)).toEqual(['open', '-a', 'Visual Studio Code', '/repo'])
  await ui.unmount()
})

test('에디터 설정을 비우면 열기 버튼만 숨기고 작업 위치는 그대로 보여준다', { options: { editor: '' } }, async ($, on) => {
  const runs: (readonly string[])[] = []
  standInsForMainCheckout(on, runs)

  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })

  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })

    expect(await ui.find({ type: 'Button', key: 'open-editor' })).toBeUndefined()
    expect((await ui.findAll({ type: 'Text' })).map(t => t.text)).toEqual(['메인', 'repo', 'main'])
    await ui.unmount()
  }
})
