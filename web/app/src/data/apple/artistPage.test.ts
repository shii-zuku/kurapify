import { describe, expect, it } from 'vitest';
import { parseArtistPage } from './artistPage';

/** The shape AppleArtistArt.kt reads: the header sits somewhere in the page's hydration JSON. */
function page(header: object): string {
  const data = [{ intent: {}, data: { sections: [{ id: 'header', items: [header] }] } }];
  return `<html><script type="application/json" id="serialized-server-data">${JSON.stringify(data)}</script></html>`;
}

const hero = { url: 'https://is1-ssl.mzstatic.com/image/thumb/a/{w}x{h}{c}.{f}', width: 4320, height: 1080, bgColor: '1a2b3c', textColor1: 'f0e0d0' };

describe('parseArtistPage', () => {
  it('reads the photo, the title logo and Apple’s colours', () => {
    const art = parseArtistPage(
      page({
        artistLogo: { dictionary: { url: 'https://is1-ssl.mzstatic.com/image/thumb/logo/{w}x{h}{c}.{f}', width: 2000, height: 500 } },
        artwork: { dictionary: hero },
        keyColor: 'FA2D48',
      }),
    );
    expect(art).toEqual({
      heroUrl: 'https://is1-ssl.mzstatic.com/image/thumb/a/1200x300bb.jpg',
      heroAspect: 4,
      logoUrl: 'https://is1-ssl.mzstatic.com/image/thumb/logo/1000x250bb.png',
      logoAspect: 4,
      background: '#1a2b3c',
      accent: '#f0e0d0',
      keyColor: '#fa2d48',
      video: null,
      bio: null,
      latest: null,
      songs: [],
    });
  });

  it('keeps the photo for an artist with no logo and no key colour', () => {
    const art = parseArtistPage(page({ artistLogo: null, artwork: { dictionary: hero } }));
    expect(art?.logoUrl).toBeNull();
    expect(art?.keyColor).toBeNull();
    expect(art?.background).toBe('#1a2b3c');
  });

  it('reads the moving header and takes its colours', () => {
    const frame = { url: 'https://is1-ssl.mzstatic.com/image/thumb/v/{w}x{h}{c}.{f}', width: 3840, height: 2160, bgColor: '081a30', textColor1: 'afcadf' };
    const art = parseArtistPage(
      page({
        artistLogo: null,
        artwork: { dictionary: hero },
        wideVideoArtwork: { dictionary: { motionArtistWide16x9: { previewFrame: frame, video: 'https://mvod.itunes.apple.com/a/b/c.m3u8' } } },
      }),
    );
    expect(art?.video).toEqual({ url: 'https://mvod.itunes.apple.com/a/b/c.m3u8', posterUrl: 'https://is1-ssl.mzstatic.com/image/thumb/v/1600x900bb.jpg', aspect: 3840 / 2160 });
    expect(art?.background).toBe('#081a30');
    expect(art?.accent).toBe('#afcadf');
    expect(art?.heroUrl).toContain('1200x300bb.jpg');
  });

  it('falls back to the colour backdrop artwork', () => {
    const art = parseArtistPage(page({ artistLogo: null, artwork: null, colorBackdropArtwork: { dictionary: hero } }));
    expect(art?.heroUrl).toContain('1200x300bb.jpg');
  });

  it('is nothing for a page without the header or with broken JSON', () => {
    expect(parseArtistPage('<html></html>')).toBeNull();
    expect(parseArtistPage('<script id="serialized-server-data">{nope</script>')).toBeNull();
    expect(parseArtistPage(page({ artistLogo: null, artwork: { dictionary: { ...hero, bgColor: '' } } }))).toBeNull();
  });
});
