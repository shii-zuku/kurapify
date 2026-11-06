import { SabrStreamingAdapter } from 'googlevideo/sabr-streaming-adapter';
import { buildSabrFormat } from 'googlevideo/utils';
import shaka from 'shaka-player/dist/shaka-player.compiled';
import { Constants, Utils, YT, type Innertube } from 'youtubei.js/web';
import type { LocalFile } from '@kurapify/shared/bridge';
import { isLocalId, localAudioUrl, localIdOf } from '@/data/local/ids';
import { queryClient } from '@/lib/queryClient';
import { useAudioQuality } from '@/state/audioQuality';
import { timed, trackLog } from '../trackLog';
import { botguard } from './botguard';
import { ytAuthSnapshot } from '@/extension/useYtAuth';
import { getInnertube, getSignedInnertube } from './innertube';
import {
  CLIENT_ATTEMPTS,
  usesWebPo,
  excludeClient,
  playerRequest,
  resolvePlayer,
  UnplayableError,
  type PlayerClientName,
  type ResolvedPlayer,
} from './resolver';
import { ShakaPlayerAdapter } from './ShakaPlayerAdapter';

/** What the engine knows about the track it loaded. */
export interface LoadedTrack {
  videoId: string;
  title: string;
  author: string;
  durationSec: number;
  /** Largest first. */
  thumbnails: { url: string; width: number; height: number }[];
  client: PlayerClientName;
  /** The audio format actually selected, e.g. "251 opus 140kbps". */
  format: string;
  /** The same, field by field, for stats for nerds. */
  stream: StreamStats;
  loudnessDb: number | null;
}

/** What stats for nerds shows about the audio stream (the phone's NerdStats.Snapshot). */
export interface StreamStats {
  /** "Opus", "AAC". */
  codec: string | null;
  itag: string | null;
  bitrateKbps: number | null;
  sampleRateHz: number | null;
  channels: number | null;
  /** "direct" (googlevideo URLs, by range) or "SABR". */
  mode: 'direct' | 'SABR';
}

/** A music video's picture: a video-only DASH manifest over the same response's direct URLs. */
export interface VideoStream {
  videoId: string;
  manifest: string;
  /** Width over height of the largest rendition, e.g. 16/9. */
  aspect: number;
  /** Every height the response offers, largest first: what the quality switcher lists. */
  heights: number[];
}

/**
 * A square picture is YouTube's art track (a song): the album artwork as a
 * still video. Only a wider picture is a music video worth playing.
 */
const MIN_VIDEO_ASPECT = 1.2;

export class SupersededError extends Error {
  override readonly name = 'SupersededError';
}

/** How long to wait before re-asking after the server sent no media (its backoffs measured 0-2s). */
const RETRY_STREAMING_SECONDS = 2;

/** Waiting longer than this for the first audio means the client's stream isn't going to start. */
const FIRST_AUDIO_TIMEOUT_MS = 15_000;

/**
 * YouTube playback in the browser (prompt §5.2): a player request through
 * YouTube.js, then audio only through Shaka, from the response's direct URLs
 * when it has them (VISIONOS does, and that's what plays; see
 * web/docs/youtube-playback.md) and over SABR through googlevideo otherwise.
 *
 * One engine, one `<audio>` element. Loading a new track supersedes whatever
 * was loading before. A client that fails to stream is excluded for the track
 * and the next one in the walk is tried, at the same position.
 */
export class YouTubeEngine {
  readonly audio: HTMLAudioElement;
  private player: shaka.Player | null = null;
  private adapter: SabrStreamingAdapter | null = null;
  private yt: Innertube | null = null;
  private generation = 0;
  private loading = false;
  private current: { videoId: string; client: PlayerClientName; signed: boolean } | null = null;
  /** The response the playing track streams from, when it has direct URLs; the video picture comes from it too. */
  private direct: ResolvedPlayer | null = null;
  private preferredCodecs: string[];
  /** The element is playing one of the listener's own files, straight from its source, with no Shaka under it. */
  private local = false;

  /** Raised when a track can't be played at all, after every fallback. */
  onFatal: (videoId: string, message: string, permanent: boolean) => void = () => {};
  /** Raised when the engine moved a track to another client mid-playback. */
  onRecovered: (track: LoadedTrack) => void = () => {};

