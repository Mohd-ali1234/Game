// =====================================================================
// client/src/voice.ts
// Proximity voice chat using WebRTC (peer-to-peer audio between players).
//
// How it works:
//  - Every player makes one direct connection ("peer") to every other player.
//  - The game server only passes the little setup messages ("signaling").
//  - The audio from each peer goes through a volume knob (GainNode) that the
//    game turns up when that player is close and down to silence when far.
// =====================================================================
import type { Socket } from 'socket.io-client';

// ---------------------------------------------------------------------
// ICE servers = helpers that let two phones find a path to each other.
// STUN (free, Google) works for most home Wi-Fi / mobile networks.
//
// TURN: some mobile networks / strict firewalls block direct connections,
// so voice just won't connect for those players. A TURN server relays the
// audio instead. TURN is NOT free to host, so it's left off for now.
// When you get one (e.g. a free-tier plan from a TURN provider), uncomment
// the entry below and fill in your details.
// ---------------------------------------------------------------------
export const ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  // {
  //   urls: 'turn:your-turn-server.example.com:3478',
  //   username: 'your-username',
  //   credential: 'your-password',
  // },
];

export const HEAR_FULL = 3; // closer than this (meters): full volume
export const HEAR_MAX = 10.5; // farther than this: silence

interface Peer {
  pc: RTCPeerConnection;
  pendingIce: RTCIceCandidateInit[]; // candidates that arrived before the remote description
  remoteSet: boolean;
  audioEl?: HTMLAudioElement;
  src?: MediaStreamAudioSourceNode;
  gain?: GainNode;
  analyser?: AnalyserNode;
  buf?: Uint8Array;
  lastSpoke: number;
  volume: number; // current 0..1 volume knob
}

export type MicState = 'unasked' | 'on' | 'denied' | 'unsupported';

export class Voice {
  micState: MicState = 'unasked';
  muted = false;
  log: (msg: string) => void = () => {};

  private ac: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private socket: Socket | null = null;
  private peers = new Map<number, Peer>();
  private localAnalyser: AnalyserNode | null = null;
  private localBuf: Uint8Array | null = null;
  private localLastSpoke = 0;

  /** Call from a button tap: phones only allow audio after a user gesture. */
  unlockAudio() {
    try {
      if (!this.ac) {
        const Ctor = window.AudioContext || (window as any).webkitAudioContext;
        this.ac = new Ctor();
      }
      void this.ac.resume();
    } catch (e) {
      this.log('AudioContext error: ' + e);
    }
  }

  /** Ask for the microphone. Returns true if we got it. */
  async requestMic(): Promise<boolean> {
    if (!navigator.mediaDevices?.getUserMedia) {
      this.micState = 'unsupported';
      this.log('Microphone not supported here (needs https).');
      return false;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      this.micState = 'on';
      this.unlockAudio();
      if (this.ac) {
        // Watch our own mic level so we can show our own "speaking" icon
        const src = this.ac.createMediaStreamSource(this.stream);
        this.localAnalyser = this.ac.createAnalyser();
        this.localAnalyser.fftSize = 512;
        this.localBuf = new Uint8Array(this.localAnalyser.fftSize);
        src.connect(this.localAnalyser); // (not connected to speakers -> no self-echo)
      }
      return true;
    } catch (e) {
      this.micState = 'denied';
      this.log('Microphone denied: ' + e);
      return false;
    }
  }

  /** Tell the voice system which socket + which player slot we are. */
  attach(socket: Socket) {
    this.socket = socket;
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    this.stream?.getAudioTracks().forEach((t) => (t.enabled = !muted));
  }

