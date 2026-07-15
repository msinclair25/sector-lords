/**
 * Synth SFX + looped theme music via Web Audio API.
 * Theme is decoded into an AudioBuffer so it works after AudioContext unlock
 * (HTMLAudioElement.play() often fails after async unlock).
 */

import { assetUrl } from '../assetUrl';

export type Sfx =
  | 'ui'
  | 'hire'
  | 'claim'
  | 'attack'
  | 'unrest'
  | 'research'
  | 'combat'
  | 'win'
  | 'lose'
  | 'endTurn'
  | 'event'
  | 'error';

const SFX_KEY = 'sector-lords-sfx';
const MUSIC_KEY = 'sector-lords-music';

/** War-table playlist — plays in order, then loops the list */
const THEME_TRACKS: ReadonlyArray<{ url: string; title: string }> = [
  { url: assetUrl('assets/audio/The_Iron_Litany.mp3'), title: 'The Iron Litany' },
  { url: assetUrl('assets/audio/Iron_Vesper.mp3'), title: 'Iron Vesper' },
];
/** Music bus gain (0–1 before master) */
const MUSIC_GAIN = 0.55;

class SoundBankImpl {
  private ctx: AudioContext | null = null;
  private sfxOn = true;
  private musicOn = true;
  private master = 0.4;
  private musicBus: GainNode | null = null;
  private musicNodes: AudioNode[] = [];
  private musicTimer: number | null = null;
  private themeBuffers: (AudioBuffer | null)[] = THEME_TRACKS.map(() => null);
  private themeSource: AudioBufferSourceNode | null = null;
  private themeMode: 'file' | 'synth' | null = null;
  private trackIndex = 0;
  private unlocked = false;
  private unlockPromise: Promise<void> | null = null;

  constructor() {
    this.loadPreference();
  }

  setEnabled(on: boolean): void {
    this.sfxOn = on;
    try {
      localStorage.setItem(SFX_KEY, on ? '1' : '0');
    } catch {
      /* ignore */
    }
  }

  isEnabled(): boolean {
    return this.sfxOn;
  }

  setMusicEnabled(on: boolean): void {
    this.musicOn = on;
    try {
      localStorage.setItem(MUSIC_KEY, on ? '1' : '0');
    } catch {
      /* ignore */
    }
    if (on) {
      void this.unlock().then(() => this.startMusic());
    } else {
      this.stopMusic();
      this.emitTrackChange();
    }
  }

  isMusicEnabled(): boolean {
    return this.musicOn;
  }

  /**
   * What's on the music bus right now (for HUD "now playing").
   */
  getNowPlaying(): {
    title: string;
    mode: 'file' | 'synth' | 'off' | 'idle';
    index: number;
  } {
    if (!this.musicOn) {
      return { title: 'Music off', mode: 'off', index: this.trackIndex };
    }
    if (this.themeMode === 'synth') {
      return { title: 'Synth ambient', mode: 'synth', index: -1 };
    }
    if (this.themeMode === 'file') {
      const title = THEME_TRACKS[this.trackIndex]?.title ?? 'Theme';
      return { title, mode: 'file', index: this.trackIndex };
    }
    return {
      title: THEME_TRACKS[this.trackIndex]?.title ?? 'Theme',
      mode: 'idle',
      index: this.trackIndex,
    };
  }

  /** Playlist titles (read-only). */
  getPlaylist(): ReadonlyArray<{ title: string }> {
    return THEME_TRACKS.map((t) => ({ title: t.title }));
  }

  private emitTrackChange(): void {
    try {
      const np = this.getNowPlaying();
      window.dispatchEvent(
        new CustomEvent('sl-music-track', { detail: np }),
      );
    } catch {
      /* ignore */
    }
  }

  loadPreference(): void {
    try {
      if (localStorage.getItem(SFX_KEY) === '0') this.sfxOn = false;
      // Default ON unless explicitly disabled
      const m = localStorage.getItem(MUSIC_KEY);
      if (m === '0') this.musicOn = false;
      else this.musicOn = true;
    } catch {
      /* ignore */
    }
  }

