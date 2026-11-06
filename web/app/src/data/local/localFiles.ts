import type { LocalFile } from '@kurapify/shared/bridge';
import { useMutation, useQuery } from '@tanstack/react-query';
import { getBridge } from '@/extension/bridge';
import { useExtension } from '@/extension/useExtension';
import { queryClient } from '@/lib/queryClient';
import { LOCAL_PREFIX } from './ids';
import type { Track } from '../music/types';

const key = ['local', 'files'] as const;

/** Whether this app can hold the listener's own files at all (the desktop app can; the browser extension can't). */
export function useLocalSupported(): boolean {
  const status = useExtension();
  return status.state === 'present' && status.extension.info.capabilities.includes('local');
}

/** The files added so far, newest first. */
export function useLocalFiles() {
  const supported = useLocalSupported();
  return useQuery({
    queryKey: key,
    queryFn: async () => ((await getBridge()?.call('local.list', {})) ?? []).sort((a, b) => b.addedAt - a.addedAt),
    enabled: supported,
    staleTime: Infinity,
  });
}

const adopt = (files: LocalFile[]) => queryClient.setQueryData(key, [...files].sort((a, b) => b.addedAt - a.addedAt));

/** Opens the system's dialog for files, or for folders, and adds what is chosen. */
export function useAddLocalFiles() {
  return useMutation({
    mutationFn: async (folder: boolean) => {
      const bridge = getBridge();
      if (!bridge) throw new Error('Local files need the Kurapify desktop app');
      return bridge.call('local.pick', { folder }, { timeoutMs: 10 * 60_000 });
    },
    onSuccess: adopt,
  });
}

export function useRemoveLocalFile() {
  return useMutation({
    mutationFn: async (id: string) => {
      const bridge = getBridge();
      if (!bridge) throw new Error('Local files need the Kurapify desktop app');
      return bridge.call('local.remove', { id });
    },
    onSuccess: adopt,
  });
}

/** A file as the rest of the app's track rows know it. */
export function trackOfLocal(file: LocalFile, index: number | null = null): Track {
  return {
    videoId: `${LOCAL_PREFIX}${file.id}`,
    title: file.title,
    artists: file.artist ? [{ name: file.artist, id: null }] : [],
    album: file.album ? { name: file.album, id: null } : null,
    durationSec: file.durationSec || null,
    explicit: false,
    thumbnail: file.cover ? `/__local/cover/${file.id}` : null,
    index,
    plays: null,
  };
}

/** "FLAC · 44.1 kHz · 1,011 kbps" for the row's tooltip and the stream stats. */
export function describeLocal(file: LocalFile): string {
  const parts = [file.lossless ? `${file.format} (lossless)` : file.format];
  if (file.sampleRateHz) parts.push(`${(file.sampleRateHz / 1000).toFixed(file.sampleRateHz % 1000 ? 1 : 0)} kHz`);
  if (file.bitrateKbps) parts.push(`${file.bitrateKbps.toLocaleString('en')} kbps`);
  return parts.join(' · ');
}
