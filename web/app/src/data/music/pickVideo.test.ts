import { describe, expect, it } from 'vitest';
import { pickVideo } from './api';

const video = (id: string, title: string, author: string, seconds: number, views = '1M views') => ({
  id,
  item_type: 'video',
  title,
  authors: [{ name: author }],
  duration: { seconds },
  views,
});

// What a video search for "ILLIT You’re Under Arrest" returned, in order.
const results = [
  video('mv', 'You’re Under Arrest', 'ILLIT', 190, '16M views'),
  video('lyrics', 'ILLIT ‘You’re under arrest’ Color Coded Lyrics', 'sunbellio', 182, '3.2K views'),
  video('bank', 'ILLIT - YOU\'RE UNDER ARREST | Music Bank EP1311 | KOCOWA+ ESPAÑOL', 'KOCOWA en Español', 211, '8.5K views'),
  video('mirror', 'ILLIT - \'YOU\'RE UNDER ARREST\' DANCE PERFORMANCE (MIRRORED)', '', 180, '169 views'),
  video('sped', 'illit - you\'re under arrest (sped up + reverb)', 'c l o v d h y', 158, '4.9K views'),
  video('fan', 'Illit - You’re Under Arrest (Full Song)', 'Wonhee-holic', 182, '49K views'),
  video('choom', 'ILLIT(아일릿) \'체포하겠어 (You\'re Under Arrest)\' (4K) | STUDIO CHOOM ORIGINAL', 'STUDIO CHOOM [스튜디오 춤]', 212, '5.6M views'),
  video('multicam', 'ILLIT (아일릿) \'체포하겠어 (You’re Under Arrest)\' | MULTI-CAM | PRESS START♥︎ ENCORE', 'ILLIT', 188, '3.6M views'),
  video('kbs', '[COMEBACK] ILLIT アイルリット 아일릿 - You’re Under Arrest [Music Bank] | KBS WORLD TV 261030', 'KBS WORLD TV', 213, '311K views'),
];

const pick = (items: Record<string, unknown>[]) => (pickVideo(items, 'You’re Under Arrest', 'ILLIT', 182)?.item.id as string | undefined) ?? null;

describe('pickVideo', () => {
  it('takes the music video over lyric videos, stages, covers and fan uploads', () => {
    expect(pick(results)).toBe('mv');
    expect(pick([...results].reverse())).toBe('mv');
  });

  it('finds the video when its title carries the whole upload name and the label uploaded it', () => {
    const official = video('official', 'ILLIT (아일릿) \'체포하겠어 (You’re Under Arrest)’ Official MV', 'HYBE LABELS', 189, '16M views');
    expect(pick([...results.slice(1), official])).toBe('official');
  });

  it('does not take a dance cam or a multi-cam when the music video is not among the results', () => {
    expect(pick(results.slice(1))).not.toBe('choom');
    expect(pick(results.slice(1))).not.toBe('bank');
    expect(pick(results.slice(1))).not.toBe('kbs');
    expect(pick(results.slice(1))).not.toBe('lyrics');
  });

  it('prefers the official music video to a performance video of the same name', () => {
    const items = [
      video('perf', 'Money (Performance Video)', 'LISA', 190, '300M views'),
      video('mv', 'MONEY (Official Music Video)', 'LISA', 190, '200M views'),
    ];
    expect(pickVideo(items, 'MONEY', 'LISA', 190)?.item.id).toBe('mv');
  });
});