  constructor(audio: HTMLAudioElement) {
    this.audio = audio;
    // Opus (itag 251) when the browser can decode it in MSE, AAC (140)
    // otherwise, which is Safari: unsupported, but it must not crash.
    const opus = typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported('audio/webm; codecs="opus"');
    this.preferredCodecs = opus ? ['opus', 'mp4a'] : ['mp4a'];
  }

  private async ensurePlayer(): Promise<shaka.Player> {
    if (this.player) return this.player;
    shaka.polyfill.installAll();
    if (!shaka.Player.isBrowserSupported()) throw new Error('This browser can’t play YouTube streams (no Media Source Extensions)');
    const player = new shaka.Player();
    player.configure({
      manifest: { disableVideo: true, disableText: true, disableThumbnails: true },
      abr: { enabled: false },
      preferredAudioCodecs: this.preferredCodecs,
      // Based on Kira's streaming settings, with one measured change.
      //
      // The SABR server paces delivery and answers requests past what it's
      // willing to send with no media; Shaka treats those as failures. Kira
      // lets Shaka retry them (8 attempts, exponential backoff), but a Shaka
      // retry re-sends the same request object, and googlevideo builds the
      // SABR body once, in a request filter. So every retry replays a stale
      // body: the old player time and the cold-start PO token minted before
      // the real one was ready (measured: retries a minute later still carried
      // the body built at 0.4s). With no Shaka-level retries, the failure
      // callback restarts streaming instead, which builds a fresh request.
      streaming: {
        bufferingGoal: 120,
        rebufferingGoal: 0.01,
        bufferBehind: 300,
        retryParameters: { maxAttempts: 1, baseDelay: 1000, backoffFactor: 1, fuzzFactor: 0.5, timeout: 30_000 },
        // A refusal is handled by moving to the next client (onShakaError);
        // retrying it would only collect more 403s.
        failureCallback: (error: shaka.util.Error) => {
          if (!isRefusal(error)) player.retryStreaming(RETRY_STREAMING_SECONDS);
        },
      },
    });
    await player.attach(this.audio);
    player.addEventListener('error', (event) => this.onShakaError((event as unknown as { detail: shaka.util.Error }).detail));
    this.player = player;
    return player;
  }

  /** Pays the cold costs before the first tap (InnerTubeXResolver.warm): the session, the player script, BotGuard. */
  async warm(): Promise<void> {
    this.yt ??= await getInnertube();
    await botguard.init().catch((error: unknown) => trackLog.w(`BotGuard warm-up failed: ${String(error)}`));
  }

