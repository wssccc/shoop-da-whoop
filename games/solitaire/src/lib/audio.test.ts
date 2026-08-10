// Lock-screen guard: play() must never schedule onto a suspended
// AudioContext (nodes would pile up without ever ending — see
// memories/ios-webaudio-suspended-leak.md), and must attempt resume.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  let state = 'running';
  const resume = vi.fn(() => Promise.resolve());
  const play = vi.fn();
  return {
    resume,
    play,
    setState: (s: string) => {
      state = s;
    },
    ctx: {
      get state() {
        return state;
      },
      resume,
    },
  };
});

vi.mock('howler', () => ({
  Howler: {
    ctx: mocks.ctx,
    volume: vi.fn(),
    mute: vi.fn(),
  },
  // Plain function so `new Howl(...)` works; returns a play/on stub.
  Howl: vi.fn(function () {
    return { play: mocks.play, on: vi.fn() };
  }),
}));

import * as audio from './audio';

describe('audio lock-screen guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('plays when the context is running', () => {
    mocks.setState('running');
    audio.Audio.move();
    expect(mocks.play).toHaveBeenCalled();
    expect(mocks.resume).not.toHaveBeenCalled();
  });

  it('skips scheduling and resumes when the context is suspended', () => {
    mocks.setState('suspended');
    audio.Audio.move();
    expect(mocks.play).not.toHaveBeenCalled(); // no node on a suspended graph
    expect(mocks.resume).toHaveBeenCalled();
  });

  it('skips scheduling and resumes on the iOS "interrupted" state', () => {
    mocks.setState('interrupted');
    audio.Audio.move();
    expect(mocks.play).not.toHaveBeenCalled();
    expect(mocks.resume).toHaveBeenCalled();
  });
});
