import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Logger } from '../runtime/log.js';

/** One frame extracted from a video. */
export interface VideoFrame {
  /** Source video file (basename), e.g. `walkthrough.mp4`. */
  source: string;
  /** 0-based frame ordinal within the source. */
  index: number;
  /** Base64 PNG of the frame. */
  base64: string;
}

/** Outcome of {@link extractFrames}. */
export interface FrameExtractionResult {
  frames: VideoFrame[];
  /** When non-empty, ffmpeg was unavailable or failed; the run continued without frames. */
  warnings: string[];
}

/**
 * Extract `frameCount` evenly-spaced PNG frames from a video file using
 * `ffmpeg`. When ffmpeg is not on PATH, returns an empty frame list plus a
 * warning; the orchestrator must not fail the run on a missing tool.
 *
 * @param videoPath  Absolute path to an MP4 (or any ffmpeg-supported format).
 * @param frameCount How many frames to sample; defaults to 8.
 * @param logger     Logger for the warning emitted when ffmpeg is missing.
 * @returns Extracted frames plus any non-fatal warnings.
 */
export function extractFrames(
  videoPath: string,
  frameCount = 8,
  logger?: Logger,
): FrameExtractionResult {
  if (!ffmpegAvailable()) {
    const msg = `multimodal: ffmpeg not on PATH; skipping frame extraction for ${videoPath}`;
    logger?.warn('multimodal.skip', { reason: 'ffmpeg-missing', videoPath });
    return { frames: [], warnings: [msg] };
  }

  const dir = mkdtempSync(join(tmpdir(), 'cc-frames-'));
  try {
    const pattern = join(dir, 'frame-%04d.png');
    const result = spawnSync(
      'ffmpeg',
      [
        '-loglevel',
        'error',
        '-i',
        videoPath,
        '-vf',
        `select='not(mod(n\\,floor(n_frames/${frameCount})))',scale=512:-1`,
        '-frames:v',
        String(frameCount),
        '-vsync',
        'vfr',
        pattern,
      ],
      { encoding: 'utf8', timeout: 60_000 },
    );
    if (result.status !== 0) {
      const reason = result.stderr.trim() || `exit ${result.status ?? 'unknown'}`;
      const msg = `multimodal: ffmpeg failed for ${videoPath}: ${reason}`;
      logger?.warn('multimodal.skip', { reason: 'ffmpeg-error', videoPath });
      return { frames: [], warnings: [msg] };
    }
    const files = readdirSync(dir)
      .filter((n) => n.endsWith('.png'))
      .sort();
    const sourceName = videoPath.split('/').pop() ?? videoPath;
    const frames = files.map((name, index) => ({
      source: sourceName,
      index,
      base64: readFileSync(join(dir, name)).toString('base64'),
    }));
    return { frames, warnings: [] };
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
}

/**
 * Probe whether `ffmpeg` is available on PATH. Pure with respect to the
 * filesystem; spawns one cheap process. Returns false on any error so the
 * caller can degrade gracefully.
 */
export function ffmpegAvailable(): boolean {
  try {
    const r = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8', timeout: 5_000 });
    return r.status === 0;
  } catch {
    return false;
  }
}