  /**
   * Loads [videoId] and starts it at [startSec]. Resolves once audio is
   * actually flowing; rejects with [UnplayableError] for a settled "no",
   * [SupersededError] if another load replaced this one.
   */
  async load(videoId: string, { startSec = 0, autoplay = true } = {}): Promise<LoadedTrack> {
    if (isLocalId(videoId)) return this.loadLocal(videoId, startSec, autoplay);
    this.local = false;
    const generation = ++this.generation;
    this.loading = true;
    const started = performance.now();
    trackLog.i(`loading at ${startSec.toFixed(1)}s`, videoId);
    try {
      const player = await this.ensurePlayer();
      this.yt ??= await timed('InnerTube session', videoId, getInnertube);
      void botguard.init().catch((error: unknown) => trackLog.w(`BotGuard init failed: ${String(error)}`, videoId));

      const skip = new Set<PlayerClientName>();
      let lastError: unknown = null;
      let yt = this.yt;
      let signed = false;
      // The 256 kbps rendition is YouTube Music Premium's, and YouTube only lists it to the account that has it: with
      // Maximum picked and a sign-in, the track is asked for as that account. Anything that goes wrong that way
      // falls back to the anonymous request, which is what played before.
      let premiumAsk = false;
      if (useAudioQuality.getState().quality === 'max' && ytAuthSnapshot().signedIn) {
        try {
          yt = await timed('signed-in InnerTube session', videoId, getSignedInnertube);
          signed = true;
          premiumAsk = true;
        } catch (error) {
          trackLog.w(`couldn't ask as the signed-in account for the best audio: ${describe(error)}`, videoId);
        }
      }
      const fallBack = (why: string) => {
        trackLog.w(`asking as the account didn't work (${why}); asking anonymously`, videoId);
        premiumAsk = false;
        yt = this.yt!;
        signed = false;
        skip.clear();
      };
      for (let attempt = 0; attempt < CLIENT_ATTEMPTS; attempt++) {
        let resolved: ResolvedPlayer;
        try {
          resolved = await timed('player request', videoId, () => resolvePlayer(yt, videoId, skip, signed));
        } catch (error) {
          if (premiumAsk) {
            fallBack(describe(error));
            attempt = -1;
            continue;
          }
          // An age gate is a verdict on the visitor, not the track: ask again
          // as the signed-in user, through the extension (prompt §5.3).
          if (!(error instanceof UnplayableError && error.ageGated) || signed || !ytAuthSnapshot().signedIn) throw error;
          trackLog.i('age-restricted; asking again signed in', videoId);
          yt = await timed('signed-in InnerTube session', videoId, getSignedInnertube);
          signed = true;
          skip.clear();
          attempt = -1;
          continue;
        }
        this.checkCurrent(generation);
        try {
          const track = await this.startStream(player, resolved, startSec, autoplay, generation);
          trackLog.i(
            `playing via ${track.client}, ${track.format}, first audio after ${Math.round(performance.now() - started)}ms`,
            videoId,
          );
          return track;
        } catch (error) {
          if (error instanceof SupersededError) throw error;
          lastError = error;
          excludeClient(videoId, resolved.client, `streaming failed: ${describe(error)}`, resolved.signed);
          if (premiumAsk) {
            fallBack(describe(error));
            attempt = -1;
            continue;
          }
          skip.add(resolved.client);
        }
      }
      throw lastError instanceof Error ? lastError : new Error('No YouTube client could stream this track');
    } catch (error) {
      if (!(error instanceof SupersededError)) {
        trackLog.e(`load failed: ${describe(error)}`, videoId);
      }
      throw error;
    } finally {
      if (generation === this.generation) this.loading = false;
    }
  }

  /**
   * One of the listener's own files: the element plays it from the desktop app's local server (local.js), in whatever
   * codec the browser decodes (MP3, FLAC, AAC, Opus, WAV, Vorbis), and the file's own tags stand for the stream.
   */
  private async loadLocal(videoId: string, startSec: number, autoplay: boolean): Promise<LoadedTrack> {
    const generation = ++this.generation;
    this.loading = true;
    this.current = null;
    this.direct = null;
    try {
      // Let go of the streaming player, and of any SABR session, before the element is given a plain source.
      await this.player?.unload();
      this.adapter?.dispose();
      this.adapter = null;
      this.checkCurrent(generation);
      const audio = this.audio;
      this.local = true;
      audio.src = localAudioUrl(videoId);
      await new Promise<void>((resolve, reject) => {
        const done = () => {
          audio.removeEventListener('loadedmetadata', done);
          audio.removeEventListener('error', failed);
          resolve();
        };
        const failed = () => {
          audio.removeEventListener('loadedmetadata', done);
          audio.removeEventListener('error', failed);
          reject(new Error(audio.error?.message || 'This file can’t be played (is it still where it was added from?)'));
        };
        audio.addEventListener('loadedmetadata', done);
        audio.addEventListener('error', failed);
      });
      this.checkCurrent(generation);
      if (startSec > 0) audio.currentTime = startSec;
      if (autoplay) {
        await audio.play().catch((error: unknown) => {
          if (!(error instanceof DOMException && error.name === 'NotAllowedError')) throw error;
        });
      }
      await this.firstAudio(generation);
      const file = queryClient.getQueryData<LocalFile[]>(['local', 'files'])?.find((f) => f.id === localIdOf(videoId));
      const codec = file ? (file.lossless ? `${file.format} lossless` : file.format) : 'local file';
      return {
        videoId,
        title: file?.title ?? '',
        author: file?.artist ?? '',
        durationSec: Number.isFinite(audio.duration) ? Math.round(audio.duration) : file?.durationSec ?? 0,
        thumbnails: file?.cover ? [{ url: `/__local/cover/${file.id}`, width: 600, height: 600 }] : [],
        client: 'LOCAL' as unknown as PlayerClientName,
        format: file ? `${codec}${file.bitrateKbps ? ` ${file.bitrateKbps}kbps` : ''}` : 'local file',
        stream: {
          codec: file?.format ?? null,
          itag: null,
          bitrateKbps: file?.bitrateKbps ?? null,
          sampleRateHz: file?.sampleRateHz ?? null,
          channels: null,
          mode: 'direct',
        },
        loudnessDb: null,
      };
    } catch (error) {
      if (!(error instanceof SupersededError)) trackLog.e(`local load failed: ${describe(error)}`, videoId);
      throw error;
    } finally {
      if (generation === this.generation) this.loading = false;
    }
  }

