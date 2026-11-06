/**
 * The listener's own audio files (desktop app: Local Files). A file plays under the id `local:<id>` wherever a
 * YouTube videoId would: the queue, the player, the lyrics lookup. These helpers tell the two apart.
 */
export const LOCAL_PREFIX = 'local:';

export const isLocalId = (videoId: string | null | undefined): boolean => !!videoId && videoId.startsWith(LOCAL_PREFIX);

export const localIdOf = (videoId: string): string => videoId.slice(LOCAL_PREFIX.length);

/** Where the desktop app serves the file's audio from, on its own origin. */
export const localAudioUrl = (videoId: string): string => `/__local/audio/${localIdOf(videoId)}`;