  private level(an: AnalyserNode | undefined | null, buf: Uint8Array | undefined | null): number {
    if (!an || !buf) return 0;
    an.getByteTimeDomainData(buf as Uint8Array<ArrayBuffer>);
    let peak = 0;
    for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128));
    return peak / 128;
  }

  /** Is our own mic picking up speech right now (and we are not muted)? */
  localSpeaking(): boolean {
    if (this.muted || this.micState !== 'on') return false;
    const now = performance.now();
    if (this.level(this.localAnalyser, this.localBuf) > 0.06) this.localLastSpoke = now;
    return now - this.localLastSpoke < 250;
  }

  /** Is this other player talking AND audible to us right now? */
  isSpeaking(slot: number): boolean {
    const p = this.peers.get(slot);
    if (!p || p.volume < 0.03) return false;
    const now = performance.now();
    if (this.level(p.analyser, p.buf) > 0.06) p.lastSpoke = now;
    return now - p.lastSpoke < 250;
  }

  /** Set how loud a player is (0 = silent, 1 = full). Called every frame by the game. */
  setVolume(slot: number, v: number) {
    const p = this.peers.get(slot);
    if (!p || !p.gain || !this.ac) return;
    p.volume = v;
    p.gain.gain.setTargetAtTime(v, this.ac.currentTime, 0.05); // smooth, no clicks
  }

  // ---------- peer connections ----------

  private makePeer(slot: number): Peer {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const peer: Peer = { pc, pendingIce: [], remoteSet: false, lastSpoke: 0, volume: 0 };
    this.peers.set(slot, peer);

    pc.onicecandidate = (e) => {
      if (e.candidate) this.socket?.emit('sig', { to: slot, d: { c: e.candidate.toJSON() } });
    };
    pc.onconnectionstatechange = () => {
      this.log(`voice #${slot}: ${pc.connectionState}`);
      if (pc.connectionState === 'failed') this.log(`voice #${slot} failed - this network may need a TURN server`);
    };
    pc.ontrack = (e) => this.setupRemoteAudio(peer, e.streams[0] ?? new MediaStream([e.track]));
    return peer;
  }

  private setupRemoteAudio(peer: Peer, stream: MediaStream) {
    if (peer.src) return; // already set up
    // A muted <audio> element is a workaround: Chrome only delivers WebRTC audio if one exists.
    const el = new Audio();
    el.srcObject = stream;
    el.muted = true;
    void el.play().catch(() => {});
    peer.audioEl = el;
    if (!this.ac) this.unlockAudio();
    if (!this.ac) return;
    peer.src = this.ac.createMediaStreamSource(stream);
    peer.gain = this.ac.createGain();
    peer.gain.gain.value = 0; // silent until the game sets the volume
    peer.analyser = this.ac.createAnalyser();
    peer.analyser.fftSize = 512;
    peer.buf = new Uint8Array(peer.analyser.fftSize);
    peer.src.connect(peer.analyser);
    peer.src.connect(peer.gain);
    peer.gain.connect(this.ac.destination);
  }

  /**
   * Set up a voice link with another player.
   * Only ONE side may start ("initiate") so both don't start at once:
   * the player with the lower slot number does. The other side just waits.
   */
  async connectTo(slot: number, initiate: boolean) {
    this.closePeer(slot);
    if (!initiate) return;
    try {
      const peer = this.makePeer(slot);
      if (this.stream) this.stream.getAudioTracks().forEach((t) => peer.pc.addTrack(t, this.stream!));
      else peer.pc.addTransceiver('audio', { direction: 'recvonly' }); // listen-only (no mic)
      const offer = await peer.pc.createOffer();
      await peer.pc.setLocalDescription(offer);
      this.socket?.emit('sig', { to: slot, d: { o: peer.pc.localDescription } });
    } catch (e) {
      this.log('voice offer error: ' + e);
    }
  }

  /** A setup message arrived from another player. */
  async handleSignal(from: number, d: any) {
    try {
      if (d.o) {
        // They sent an offer -> we answer
        this.closePeer(from);
        const peer = this.makePeer(from);
        if (this.stream) this.stream.getAudioTracks().forEach((t) => peer.pc.addTrack(t, this.stream!));
        await peer.pc.setRemoteDescription(d.o);
        peer.remoteSet = true;
        await this.flushIce(peer);
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        this.socket?.emit('sig', { to: from, d: { a: peer.pc.localDescription } });
      } else if (d.a) {
        const peer = this.peers.get(from);
        if (!peer) return;
        await peer.pc.setRemoteDescription(d.a);
        peer.remoteSet = true;
        await this.flushIce(peer);
      } else if (d.c) {
        const peer = this.peers.get(from);
        if (!peer) return;
        if (peer.remoteSet) await peer.pc.addIceCandidate(d.c);
        else peer.pendingIce.push(d.c); // wait until the remote description is set
      }
    } catch (e) {
      this.log('voice signal error: ' + e);
    }
  }

  private async flushIce(peer: Peer) {
    const list = peer.pendingIce.splice(0);
    for (const c of list) await peer.pc.addIceCandidate(c).catch(() => {});
  }

  /** Close one voice link (player left). */
  closePeer(slot: number) {
    const p = this.peers.get(slot);
    if (!p) return;
    this.peers.delete(slot);
    try {
      p.pc.close();
      p.src?.disconnect();
      p.gain?.disconnect();
      if (p.audioEl) p.audioEl.srcObject = null;
    } catch {
      /* ignore */
    }
  }

  closeAll() {
    [...this.peers.keys()].forEach((s) => this.closePeer(s));
  }
}