  private checkCurrent(generation: number) {
    if (generation !== this.generation) throw new SupersededError('Replaced by a newer load');
  }

  private async startStream(
    player: shaka.Player,
    resolved: ResolvedPlayer,
    startSec: number,
    autoplay: boolean,
    generation: number,
  ): Promise<LoadedTrack> {
    const { videoId, client, info, signed } = resolved;
    await player.unload();
    this.adapter?.dispose();
    this.adapter = null;
    this.current = { videoId, client, signed };
    this.direct = null;

    const direct = hasDirectAudio(info);
    const manifest = direct ? await this.directManifest(resolved) : await this.sabrManifest(player, resolved);
    this.checkCurrent(generation);
    const mode = direct ? 'direct' : 'SABR';

    await timed(`${client} ${mode} load`, videoId, () =>
      player.load(`data:application/dash+xml;base64,${btoa(manifest)}`, startSec, 'application/dash+xml'),
    );
    this.checkCurrent(generation);
    const selected = this.selectAudio(player);
    // What the response offered, so a missing 256 kbps rendition can be told from one that was there and not chosen.
    const offered = player
      .getVariantTracks()
      .filter((t) => t.audioCodec && !/drc/i.test(t.originalAudioId ?? ''))
      .map((t) => `${(t.originalAudioId ?? '').split('-')[0]} ${t.audioCodec} ${Math.round((t.audioBandwidth ?? t.bandwidth) / 1000)}k`);
    trackLog.d(`audio on offer${signed ? ' (signed in)' : ''}: ${offered.join(', ')}`, videoId);
    const format = `${selected.label} ${mode}`;
    if (direct) this.direct = resolved;

    if (autoplay) {
      await this.audio.play().catch((error: unknown) => {
        // Autoplay without a gesture is refused; the track is loaded and the
        // play button will start it.
        if (error instanceof DOMException && error.name === 'NotAllowedError') {
          trackLog.w('autoplay was blocked by the browser; waiting for a tap', videoId);
        } else throw error;
      });
    }
    await this.firstAudio(generation);

    const basic = info.basic_info;
    return {
      videoId,
      title: basic.title ?? '',
      author: basic.author ?? '',
      durationSec: basic.duration ?? Math.round(player.seekRange().end),
      thumbnails: [...(basic.thumbnail ?? [])]
        .map((t) => ({ url: t.url, width: t.width, height: t.height }))
        .sort((a, b) => b.width - a.width),
      client,
      format,
      stream: { ...selected.stats, mode },
      loudnessDb: info.player_config?.audio_config?.loudness_db ?? null,
    };
  }

  /**
   * A plain DASH manifest over the response's own audio URLs, which Shaka
   * fetches by byte range. This is how Android plays YouTube: InnerTubeX runs
   * with SABR off and plays the direct URLs a client like VISIONOS returns.
   * YouTube.js deciphers each URL (signature and n parameter) with the player
   * script while rendering the manifest.
   */
  private async directManifest({ videoId, client, info }: ResolvedPlayer): Promise<string> {
    // The SABR adapter's dispose() unregisters Shaka's http(s) schemes
    // outright; put Shaka's own fetch plugin back before a plain load.
    for (const scheme of ['http', 'https']) {
      shaka.net.NetworkingEngine.registerScheme(
        scheme,
        shaka.net.HttpFetchPlugin.parse,
        shaka.net.NetworkingEngine.PluginPriority.FALLBACK,
      );
    }
    // BotGuard clients attach the streaming token to every media URL, as
    // InnerTubeX does on Android (`pot`, bound to the videoId).
    const pot = usesWebPo(client) ? await botguard.mint(videoId) : undefined;
    return info.toDash({
      format_filter: (format) => format.has_video || !format.has_audio,
      url_transformer: (url) => {
        if (pot) url.searchParams.set('pot', pot);
        return url;
      },
      manifest_options: { include_thumbnails: false },
    });
  }

