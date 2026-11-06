import { create } from 'zustand';

/**
 * Which of a song's audio renditions to stream. `high` is Opus at its top bitrate (itag 251, about 130-160 kbps);
 * `max` takes the highest bitrate of any codec, which is the 256 kbps AAC where the account is entitled to it;
 * `normal` is the 128 kbps AAC; `low` is the smallest rendition, for slow or metered connections.
 */
export type AudioQuality = 'max' | 'high' | 'normal' | 'low';

export const AUDIO_QUALITIES: { value: AudioQuality; label: string }[] = [
  { value: 'max', label: 'Maximum' },
  { value: 'high', label: 'High (Opus)' },
  { value: 'normal', label: 'Normal (AAC 128)' },
  { value: 'low', label: 'Data Saver' },
];

const KEY = 'kurapify:audio-quality';

function stored(): AudioQuality {
  try {
    const value = localStorage.getItem(KEY);
    if (value && AUDIO_QUALITIES.some((q) => q.value === value)) return value as AudioQuality;
  } catch {
    // storage unavailable: the default
  }
  return 'max';
}

export const useAudioQuality = create<{ quality: AudioQuality }>()(() => ({ quality: stored() }));

/** Applies from the next song that starts loading. */
export function setAudioQuality(quality: AudioQuality): void {
  try {
    localStorage.setItem(KEY, quality);
  } catch {
    // remembered for this session only
  }
  useAudioQuality.setState({ quality });
}
