import shaka from 'shaka-player/dist/shaka-player.compiled';
import { getVideoElement, qualityLabel, setVideoQuality, useVideo, type VideoQuality } from '@/state/video';
import { onWindowVisibility, windowHidden } from '@/lib/windowVisibility';
import { trackLog } from '../trackLog';
import type { YouTubeEngine } from './engine';

/**
 * A music video's picture, as Apple Music plays one: a second Shaka player,
 * video only and muted, on the shared <video> element (state/video.ts),
 * held to the audio element of the deck in front. The audio stays the clock;
 * the picture follows it, nudging its rate for small drift and seeking for
 * large. It streams only while a surface shows it.
 */

/** Past this the picture jumps to the audio; under it, its rate is nudged. */
const SEEK_DRIFT_SEC = 0.35;
const IGNORE_DRIFT_SEC = 0.02;
const SYNC_EVERY_MS = 250;

/**
 * What Auto opens at. Shaka's own default (500kbps) starts a music video at
 * 360p and climbs from there, which is most of a short song; the picture is
 * worth more than the first few seconds of caution, and a connection that
 * can't hold this is measured within seconds and backed off.
 */
const AUTO_START_BPS = 6_000_000;

/**
 * What Auto climbs to: the best the video has, at its highest bitrate (engine.videoStream). Only if the machine
 * proves it can't hold that (the picture keeps falling behind or freezing) does Auto settle at the H.264 ceiling.
 */
const AUTO_FALLBACK_HEIGHT = 1080;
let autoMaxHeight = Infinity;

let player: shaka.Player | null = null;
let source: { engine: YouTubeEngine; audio: HTMLAudioElement } | null = null;
/** The video whose manifest is loaded (or loading) in the picture player, and at which quality. */
let loaded: string | null = null;
let loadedQuality: VideoQuality | null = null;
let generation = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let listening: HTMLAudioElement | null = null;

async function ensurePlayer(): Promise<shaka.Player> {
  if (player) return player;
  const created = new shaka.Player();
  created.configure({
    manifest: { disableAudio: true, disableText: true, disableThumbnails: true },
    // The manifest holds one codec's ladder, the highest-bitrate rendition at each height (engine.videoStream).
    preferredDecodingAttributes: ['smooth', 'powerEfficient'],
    streaming: {
      bufferingGoal: 30,
      rebufferingGoal: 0.5,
      bufferBehind: 30,
      retryParameters: { maxAttempts: 2, baseDelay: 1000, backoffFactor: 2, fuzzFactor: 0.5, timeout: 30_000 },
    },
  });
  await created.attach(getVideoElement());
  created.addEventListener('error', (event) => {
    const error = (event as unknown as { detail: shaka.util.Error }).detail;
    trackLog.d(`video: Shaka error ${error.code} (severity ${error.severity})`, loaded);
  });
  // Auto moves between renditions as it measures the connection; the switcher shows where it landed.
  for (const event of ['adaptation', 'variantchanged'] as const) {
    created.addEventListener(event, () => reportActive(created));
  }
  player = created;
  return created;
}

/** Holds the picture at [quality]: Auto adapts up to the H.264 ceiling, a picked height doesn't move. */
function configureQuality(target: shaka.Player, quality: VideoQuality) {
  target.configure({
    abr: {
      enabled: quality === 'auto',
      defaultBandwidthEstimate: AUTO_START_BPS,
      restrictions: { maxHeight: quality === 'auto' ? autoMaxHeight : Infinity },
    },
  });
}

function reportActive(target: shaka.Player) {
  const active = target.getVariantTracks().find((t) => t.active);
  useVideo.setState({ activeHeight: active?.height ?? null });
}

/** The deck in front changed track, or recovered it: show its picture, if it has one. */
export function followVideo(engine: YouTubeEngine, audio: HTMLAudioElement): void {
  source = { engine, audio };
  listen(audio);
  void refresh();
}

/** Nothing is playing: drop the picture. */
export function stopVideo(): void {
  source = null;
  void refresh();
}

useVideo.subscribe((state, previous) => {
  if (state.surfaces > 0 !== previous.surfaces > 0 || state.quality !== previous.quality) void refresh();
});

// Minimised: the picture is dropped (the sound is the audio element's, and carries on); back, it is loaded at the audio's moment.
onWindowVisibility(() => void refresh());

async function refresh(): Promise<void> {
  const run = ++generation;
  const quality = useVideo.getState().quality;
  const wanted = source && useVideo.getState().surfaces > 0 && !windowHidden() ? source : null;
  const stream = wanted ? await wanted.engine.videoStream(quality === 'auto' ? null : quality).catch(() => null) : null;
  if (run !== generation) return;
  if (!stream) {
    await unload();
    return;
  }
  if (stream.videoId === loaded && quality === loadedQuality) return;
  // A quality change reloads the same picture, so it picks up where it was.
  // Its surface stays on screen through the swap: dropping it would send the
  // full-screen player back to the artwork and in again.
  const resumeAt = wanted!.audio.currentTime;
  await unload(stream.videoId === loaded);
  loaded = stream.videoId;
  loadedQuality = quality;
  lastSeekAt = 0;
  framesSeen = -1;
  struggles = [];
  const video = getVideoElement();
  try {
    const shakaPlayer = await ensurePlayer();
    configureQuality(shakaPlayer, quality);
    await shakaPlayer.load(`data:application/dash+xml;base64,${btoa(stream.manifest)}`, resumeAt, 'application/dash+xml');
    if (run !== generation) return;
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      await new Promise<void>((resolve) => video.addEventListener('loadeddata', () => resolve(), { once: true }));
    }
    if (run !== generation) return;
    const active = shakaPlayer.getVariantTracks().find((t) => t.active);
    trackLog.i(`video: ${active?.height ?? '?'}p ${active?.videoCodec ?? ''} (${quality === 'auto' ? 'auto' : qualityLabel(quality)})`, stream.videoId);
    useVideo.setState({ videoId: stream.videoId, aspect: stream.aspect, heights: stream.heights, activeHeight: active?.height ?? null });
    sync();
    timer ??= setInterval(sync, SYNC_EVERY_MS);
  } catch (error) {
    if (run !== generation) return;
    trackLog.w(`video: couldn't load the picture: ${error instanceof Error ? error.message : String(error)}`, stream.videoId);
    loaded = null;
    loadedQuality = null;
    useVideo.setState({ videoId: null });
    // A height this machine can't decode shouldn't cost the picture: back to Auto, which is H.264.
    if (quality !== 'auto') {
      trackLog.w(`video: ${qualityLabel(quality)} wouldn't play; back to Auto`, stream.videoId);
      setVideoQuality('auto');
    }
  }
}