  /**
   * The playing track's picture, if it's a music video: its video-only
   * renditions from the same response, as a DASH manifest for a second,
   * muted player. Null for a song (YouTube's square art track), for a track
   * that streams over SABR, and while nothing is loaded.
   *
   * [height] keeps only the renditions of that height, which is how a picked
   * quality is held: Shaka would otherwise drop every codec but the preferred
   * one (StreamUtils.chooseCodecsAndFilterManifest), and YouTube's H.264
   * ladder stops at 1080p, so 1440p and 2160p are only reachable with the
   * manifest cut down to them.
   */
  async videoStream(height: number | null = null): Promise<VideoStream | null> {
    const resolved = this.direct;
    if (!resolved) return null;
    const { videoId, client, info } = resolved;
    const pictures = (info.streaming_data?.adaptive_formats ?? []).filter(
      (f) => f.has_video && !f.has_audio && f.width && f.height && (f.url || f.signature_cipher || f.cipher),
    );
    const largest = pictures.sort((a, b) => b.width! * b.height! - a.width! * a.height!)[0];
    if (!largest || largest.width! / largest.height! < MIN_VIDEO_ASPECT) return null;
    const heights = [...new Set(pictures.map((f) => f.height!))].sort((a, b) => b - a);
    const wanted = height !== null && heights.includes(height) ? height : null;
    // The richest picture YouTube offers: of the renditions at a height, only the one with the highest bitrate
    // stays (whatever its codec), and the ladder is held to the codec that wins at the top. HDR is left out, as it
    // washes out on a screen that isn't.
    const bitrateOf = (f: (typeof pictures)[number]) => f.bitrate || f.average_bitrate || 0;
    const codecOf = (f: (typeof pictures)[number]) => /codecs="([^.\"]+)/.exec(f.mime_type)?.[1] ?? '';
    const isHdr = (f: (typeof pictures)[number]) => /2084|B67|HLG|PQ/i.test(f.color_info?.transfer_characteristics ?? '');
    const sdr = pictures.filter((f) => !isHdr(f));
    const pool = sdr.length ? sdr : pictures;
    const bestAt = (h: number, family?: string) =>
      pool.filter((f) => f.height === h && (!family || codecOf(f) === family)).sort((a, b) => bitrateOf(b) - bitrateOf(a))[0];
    const family = codecOf(bestAt(wanted ?? Math.max(...pool.map((f) => f.height!))) ?? largest);
    const keep = new Set<number>();
    for (const h of wanted !== null ? [wanted] : heights) {
      const best = bestAt(h, wanted !== null ? undefined : family);
      if (best) keep.add(best.itag);
    }
    const pot = usesWebPo(client) ? await botguard.mint(videoId) : undefined;
    const manifest = await info.toDash({
      // YouTube.js drops the formats this returns true for.
      format_filter: (format) => !format.has_video || format.has_audio || !keep.has(format.itag),
      url_transformer: (url) => {
        if (pot) url.searchParams.set('pot', pot);
        return url;
      },
      manifest_options: { include_thumbnails: false },
    });
    return { videoId, manifest, aspect: largest.width! / largest.height!, heights };
  }

