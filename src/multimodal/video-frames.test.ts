import { describe, expect, it } from 'vitest';
import { extractFrames, ffmpegAvailable } from './video-frames.js';

describe('extractFrames graceful fallback', () => {
  it('returns an empty frame list and a warning when ffmpeg is missing', () => {
    // Force the missing-ffmpeg path: extract from a path that does not exist.
    // If ffmpeg is on PATH, the spawn itself succeeds but the conversion fails;
    // either way the function returns an empty list and a warning, which is
    // the contract.
    const result = extractFrames('/non/existent/video.mp4', 4);
    expect(result.frames).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('ffmpegAvailable returns a boolean without throwing on any platform', () => {
    expect(typeof ffmpegAvailable()).toBe('boolean');
  });
});