/** Stops the picture player; [keepPicture] leaves the surface showing, for a reload of the same video. */
async function unload(keepPicture = false): Promise<void> {
  if (timer) clearInterval(timer);
  timer = null;
  loaded = null;
  loadedQuality = null;
  if (!keepPicture) useVideo.setState({ videoId: null, heights: [], activeHeight: null });
  await player?.unload().catch(() => {});
}

function listen(audio: HTMLAudioElement) {
  if (listening === audio) return;
  for (const type of ['play', 'pause', 'seeked', 'ratechange'] as const) {
    listening?.removeEventListener(type, sync);
    audio.addEventListener(type, sync);
  }
  listening = audio;
}

/** After a jump to the audio, the picture is left alone this long: a 4K frame needs its keyframe decoded again first. */
const SEEK_COOLDOWN_MS = 3_000;
/** Frames that stop arriving this long while the picture is meant to be playing count as a freeze. */
const FREEZE_MS = 3_000;
/** Jumps (or freezes) within this window mean the machine can't keep this picture up. */
const STRUGGLE_WINDOW_MS = 25_000;
const STRUGGLE_LIMIT = 3;

let lastSeekAt = 0;
let struggles: number[] = [];
let framesSeen = -1;
let framesAt = 0;

/**
 * The picture keeps falling behind or freezing: a quality the machine can't decode in time (on 4K, each jump back
 * to the audio decodes from a keyframe again and lands already late, which jumps again and looks like a freeze).
 * A picked height gives way to Auto, which is hardware-decoded H.264.
 */
function struggled(reason: string) {
  const now = performance.now();
  struggles = [...struggles.filter((t) => now - t < STRUGGLE_WINDOW_MS), now];
  if (struggles.length < STRUGGLE_LIMIT) return;
  struggles = [];
  const quality = useVideo.getState().quality;
  trackLog.w(`video: ${reason}`, loaded);
  if (quality !== 'auto') {
    trackLog.w(`video: ${qualityLabel(quality)} can't keep up; back to Auto`, loaded);
    setVideoQuality('auto');
  } else if (autoMaxHeight > AUTO_FALLBACK_HEIGHT) {
    trackLog.w(`video: Auto held to ${AUTO_FALLBACK_HEIGHT}p from here`, loaded);
    autoMaxHeight = AUTO_FALLBACK_HEIGHT;
    if (player) configureQuality(player, 'auto');
  }
}

/** The picture is behind or ahead by more than a rate nudge can fix: put it where the audio is, once in a while. */
function jumpToAudio(video: HTMLVideoElement, audio: HTMLAudioElement, reason: string) {
  lastSeekAt = performance.now();
  framesSeen = -1;
  video.currentTime = audio.currentTime;
  struggled(reason);
}

/** Holds the picture to the audio: same play state, same rate, the same moment. */
function sync() {
  const audio = source?.audio;
  const video = getVideoElement();
  if (!audio || !loaded || useVideo.getState().videoId !== loaded || video.readyState < HTMLMediaElement.HAVE_METADATA) return;
  const now = performance.now();
  const drift = video.currentTime - audio.currentTime;
  if (audio.paused) {
    if (Math.abs(drift) > IGNORE_DRIFT_SEC) video.currentTime = audio.currentTime;
    video.playbackRate = audio.playbackRate;
    framesSeen = -1;
  } else if (video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
    // Buffering: Shaka holds the rate at zero until there is picture again; fighting it only stutters.
    framesSeen = -1;
  } else {
    const cooling = now - lastSeekAt < SEEK_COOLDOWN_MS;
    if (Math.abs(drift) > SEEK_DRIFT_SEC && !cooling) {
      jumpToAudio(video, audio, 'the picture kept falling behind the sound');
    } else {
      // Catch up (or wait) over a few seconds, rather than jumping: faster when far behind, within reason.
      const limit = Math.abs(drift) > SEEK_DRIFT_SEC ? 0.25 : 0.1;
      const nudge = Math.abs(drift) > IGNORE_DRIFT_SEC ? Math.max(-limit, Math.min(limit, -drift)) : 0;
      video.playbackRate = audio.playbackRate * (1 + nudge);
    }
    // A decoder that has stopped handing over frames while the clock runs on.
    const frames = video.getVideoPlaybackQuality().totalVideoFrames;
    if (frames !== framesSeen || video.paused) {
      framesSeen = frames;
      framesAt = now;
    } else if (now - framesAt > FREEZE_MS) {
      framesAt = now;
      jumpToAudio(video, audio, 'the picture froze');
    }
  }
  if (audio.paused && !video.paused) video.pause();
  else if (!audio.paused && video.paused) void video.play().catch(() => {});
}