  /** The SABR session: googlevideo's adapter in front of Shaka (Kira, googlevideo's example). */
  private async sabrManifest(player: shaka.Player, { videoId, client, info, yt }: ResolvedPlayer): Promise<string> {
    const streaming = info.streaming_data!;
    const sessionClient = yt.session.context.client;
    // Kira and googlevideo's example describe the session's own client here.
    const adapter = new SabrStreamingAdapter({
      playerAdapter: new ShakaPlayerAdapter(),
      clientInfo: {
        osName: sessionClient.osName,
        osVersion: sessionClient.osVersion,
        clientName: parseInt(Constants.CLIENT_NAME_IDS[sessionClient.clientName as keyof typeof Constants.CLIENT_NAME_IDS]),
        clientVersion: sessionClient.clientVersion,
      },
    });

    // The GVS token is bound to the videoId. A cold-start token answers at
    // once and the real one is minted in the background, so a VOD never
    // waits on BotGuard (Kira).
    const coldStart = await botguard.coldStartToken(videoId);
    let webPoToken: string | undefined;
    let minting = false;
    adapter.onMintPoToken(async () => {
      if (!webPoToken && !minting) {
        minting = true;
        void botguard.mint(videoId).then((token) => {
          webPoToken = token;
          minting = false;
        });
      }
      return webPoToken ?? coldStart;
    });

    adapter.onReloadPlayerResponse(async (reloadContext) => {
      trackLog.d(`SABR asked for a fresh player response (${client})`, videoId);
      const response = await playerRequest(yt, videoId, client, reloadContext);
      const reloaded = new YT.VideoInfo([response], yt.actions, Utils.generateRandomString(16));
      adapter.setStreamingURL(await yt.session.player!.decipher(reloaded.streaming_data?.server_abr_streaming_url));
      adapter.setUstreamerConfig(
        (reloaded.player_config ?? info.player_config)?.media_common_config.media_ustreamer_request_config
          ?.video_playback_ustreamer_config,
      );
    });

    adapter.attach(player);
    this.adapter = adapter;

    adapter.setStreamingURL(await yt.session.player!.decipher(streaming.server_abr_streaming_url));
    adapter.setUstreamerConfig(info.player_config?.media_common_config.media_ustreamer_request_config?.video_playback_ustreamer_config);
    adapter.setServerAbrFormats(streaming.adaptive_formats.map(buildSabrFormat));

    return info.toDash({
      manifest_options: { is_sabr: true, captions_format: 'vtt', include_thumbnails: false },
    });
  }

  /** Picks Opus 251 (else AAC 140): the preferred codec's highest bitrate, avoiding DRC renditions. */
  private selectAudio(player: shaka.Player): { label: string; stats: Omit<StreamStats, 'mode'> } {
    const tracks = player.getVariantTracks().filter((t) => !/drc/i.test(t.originalAudioId ?? ''));
    const statsOf = (t: shaka.extern.Track) => ({
      codec: codecName(t.audioCodec),
      itag: (t.originalAudioId ?? '').split('-')[0] || null,
      bitrateKbps: Math.round((t.audioBandwidth ?? t.bandwidth) / 1000) || null,
      sampleRateHz: t.audioSamplingRate,
      channels: t.channelsCount,
    });
    const bandwidth = (t: shaka.extern.Track) => t.audioBandwidth ?? t.bandwidth;
    const quality = useAudioQuality.getState().quality;
    const usable = tracks.filter((t) => this.preferredCodecs.some((c) => t.audioCodec?.startsWith(c)));
    const chosen =
      quality === 'max'
        ? [...usable].sort((a, b) => bandwidth(b) - bandwidth(a))[0]
        : quality === 'low'
          ? [...usable].sort((a, b) => bandwidth(a) - bandwidth(b))[0]
          : quality === 'normal'
            ? // The renditions nearest 128 kbps, AAC first where this browser can play it.
              [...usable.filter((t) => t.audioCodec?.startsWith('mp4a')), ...usable].sort((a, b) => Math.abs(bandwidth(a) - 128_000) - Math.abs(bandwidth(b) - 128_000))[0]
            : undefined;
    if (chosen) {
      if (!chosen.active) player.selectVariantTrack(chosen, true);
      const itag = (chosen.originalAudioId ?? '').split('-')[0];
      return { label: `${itag} ${chosen.audioCodec} ${Math.round(bandwidth(chosen) / 1000)}kbps`, stats: statsOf(chosen) };
    }
    for (const codec of this.preferredCodecs) {
      const best = tracks
        .filter((t) => t.audioCodec?.startsWith(codec))
        .sort((a, b) => (b.audioBandwidth ?? b.bandwidth) - (a.audioBandwidth ?? a.bandwidth))[0];
      if (best) {
        if (!best.active) player.selectVariantTrack(best, true);
        const itag = (best.originalAudioId ?? '').split('-')[0];
        return { label: `${itag} ${codec} ${Math.round((best.audioBandwidth ?? best.bandwidth) / 1000)}kbps`, stats: statsOf(best) };
      }
    }
    const active = player.getVariantTracks().find((t) => t.active);
    return active
      ? { label: `${active.originalAudioId} ${active.audioCodec}`, stats: statsOf(active) }
      : { label: 'unknown', stats: { codec: null, itag: null, bitrateKbps: null, sampleRateHz: null, channels: null } };
  }

