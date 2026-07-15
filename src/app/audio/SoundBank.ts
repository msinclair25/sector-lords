/**
 * Synth SFX + theme music.
 * Desktop: Web Audio decode for playlist cross-control.
 * iOS / low-memory: HTMLAudioElement for music (decodeAudioData of ~4MB MP3s
 * expands to huge PCM and crashes Safari / iOS Chrome).
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

function isIOSLike(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/i.test(ua)) return true;
  // iPadOS desktop UA
  if (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints ?? 0) > 1) {
    return true;
  }
  return false;
}

/** Prefer streaming music on iOS / coarse mobile to avoid decode crashes */
function preferHtmlMusic(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (isIOSLike()) return true;
  try {
    if (window.matchMedia('(pointer: coarse)').matches && window.innerWidth < 900) {
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

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
  private themeMode: 'file' | 'synth' | 'html' | null = null;
  private trackIndex = 0;
  private unlocked = false;
  private unlockPromise: Promise<void> | null = null;
  private trackLoads: Map<number, Promise<AudioBuffer | null>> = new Map();
  /** Streaming music path (iOS) */
  private htmlAudio: HTMLAudioElement | null = null;
  private useHtmlMusic = preferHtmlMusic();
  private gestureBound = false;

  constructor() {
    this.loadPreference();
    this.bindGestureUnlock();
  }

  /** First touch/click anywhere unlocks WebAudio — required on iOS */
  private bindGestureUnlock(): void {
    if (typeof window === 'undefined' || this.gestureBound) return;
    this.gestureBound = true;
    const kick = () => {
      void this.unlock();
    };
    window.addEventListener('touchstart', kick, { passive: true, capture: true });
    window.addEventListener('pointerdown', kick, { passive: true, capture: true });
    window.addEventListener('keydown', kick, { passive: true, capture: true });
    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.visibilityState === 'visible' && this.ctx?.state === 'suspended') {
          void this.ctx.resume();
        }
        if (document.visibilityState === 'hidden' && this.htmlAudio && !this.htmlAudio.paused) {
          // Don't stop permanently — just pause to reduce background kills
          try {
            this.htmlAudio.pause();
          } catch {
            /* ignore */
          }
        }
        if (document.visibilityState === 'visible' && this.musicOn && this.htmlAudio) {
          void this.htmlAudio.play().catch(() => undefined);
        }
      },
      false,
    );
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
    if (this.themeMode === 'file' || this.themeMode === 'html') {
      const title = THEME_TRACKS[this.trackIndex]?.title ?? 'Theme';
      return { title, mode: 'file', index: this.trackIndex };
    }
    return {
      title: THEME_TRACKS[this.trackIndex]?.title ?? 'Theme',
      mode: 'idle',
      index: this.trackIndex,
    };
  }

  getPlaylist(): ReadonlyArray<{ title: string }> {
    return THEME_TRACKS.map((t) => ({ title: t.title }));
  }

  private emitTrackChange(): void {
    try {
      const np = this.getNowPlaying();
      window.dispatchEvent(new CustomEvent('sl-music-track', { detail: np }));
    } catch {
      /* ignore */
    }
  }

  loadPreference(): void {
    try {
      if (localStorage.getItem(SFX_KEY) === '0') this.sfxOn = false;
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
          if (!AC) {
            // Still mark unlocked for HTMLAudio path
            this.unlocked = true;
            return;
          }
          this.ctx = new AC({ latencyHint: 'interactive' } as AudioContextOptions);
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
          // Desktop only: prefetch first theme as AudioBuffer
          if (!this.useHtmlMusic) {
            void this.ensureTrack(0).catch(() => undefined);
          }
        } else {
          this.unlocked = true; // allow HTMLAudio attempt
        }
      } catch (e) {
        console.warn('[Sector Lords] audio unlock failed', e);
        this.unlocked = true;
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
      try {
        this.ctx = new AC({ latencyHint: 'interactive' } as AudioContextOptions);
      } catch {
        this.ctx = new AC();
      }
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
    // Skip noise bursts on iOS — allocate less short-lived audio memory
    if (this.useHtmlMusic) {
      this.tone(180, Math.min(0.08, dur), 'square', gain * 0.8, delay);
      return;
    }
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
        this.tone(640, 0.1, 'triangle', 0.16, 0.06);
        break;
      case 'attack':
        this.noise(0.1, 0.16);
        this.tone(140, 0.12, 'sawtooth', 0.22, 0.02);
        break;
      case 'unrest':
        this.tone(200, 0.1, 'square', 0.18);
        this.tone(160, 0.14, 'sawtooth', 0.14, 0.08);
        break;
      case 'research':
        this.tone(880, 0.05, 'sine', 0.14);
        this.tone(1175, 0.08, 'sine', 0.12, 0.05);
        break;
      case 'combat':
        this.noise(0.12, 0.2);
        this.tone(90, 0.15, 'sawtooth', 0.24);
        break;
      case 'win':
        this.tone(523, 0.1, 'triangle', 0.2);
        this.tone(659, 0.12, 'triangle', 0.18, 0.08);
        this.tone(784, 0.16, 'triangle', 0.16, 0.16);
        break;
      case 'lose':
        this.tone(200, 0.2, 'sawtooth', 0.18);
        this.tone(140, 0.25, 'triangle', 0.14, 0.1);
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

  /** Load a single playlist track on demand (desktop Web Audio path only). */
  private ensureTrack(index: number): Promise<AudioBuffer | null> {
    if (this.useHtmlMusic) return Promise.resolve(null);
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
        // iOS sometimes needs a copy; desktop ok with slice
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
    if (this.themeMode === 'html' && this.htmlAudio && !this.htmlAudio.paused) return;
    if (this.themeMode === 'synth' && this.musicBus) return;

    void this.unlock().then(() => {
      if (this.useHtmlMusic) {
        this.playHtmlTrack(this.trackIndex);
        return;
      }
      void this.ensureTrack(this.trackIndex)
        .then((buf) => {
          if (buf) this.playTrack(this.trackIndex);
          else {
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
    });
  }

  /** iOS-safe streaming music — no full-file PCM decode. */
  private playHtmlTrack(index: number): void {
    if (!this.musicOn) return;
    const track = THEME_TRACKS[index];
    if (!track) {
      this.startSynthMusic();
      return;
    }

    this.stopMusicInternal(true);
    this.trackIndex = index;
    this.themeMode = 'html';

    const audio = new Audio();
    audio.preload = 'auto';
    audio.src = track.url;
    audio.loop = false;
    audio.volume = Math.min(1, MUSIC_GAIN * this.master * 1.35);
    // playsInline helps iOS not force fullscreen video-style playback
    audio.setAttribute('playsinline', 'true');
    audio.setAttribute('webkit-playsinline', 'true');

    const next = this.nextTrackIndex(index);
    audio.onended = () => {
      if (this.htmlAudio !== audio) return;
      if (!this.musicOn) return;
      this.playHtmlTrack(next);
    };
    audio.onerror = () => {
      console.warn(`[Sector Lords] HTMLAudio failed: ${track.title}`);
      if (this.htmlAudio === audio) {
        this.htmlAudio = null;
        // Try alt then synth
        if (next !== index) this.playHtmlTrack(next);
        else this.startSynthMusic();
      }
    };

    this.htmlAudio = audio;
    const playAttempt = audio.play();
    if (playAttempt && typeof playAttempt.then === 'function') {
      void playAttempt
        .then(() => {
          console.info(`[Sector Lords] theme playing (html): ${track.title}`);
          this.emitTrackChange();
        })
        .catch((err) => {
          console.warn('[Sector Lords] HTMLAudio play blocked', err);
          // One more unlock+retry after gesture
          void this.unlock().then(() => {
            void audio.play().catch(() => this.startSynthMusic());
          });
        });
    } else {
      this.emitTrackChange();
    }
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
    // Prefetch next only on desktop Web Audio path
    void this.ensureTrack(next);

    src.onended = () => {
      if (this.themeSource !== src) return;
      this.themeSource = null;
      if (!this.musicOn || this.themeMode !== 'file') return;
      // Free previous buffer on memory-constrained path (keep current index ready)
      void this.ensureTrack(next).then((b) => {
        if (!this.musicOn) return;
        if (b) this.playTrack(next);
        else this.playTrack(index);
      });
    };

    console.info(`[Sector Lords] theme playing: ${meta.title}`);
    this.emitTrackChange();
  }

  private startSynthMusic(): void {
    if (!this.musicOn) return;
    if (this.musicBus && this.themeMode === 'synth') return;
    const c = this.ensure();
    if (!c || c.state === 'suspended') {
      void this.unlock().then(() => this.startSynthMusic());
      return;
    }

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

    if (this.htmlAudio) {
      try {
        this.htmlAudio.onended = null;
        this.htmlAudio.onerror = null;
        this.htmlAudio.pause();
        this.htmlAudio.removeAttribute('src');
        this.htmlAudio.load();
      } catch {
        /* ignore */
      }
      this.htmlAudio = null;
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
