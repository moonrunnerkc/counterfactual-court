import { describe, expect, it } from 'vitest';
import { frozenClockAt } from './clock.js';
import { createLogger } from './log.js';

function captureSink(): { lines: string[]; sink: (line: string) => void } {
  const lines: string[] = [];
  return { lines, sink: (line) => lines.push(line) };
}

const FROZEN = '2026-05-07T14:25:13.000Z';

describe('createLogger', () => {
  it('emits a JSON line per event with timestamp, level, and event name', () => {
    const cap = captureSink();
    const log = createLogger({ clock: frozenClockAt(FROZEN), level: 'debug', sink: cap.sink });
    log.info('hello', { agent: 'prosecutor', count: 3 });
    expect(cap.lines).toHaveLength(1);
    const parsed = JSON.parse(cap.lines[0]!);
    expect(parsed).toEqual({
      ts: FROZEN,
      level: 'info',
      event: 'hello',
      agent: 'prosecutor',
      count: 3,
    });
  });

  it('drops events below the configured level', () => {
    const cap = captureSink();
    const log = createLogger({ clock: frozenClockAt(FROZEN), level: 'warn', sink: cap.sink });
    log.debug('skip-me');
    log.info('also-skip');
    log.warn('keep-me');
    log.error('also-keep');
    expect(cap.lines).toHaveLength(2);
    expect(JSON.parse(cap.lines[0]!).event).toBe('keep-me');
    expect(JSON.parse(cap.lines[1]!).event).toBe('also-keep');
  });

  it('child loggers inherit and merge bindings', () => {
    const cap = captureSink();
    const root = createLogger({
      clock: frozenClockAt(FROZEN),
      level: 'debug',
      sink: cap.sink,
      bindings: { run: 'r1' },
    });
    const child = root.child({ agent: 'jury' });
    child.info('verdict', { outcome: 'approve' });
    const parsed = JSON.parse(cap.lines[0]!);
    expect(parsed.run).toBe('r1');
    expect(parsed.agent).toBe('jury');
    expect(parsed.outcome).toBe('approve');
  });

  it('caller-supplied fields override inherited bindings on conflict', () => {
    const cap = captureSink();
    const root = createLogger({
      clock: frozenClockAt(FROZEN),
      level: 'debug',
      sink: cap.sink,
      bindings: { agent: 'root' },
    });
    root.info('event', { agent: 'override' });
    expect(JSON.parse(cap.lines[0]!).agent).toBe('override');
  });
});