  /** Resolves once the element has data to play, or rejects after the timeout. */
  private firstAudio(generation: number): Promise<void> {
    const audio = this.audio;
    if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const done = () => {
        clearTimeout(timer);
        audio.removeEventListener('canplay', done);
        if (generation !== this.generation) reject(new SupersededError('Replaced by a newer load'));
        else resolve();
      };
      const timer = setTimeout(() => {
        audio.removeEventListener('canplay', done);
        reject(new Error(`no audio within ${FIRST_AUDIO_TIMEOUT_MS / 1000}s`));
      }, FIRST_AUDIO_TIMEOUT_MS);
      audio.addEventListener('canplay', done);
    });
  }

  /**
   * After the track started: if googlevideo refused this client (HTTP 401/403,
   * or stream protection saying a token is required), exclude it and pick the
   * track up on the next client where it stopped. Anything else is the
   * server's pacing or a transient failure, which the failure callback retries.
   */
  private onShakaError(error: shaka.util.Error) {
    const current = this.current;
    const line = `Shaka error ${error.code} (severity ${error.severity}): ${describe(error)}`;
    if (!isRefusal(error)) {
      trackLog.d(line, current?.videoId ?? null);
      return;
    }
    trackLog.w(line, current?.videoId ?? null);
    if (this.loading || !current || error.severity !== shaka.util.Error.Severity.CRITICAL) return;
    // Recover once per track and client; later errors from the same stream are echoes.
    this.current = null;
    excludeClient(current.videoId, current.client, `stream error ${error.code}`, current.signed);
    const resumeAt = this.audio.currentTime;
    const wasPlaying = !this.audio.paused;
    this.load(current.videoId, { startSec: resumeAt, autoplay: wasPlaying })
      .then((track) => this.onRecovered(track))
      .catch((failure: unknown) => {
        if (failure instanceof SupersededError) return;
        void this.stop();
        this.onFatal(current.videoId, describe(failure), failure instanceof UnplayableError);
      });
  }

  async stop(): Promise<void> {
    this.generation++;
    this.current = null;
    this.direct = null;
    if (this.local) {
      // A file of your own plays from the element's own source: silence it.
      this.local = false;
      this.audio.pause();
      this.audio.removeAttribute('src');
      this.audio.load();
    }
    await this.player?.unload();
    this.adapter?.dispose();
    this.adapter = null;
  }
}

/** The codec under its usual name rather than its RFC 6381 string (the phone's codecLabel). */
function codecName(codec: string | null): string | null {
  if (!codec) return null;
  if (codec.startsWith('opus')) return 'Opus';
  if (codec.startsWith('mp4a')) return 'AAC';
  if (codec.startsWith('ec-3')) return 'E-AC-3';
  if (codec.startsWith('ac-3')) return 'AC-3';
  return codec.toUpperCase();
}

/** Whether the response carries audio URLs to fetch directly (VISIONOS does; the web clients only offer SABR). */
function hasDirectAudio(info: YT.VideoInfo): boolean {
  return !!info.streaming_data?.adaptive_formats.some((f) => f.has_audio && !f.has_video && (f.url || f.signature_cipher || f.cipher));
}

/** googlevideo saying no to this client, as opposed to pacing or a network blip. */
function isRefusal(error: shaka.util.Error): boolean {
  const status = error.data?.[1];
  if (error.code === shaka.util.Error.Code.BAD_HTTP_STATUS && (status === 401 || status === 403)) return true;
  // The adapter's "Server streaming error": stream protection status 3, a token is required.
  return error.code === shaka.util.Error.Code.HTTP_ERROR && error.data?.[0] === 'Server streaming error';
}

function describe(error: unknown): string {
  if (error instanceof shaka.util.Error) {
    const detail = error.data?.[1];
    const status = typeof detail === 'number' ? ` HTTP ${detail}` : detail instanceof Error ? ` (${detail.message})` : '';
    const uri = typeof error.data?.[0] === 'string' ? ` ${error.data[0].slice(0, 80)}` : '';
    return `Shaka ${error.code}${status}${uri}`;
  }
  return error instanceof Error ? error.message : String(error);
}