  /**
   * Call from any click/key handler. Required by browser autoplay policy.
   */
  async unlock(): Promise<void> {
    if (this.unlocked && this.ctx?.state === 'running') return;
    if (this.unlockPromise) return this.unlockPromise;

    this.unlockPromise = (async () => {
      try {
        if (!this.ctx) {
          const AC =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext })
              .webkitAudioContext;
          if (!AC) return;
          this.ctx = new AC();
        }
        if (this.ctx.state === 'suspended') {
          await this.ctx.resume();
        }
        if (this.ctx.state === 'running') {
          const g = this.ctx.createGain();
          g.gain.value = 0.0001;
          const o = this.ctx.createOscillator();
          o.connect(g);
          g.connect(this.ctx.destination);
          o.start();
          o.stop(this.ctx.currentTime + 0.02);
          this.unlocked = true;
          // Prefetch only the first theme track (second loads while first plays)
          void this.ensureTrack(0).catch(() => undefined);
        }
      } catch (e) {
        console.warn('[Sector Lords] audio unlock failed', e);
      } finally {
        this.unlockPromise = null;
      }
    })();

    return this.unlockPromise;
  }

  private ensure(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  private tone(
    freq: number,
    dur: number,
    type: OscillatorType = 'square',
    gain = 0.2,
    delay = 0,
  ): void {
    if (!this.sfxOn) return;
    const ctx = this.ensure();
    if (!ctx || ctx.state === 'suspended') {
      void this.unlock().then(() => {
        if (!this.sfxOn) return;
        this.toneNow(freq, dur, type, gain, delay);
      });
      return;
    }
    this.toneNow(freq, dur, type, gain, delay);
  }

  private toneNow(
    freq: number,
    dur: number,
    type: OscillatorType,
    gain: number,
    delay: number,
  ): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = Math.min(4200, freq * 4);

    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain * this.master), t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    osc.connect(filter);
    filter.connect(g);
    g.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  private noise(dur: number, gain = 0.12, delay = 0): void {
    if (!this.sfxOn) return;
    const ctx = this.ensure();
    if (!ctx || ctx.state === 'suspended') return;
    const t0 = ctx.currentTime + delay;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 900;
    f.Q.value = 0.6;
    g.gain.setValueAtTime(gain * this.master, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(ctx.destination);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  play(sfx: Sfx): void {
    if (!this.sfxOn) return;
    void this.unlock().then(() => this.playNow(sfx));
  }

  private playNow(sfx: Sfx): void {
    switch (sfx) {
      case 'ui':
        this.tone(720, 0.06, 'triangle', 0.22);
        break;
      case 'hire':
        this.tone(392, 0.09, 'square', 0.2);
        this.tone(523, 0.12, 'square', 0.18, 0.07);
        this.tone(659, 0.1, 'triangle', 0.14, 0.14);
        break;
      case 'claim':
        this.tone(480, 0.08, 'sawtooth', 0.18);
        this.tone(720, 0.14, 'sawtooth', 0.16, 0.06);
        break;
      case 'attack':
        this.noise(0.08, 0.14);
        this.tone(160, 0.14, 'sawtooth', 0.28);
        this.tone(90, 0.18, 'square', 0.2, 0.05);
        break;
      case 'unrest':
        this.tone(200, 0.09, 'triangle', 0.2);
        this.tone(260, 0.09, 'triangle', 0.16, 0.05);
        this.tone(330, 0.12, 'triangle', 0.14, 0.1);
        break;
      case 'research':
        this.tone(523, 0.07, 'sine', 0.18);
        this.tone(659, 0.07, 'sine', 0.16, 0.06);
        this.tone(784, 0.12, 'sine', 0.16, 0.12);
        break;
      case 'combat':
        this.noise(0.12, 0.18);
        this.tone(80, 0.2, 'sawtooth', 0.3);
        this.tone(180, 0.12, 'square', 0.22, 0.08);
        this.tone(55, 0.22, 'triangle', 0.18, 0.12);
        break;
      case 'win':
        this.tone(523, 0.12, 'square', 0.22);
        this.tone(659, 0.12, 'square', 0.22, 0.1);
        this.tone(784, 0.2, 'square', 0.24, 0.2);
        break;
      case 'lose':
        this.tone(280, 0.16, 'sawtooth', 0.22);
        this.tone(200, 0.2, 'sawtooth', 0.18, 0.12);
        this.tone(130, 0.28, 'triangle', 0.18, 0.25);
        break;
      case 'endTurn':
        this.tone(330, 0.07, 'triangle', 0.2);
        this.tone(440, 0.12, 'triangle', 0.18, 0.07);
        this.tone(550, 0.08, 'sine', 0.12, 0.14);
        break;
      case 'event':
        this.tone(880, 0.06, 'sine', 0.18);
        this.tone(440, 0.14, 'sine', 0.16, 0.08);
        break;
      case 'error':
        this.tone(120, 0.14, 'square', 0.22);
        this.tone(90, 0.1, 'square', 0.16, 0.08);
        break;
      default:
        break;
    }
  }

  private trackLoads: Map<number, Promise<AudioBuffer | null>> = new Map();

  /** Load a single playlist track on demand (avoids decoding ~8MB of audio at once). */
  private ensureTrack(index: number): Promise<AudioBuffer | null> {
    if (this.themeBuffers[index]) return Promise.resolve(this.themeBuffers[index]!);
    const existing = this.trackLoads.get(index);
    if (existing) return existing;

    const load = (async () => {
      const track = THEME_TRACKS[index];
      if (!track) return null;
      const ctx = this.ensure();
      if (!ctx) return null;
      try {
        const res = await fetch(track.url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const raw = await res.arrayBuffer();
        const decoded = await ctx.decodeAudioData(raw.slice(0));
        this.themeBuffers[index] = decoded;
        return decoded;
      } catch (err) {
        console.warn(`[Sector Lords] track failed: ${track.title}`, err);
        return null;
      } finally {
        this.trackLoads.delete(index);
      }
    })();

    this.trackLoads.set(index, load);
    return load;
  }

  private nextTrackIndex(from: number): number {
    return (from + 1) % THEME_TRACKS.length;
  }

  /** Playlist: Iron Litany → Iron Vesper → … with synth fallback. */
  startMusic(): void {
    if (!this.musicOn) {
      console.info('[Sector Lords] music is OFF — toggle MUSIC on the menu');
      return;
    }
    if (this.themeMode === 'file' && this.themeSource) return;
    if (this.themeMode === 'synth' && this.musicBus) return;

    void this.unlock()
      .then(() => this.ensureTrack(this.trackIndex))
      .then((buf) => {
        if (buf) this.playTrack(this.trackIndex);
        else {
          // Try the other track once before synth
          const alt = this.nextTrackIndex(this.trackIndex);
          return this.ensureTrack(alt).then((b2) => {
            if (b2) this.playTrack(alt);
            else throw new Error('no tracks');
          });
        }
      })
      .catch(() => {
        console.warn('[Sector Lords] falling back to synth music');
        this.startSynthMusic();
      });
  }

  private playTrack(index: number): void {
    if (!this.musicOn) return;
    const buf = this.themeBuffers[index];
    if (!buf) {
      void this.ensureTrack(index).then((b) => {
        if (b) this.playTrack(index);
        else this.startSynthMusic();
      });
      return;
    }

    const ctx = this.ensure();
    if (!ctx || ctx.state === 'suspended') {
      void this.unlock().then(() => this.playTrack(index));
      return;
    }

    this.stopMusicInternal(true);

    const bus = ctx.createGain();
    bus.gain.value = 0.0001;
    bus.connect(ctx.destination);

    const src = ctx.createBufferSource();
    src.buffer = buf;
    // Playlist advances on end (no single-track loop)
    src.loop = false;
    src.connect(bus);
    src.start(0);

    const target = MUSIC_GAIN * this.master * 1.4;
    bus.gain.exponentialRampToValueAtTime(Math.max(0.001, target), ctx.currentTime + 1.0);

    this.musicBus = bus;
    this.themeSource = src;
    this.themeMode = 'file';
    this.trackIndex = index;
    this.musicNodes = [src, bus];

    const meta = THEME_TRACKS[index]!;
    const next = this.nextTrackIndex(index);
    // Prefetch the next track while this one plays
    void this.ensureTrack(next);

    src.onended = () => {
      if (this.themeSource !== src) return;
      this.themeSource = null;
      if (!this.musicOn || this.themeMode !== 'file') return;
      void this.ensureTrack(next).then((b) => {
        if (!this.musicOn) return;
        if (b) this.playTrack(next);
        else this.playTrack(index); // retry same if next missing
      });
    };

    console.info(`[Sector Lords] theme playing: ${meta.title}`);
    this.emitTrackChange();
  }

  /** Procedural cyberpunk drone — used only if the MP3 fails. */
  private startSynthMusic(): void {
    if (!this.musicOn) return;
    if (this.musicBus && this.themeMode === 'synth') return;
    const c = this.ensure();
    if (!c || c.state === 'suspended') return;

    this.stopMusicInternal(true);
    this.themeMode = 'synth';

    const master = c.createGain();
    master.gain.value = 0.0001;
    master.connect(c.destination);
    master.gain.exponentialRampToValueAtTime(0.12 * this.master * 2, c.currentTime + 1.0);
    this.musicBus = master;

    const mkPad = (freq: number, type: OscillatorType, gain: number, detune = 0) => {
      const o = c.createOscillator();
      const g = c.createGain();
      const f = c.createBiquadFilter();
      o.type = type;
      o.frequency.value = freq;
      o.detune.value = detune;
      f.type = 'lowpass';
      f.frequency.value = 900;
      g.gain.value = gain;
      o.connect(f);
      f.connect(g);
      g.connect(master);
      o.start();
      this.musicNodes.push(o, g, f);
      return { o, g, f };
    };

    mkPad(55, 'sawtooth', 0.22, 0);
    mkPad(82.5, 'triangle', 0.14, -4);
    mkPad(110, 'sine', 0.1, 0);

    this.musicNodes.push(master);
    this.emitTrackChange();
  }

  stopMusic(): void {
    this.stopMusicInternal(false);
  }

  private stopMusicInternal(immediate: boolean): void {
    if (this.musicTimer != null) {
      window.clearInterval(this.musicTimer);
      this.musicTimer = null;
    }

    const ctx = this.ctx;
    const bus = this.musicBus;
    const src = this.themeSource;

    if (ctx && bus) {
      try {
        bus.gain.cancelScheduledValues(ctx.currentTime);
        bus.gain.setValueAtTime(Math.max(0.0001, bus.gain.value), ctx.currentTime);
        bus.gain.exponentialRampToValueAtTime(
          0.0001,
          ctx.currentTime + (immediate ? 0.04 : 0.35),
        );
      } catch {
        /* ignore */
      }
    }

    const cleanup = () => {
      if (src) {
        try {
          src.stop();
        } catch {
          /* ignore */
        }
        try {
          src.disconnect();
        } catch {
          /* ignore */
        }
      }
      for (const n of this.musicNodes) {
        try {
          if ('stop' in n && typeof (n as OscillatorNode).stop === 'function') {
            try {
              (n as OscillatorNode).stop();
            } catch {
              /* already stopped */
            }
          }
          n.disconnect();
        } catch {
          /* ignore */
        }
      }
      this.musicNodes = [];
      this.themeSource = null;
      this.musicBus = null;
      this.themeMode = null;
    };

    if (immediate) cleanup();
    else window.setTimeout(cleanup, 400);
  }
}

export const SFX = new SoundBankImpl();
