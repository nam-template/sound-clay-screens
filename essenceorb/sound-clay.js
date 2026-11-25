/* =====================================================================
   sound-clay.js — 형태·질감이 소리의 변수가 되는 '소리찰흙' 모듈
   규칙 기준본: 소리찰흙_규칙.md (숫자는 아래 RULES와 1:1로 맞춤)

   붙이는 법(최소):
     import { createSoundClay, SHAPES } from './sound-clay.js';
     const clay = createSoundClay({ THREE, MarchingCubes, parent: scene, camera,
                                    canvas: renderer.domElement, material, base: SHAPES.sphere(1.2) });
     // 매 프레임 렌더 전에
     clay.update(performance.now()/1000);

   오브젝트마다 바꾸는 건 base(바탕 형태의 거리함수) 하나. 나머지 규칙은 그대로.
   ===================================================================== */

/* ---------- 규칙 상수(문서와 동일) ---------- */
export const RULES = {
  grid:   { resolution: 72, extent: 3.0, textureGrid: 48 },
  pull:   { stiffness: 0.8, spread: 0.6, counter: 0.8, lag: 0.45, grow: 0.4, maxLen: 1.2, inset: 0.3, neck0: 0.30, neckPerLen: 0.08, neckMin: 0.15, end0: 0.34, endPerLen: 0.05, endMin: 0.24, kNeck: 0.35, kEnd: 0.30 },
  dent:   { radius: 0.2, depth: 0.08, k: 0.18 },
  texture:{ band: 0.25, brush: 0.34,
            square: { amp: 0.022, freq: 22 }, needle: { amp: 0.12, freq: 4.5, pow: 4 },
            pink:   { amp: 0.07,  freq: 1.6 }, white:  { amp: 0.022, freq: 7 } },
  gesture:{ scrubReversals: 2, reversalWindowMs: 600, fast: 1.3, slow: 0.45, slowHoldMs: 250,
            flickMs: 260, flickSpeed: 1.0, holdMs: 200, rubAmt: 0.3, eraseAmt: 0.1, holdAmt: 0.08, flickAmt: 0.8 },
  shapeToVoice: { durPerStretch: 1.2, legatoFrom: 0.15, legatoSpan: 1.2, stretchGain: 2.5, hornDiv: 0.8, leanDiv: 0.6, flatMin: 0.3, flatMax: 2.5,
                  pitchExp: 1.5, pitchStretchExp: 0.8, pitchMin: 0.3, pitchMax: 3, sweepMax: 4, rateGain: 3, rateMax: 4, vibGain: 500, vibMax: 240 },
  volume: { wheel: 0.0012, min: 0.35, max: 3.0, ringBase: 0.15, ringPerVol: 0.6, ringMin: 0.03, ringMax: 0.9, longFrom: 0.8, longSpan: 1.5 },
  brush:  { size: 1, strength: 1, sizeMin: 0.3, sizeMax: 3, strengthMin: 0.1, strengthMax: 2, cursorRadius: 0.45 },
  listen: { loudVol: 1.3, pitchStretch: 1.2, pitchLo: 110, pitchHi: 880, texGain: 2.0, smooth: 0.45, dbFloor: -58, dbCeil: -22 },
  motion: { wobble: 0.03, react: 1 },
  tone:   { baseHz: 1000, cal: [0.9, 0.38, 0.55, 1.0, 0.75], master: 0.16 },
  bird:   { master: 0.3 },
  toy:    { bpm: 66, density: 0.42, lp: 2300 },   // 공통 박(같은 화면이 같은 순간에 침) · 박마다 칠 확률 · 고역 차단
};
export const WAVES = ['SINE', 'SQUARE', 'NEEDLE', 'PINK', 'WHITE'];
/* 화음 모드 음계(반음 단위). key: { rootHz, scale } — 같은 캔버스 오브젝트끼리 공유 */
export const SCALES = {
  'major-pentatonic': [0, 2, 4, 7, 9], 'minor-pentatonic': [0, 3, 5, 7, 10],
  'major': [0, 2, 4, 5, 7, 9, 11], 'minor': [0, 2, 3, 5, 7, 8, 10], 'chord': [0, 4, 7],
  'major-chord': [0, 4, 7], 'minor-chord': [0, 3, 7],   // 장3화음·단3화음(코드 진행용: A→F#m→D→E 등)
};
const snapHz = (f, K) => { if (!K || !(f > 0)) return f; const st = 12 * Math.log2(f / K.root), oc = Math.floor(st / 12); let best = 1e9, bv = st;
  for (let o = oc - 1; o <= oc + 1; o++) for (const x of K.steps) { const v = o * 12 + x, d = Math.abs(v - st); if (d < best) { best = d; bv = v; } } return K.root * Math.pow(2, bv / 12); };

/* ---------- 감각 프리셋: 주무르는 손맛을 만드는 값들 ----------
   clay.getFeel() → JSON으로 저장 → 다른 화면에서 createSoundClay({ feel }) 또는 clay.setFeel(json)으로 그대로 재현.
   key는 'stiffness'·'spread'(인스턴스 값) 또는 RULES 경로('pull.maxLen' 등). */
export const FEEL_SCHEMA = [
  { key: 'stiffness',     label: '강성(덜 늘어남)',     min: 0,      max: 1,     step: 0.05 },
  { key: 'spread',        label: '퍼짐(몸통이 같이)',   min: 0,      max: 1,     step: 0.05 },
  { key: 'pull.lag',      label: '따라오는 지연',       min: 0,      max: 1,     step: 0.05 },
  { key: 'pull.grow',     label: '나오기 시작 거리',    min: 0.1,    max: 1.2,   step: 0.05 },
  { key: 'pull.maxLen',   label: '최대 길이',           min: 0.4,    max: 2.2,   step: 0.05 },
  { key: 'pull.inset',    label: '목 시작 깊이',        min: 0.05,   max: 0.8,   step: 0.05 },
  { key: 'pull.neck0',    label: '목 굵기',             min: 0.1,    max: 0.6,   step: 0.01 },
  { key: 'pull.end0',     label: '끝 덩어리 크기',      min: 0.15,   max: 0.7,   step: 0.01 },
  { key: 'pull.kNeck',    label: '목 섞임',             min: 0.05,   max: 1,     step: 0.05 },
  { key: 'pull.kEnd',     label: '끝 섞임',             min: 0.05,   max: 1,     step: 0.05 },
  { key: 'motion.wobble', label: '출렁임',              min: 0,      max: 0.1,   step: 0.005 },
  { key: 'motion.react',  label: '소리 반응 배율',      min: 0,      max: 5,     step: 0.1 },
  { key: 'volume.wheel',  label: '휠 민감도',           min: 0.0002, max: 0.004, step: 0.0001 },
  { key: 'pull.counter',        label: '반대쪽 줄어듦(0 전체 고르게~1 반대쪽만)', min: 0, max: 1, step: 0.05 },
  { key: 'listen.loudVol',      label: '목소리 → 부풀기',     min: 0,   max: 3,   step: 0.05 },
  { key: 'listen.pitchStretch', label: '목소리 → 위로 늘어남', min: 0,   max: 2,   step: 0.05 },
  { key: 'listen.texGain',      label: '목소리 → 질감',       min: 0,   max: 4,   step: 0.1 },
  { key: 'listen.dbCeil',       label: '목소리 감도(dB, 낮을수록 예민)', min: -40, max: -6, step: 1 },
  { key: 'brush.size',    label: '브러시 크기 (F)',     min: 0.3,    max: 3,     step: 0.05 },
  { key: 'brush.strength',label: '브러시 세기 (Shift+F)', min: 0.1,  max: 2,     step: 0.05 },
];
const getPath = (o, p) => p.split('.').reduce((a, k) => a && a[k], o);
const setPath = (o, p, v) => { const ks = p.split('.'), last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = v; };

/* ---------- 바탕 형태 라이브러리(거리함수: 안쪽 음수) — s는 부피 유지용 배율 ---------- */
export const SHAPES = {
  roundBox: ({ hx = 1, hy = 1, hz = 0.92, r = 0.28 } = {}) => (x, y, z, s) => {
    const rr = r * s, qx = Math.abs(x) - (hx * s - rr), qy = Math.abs(y) - (hy * s - rr), qz = Math.abs(z) - (hz * s - rr);
    const ax = qx > 0 ? qx : 0, ay = qy > 0 ? qy : 0, az = qz > 0 ? qz : 0;
    return Math.sqrt(ax * ax + ay * ay + az * az) + Math.min(Math.max(qx, qy, qz), 0) - rr;
  },
  sphere: (r = 1.2) => (x, y, z, s) => Math.sqrt(x * x + y * y + z * z) - r * s,
  // 임의 거리함수 f(x,y,z) → 부피 유지 배율을 자동 적용
  custom: (f) => (x, y, z, s) => f(x / s, y / s, z / s) * s,
  // 두 형태 사이 모핑(t=0 → a, 1 → b)
  morph: (a, b, t) => (x, y, z, s) => a(x, y, z, s) * (1 - t) + b(x, y, z, s) * t,
};

/* ---------- 수학 도구 ---------- */
const sminK = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
const smaxK = (a, b, k) => -sminK(-a, -b, k);
function sdCap(x, y, z, a, b, ra, rb) {
  const bx = b.x - a.x, by = b.y - a.y, bz = b.z - a.z, px = x - a.x, py = y - a.y, pz = z - a.z, bb = bx * bx + by * by + bz * bz || 1e-9;
  const h = Math.max(0, Math.min(1, (px * bx + py * by + pz * bz) / bb)), dx = px - bx * h, dy = py - by * h, dz = pz - bz * h;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - (ra + (rb - ra) * h);
}
function eig3(xx, yy, zz, xy, xz, yz) {   // 대칭 3×3 고유값(닫힌 꼴), 큰 순
  const p1 = xy * xy + xz * xz + yz * yz, q = (xx + yy + zz) / 3;
  const p2 = (xx - q) ** 2 + (yy - q) ** 2 + (zz - q) ** 2 + 2 * p1, p = Math.sqrt(p2 / 6) || 1e-9;
  const b11 = (xx - q) / p, b22 = (yy - q) / p, b33 = (zz - q) / p, b12 = xy / p, b13 = xz / p, b23 = yz / p;
  const r = (b11 * (b22 * b33 - b23 * b23) - b12 * (b12 * b33 - b23 * b13) + b13 * (b12 * b23 - b22 * b13)) / 2;
  const phi = r <= -1 ? Math.PI / 3 : r >= 1 ? 0 : Math.acos(r) / 3;
  const e1 = q + 2 * p * Math.cos(phi), e3 = q + 2 * p * Math.cos(phi + 2 * Math.PI / 3); return [e1, 3 * q - e1 - e3, e3];
}
const noise3 = (() => {   // 3D 심플렉스 노이즈
  const g = [[1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],[1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],[0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]];
  const perm = new Uint8Array(512); { const p = []; for (let i = 0; i < 256; i++) p[i] = i; let s = 8;
    for (let i = 255; i > 0; i--) { s = (s * 16807) % 2147483647; const j = s % (i + 1); [p[i], p[j]] = [p[j], p[i]]; }
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255]; }
  return (x, y, z) => { const F3 = 1 / 3, G3 = 1 / 6, s = (x + y + z) * F3, i = Math.floor(x + s), j = Math.floor(y + s), k = Math.floor(z + s);
    const t = (i + j + k) * G3, x0 = x - i + t, y0 = y - j + t, z0 = z - k + t; let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) { if (y0 >= z0) { i1=1;j1=0;k1=0;i2=1;j2=1;k2=0 } else if (x0 >= z0) { i1=1;j1=0;k1=0;i2=1;j2=0;k2=1 } else { i1=0;j1=0;k1=1;i2=1;j2=0;k2=1 } }
    else { if (y0 < z0) { i1=0;j1=0;k1=1;i2=0;j2=1;k2=1 } else if (x0 < z0) { i1=0;j1=1;k1=0;i2=0;j2=1;k2=1 } else { i1=0;j1=1;k1=0;i2=1;j2=1;k2=0 } }
    const ii = i & 255, jj = j & 255, kk = k & 255;
    const c = (tx, ty, tz, gi) => { let tt = .6 - tx * tx - ty * ty - tz * tz; if (tt < 0) return 0; tt *= tt; const gr = g[gi % 12]; return tt * tt * (gr[0] * tx + gr[1] * ty + gr[2] * tz); };
    return 32 * (c(x0, y0, z0, perm[ii + perm[jj + perm[kk]]]) + c(x0 - i1 + G3, y0 - j1 + G3, z0 - k1 + G3, perm[ii + i1 + perm[jj + j1 + perm[kk + k1]]])
      + c(x0 - i2 + 2 * G3, y0 - j2 + 2 * G3, z0 - k2 + 2 * G3, perm[ii + i2 + perm[jj + j2 + perm[kk + k2]]]) + c(x0 - .5, y0 - .5, z0 - .5, perm[ii + 1 + perm[jj + 1 + perm[kk + 1]]])); };
})();
let _seed = 12345; const rnd = () => { _seed = (_seed * 1664525 + 1013904223) >>> 0; return _seed / 4294967296 * 2 - 1; };
const pinkGen = (() => { let b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;
  return () => { const w = rnd(); b0=.99886*b0+w*.0555179; b1=.99332*b1+w*.0750759; b2=.969*b2+w*.153852; b3=.8665*b3+w*.3104856;
    b4=.55*b4+w*.5329522; b5=-.7616*b5-w*.016898; const v=(b0+b1+b2+b3+b4+b5+b6+w*.5362)*0.11; b6=w*.115926; return v; }; })();

/* ---------- 새소리 합성기(AudioWorklet 코드) ---------- */
/* ---------- 목소리 합성기(AudioWorklet) ----------
   목소리마다 '음표를 만드는 방식'만 다르고, 형태 변수(pitch·sweep·rate·vib·dur)와 질감 비율(T)은 똑같이 먹는다.
   기본 음색은 맑은 사인 계열. 스퀘어·버즈·노이즈는 질감을 칠한 만큼만 섞인다. */
export const VOICES = ['toy', 'tone', 'bird', 'pad', 'flute', 'chime', 'hum', 'drop'];   // toy = 아기 장난감처럼 부드럽고 조용한 소리
const VOICE_WORKLET = `
const SC=[1,1.125,1.26,1.335,1.5,1.68];
const BIRD_ORDER=['WHISTLE','WARBLE','TRILL','WHISTLE','CHIRP','WARBLE','WHISTLE','TRILL'];
class Voice extends AudioWorkletProcessor{
  constructor(opt){super();this.P={voice:'bird',pitch:1,sweep:1,rate:1,vib:0,dur:1,legato:0,T:[0,0,0,0]};this.port.onmessage=e=>{let d=e.data;   // 키가 바뀌면 표시 → process에서 예약음 다시 잡기
      if(d&&('key' in d)&&JSON.stringify(d.key||null)!==JSON.stringify(this.P.key||null))this.keyChange=true;
      // 공통 박 기준 보정: clock(보낸 순간의 벽시계)과 clockCtx(보낸 순간의 오디오 시각)로 '이 워크릿 t=0의 벽시계'를 계산 → 메시지가 늦게 와도 박이 안 밀림
      if(d&&d.clockCtx!=null&&d.clock!=null){d={...d,clock:d.clock+((typeof currentTime==='number'?currentTime:d.clockCtx)-this.t-d.clockCtx)};delete d.clockCtx;
        this.notes=this.notes.filter(n=>n.t<=this.t);this.next=Math.min(this.next,this.t);}   // 기준이 오기 전에 잡아 둔 아직 안 친 음은 버리고 새 기준으로 다시 잡음
      Object.assign(this.P,d);};
    if(opt&&opt.processorOptions)Object.assign(this.P,opt.processorOptions);
    if(this.P.clockCtx!=null&&this.P.clock!=null){this.P.clock+=((typeof currentTime==='number'?currentTime:this.P.clockCtx)-this.P.clockCtx);delete this.P.clockCtx;}   // 만들 때부터 공통 박 기준(t=0의 벽시계) → 첫 음부터 박 위   // 만들 때 받은 목소리·키·맡은 음으로 첫 소리부터 맞게
    this.t=0;this.next=0.15;this.notes=[];this.seed=99;this.oi=0;this.b=[0,0,0,0,0,0,0];this.b2=[0,0,0,0,0,0,0];
    this.e=[0,0,0,0,0];this.s2=0;this.d2=0;this.pk=0;this.prev=0;this.n=0;this.f=0;this.tag='REST';this.lp=0;}
  rnd(){this.seed=(this.seed*1664525+1013904223)>>>0;return this.seed/4294967296*2-1;}
  u(){return this.rnd()*.5+.5;}
  // 화음 모드: 키 음계의 가장 가까운 음으로 스냅 / 맡은 음이 있으면 무작위 흔들기 없이 그 음에서 시작
  snap(f){const K=this.P.key;if(!K||!K.root||!(f>0))return f;const st=12*Math.log2(f/K.root),oc=Math.floor(st/12);let best=1e9,bv=st;
    for(let o=oc-1;o<=oc+1;o++)for(const x of K.steps){const v=o*12+x,d=Math.abs(v-st);if(d<best){best=d;bv=v;}}return K.root*Math.pow(2,bv/12);}
  root0(lo,span){const P=this.P;return (P.key&&P.note?P.note:(lo+this.u()*span))*P.pitch;}
  pink(b){const w=this.rnd();b[0]=.99886*b[0]+w*.0555179;b[1]=.99332*b[1]+w*.0750759;b[2]=.969*b[2]+w*.153852;b[3]=.8665*b[3]+w*.3104856;
    b[4]=.55*b[4]+w*.5329522;b[5]=-.7616*b[5]-w*.016898;const v=(b[0]+b[1]+b[2]+b[3]+b[4]+b[5]+b[6]+w*.5362)*0.11;b[6]=w*.115926;return v;}
  // 음표: {t,d,fa,fb,amp,atk,rel,strike(감쇠초, 0=지속),parts[[배수,세기]],vibHz,vibD,trem,breath,kind}
  note(o){const L=this.P.legato||0,n=Object.assign({ph:0,lw:0,amp:1,atk:0.02,rel:0.05,strike:0,parts:[[1,1]],vibHz:5,vibD:0,trem:0,breath:0},o);
    // 레가토: 음이 길어져 다음 음과 겹치고, 시작·끝이 부드러워짐. 친 소리(종·물방울)는 감쇠가 길게 늘어짐.
    if(L>0){n.d*=1+2.5*L;n.atk*=1+2*L;n.rel*=1+4*L;if(n.strike)n.strike*=1+3*L;n.amp*=1/(1+0.6*L);}
    // 화음 모드: 음의 시작·끝을 키 음계로 스냅(사이는 미끄러짐), 종의 비정수 배음은 정수 배음으로 순하게
    if(this.P.key){n.fa=this.snap(n.fa);n.fb=this.snap(n.fb);if(n.kind==='CHIME')n.parts=[[1,1],[2,.2],[3,.07],[4,.03]];}
    this.notes.push(n);}
  phrase(){const P=this.P,v=P.voice,u=()=>this.u();let t=this.next;const gl=0.08*P.sweep,vd=P.vib/4000;
    const pickF=root=>root*SC[Math.floor(u()*SC.length)%SC.length];
    if(v==='bird'){const kind=BIRD_ORDER[this.oi++%BIRD_ORDER.length],root=this.root0(1900,500),parts=[[1,1],[2,.12],[3,.04]];
      const add=(d,fa,fb,gap)=>{this.note({t,d:Math.min(d*P.dur,gap*(0.9+2.5*(P.legato||0))),fa,fb,amp:0.5,atk:.018,rel:.045,parts,vibHz:6+u()*2,vibD:.012+vd,kind});t+=gap;};
      if(kind==='WHISTLE'){const n=1+Math.floor(u()*2);for(let k=0;k<n;k++){const f=pickF(root);add(0.22+u()*0.1,f*(1-gl*.5),f*(1+gl),0.34/Math.sqrt(P.rate));}}
      else if(kind==='TRILL'){const n=5+Math.floor(u()*5*P.rate),f=pickF(root)*1.15;for(let k=0;k<n;k++)add(0.045,f*(1+gl*.6),f*(1-gl*.4),0.075/P.rate);}
      else if(kind==='WARBLE'){const n=4+Math.floor(u()*3);for(let k=0;k<n;k++){const f=pickF(root);add(0.07+u()*0.03,f,f*(1+(u()-.5)*gl),0.1/P.rate);}}
      else{const n=2+Math.floor(u()*2);for(let k=0;k<n;k++){const f=pickF(root);add(0.08,f*(1-gl*1.5),f*(1+gl*1.5),0.13/P.rate);}}
      this.next=t+(1-0.85*(P.legato||0))*(0.45+u()*0.6)/Math.sqrt(P.rate);return;}
    if(v==='pad'){   // 천천히 부풀었다 사라지는 따뜻한 화음
      const root=this.root0(196,40),ch=[0,2,4].map(i=>root*SC[(i+Math.floor(u()*2))%SC.length]);
      for(const f of ch)this.note({t,d:3.4*P.dur,fa:f*(1-gl*.2),fb:f,amp:0.22,atk:0.9,rel:1.3,parts:[[1,1],[1.004,.6],[2,.12]],vibHz:4,vibD:.003+vd*.4,kind:'PAD'});
      this.next=t+(1-0.85*(P.legato||0))*2.6/P.rate;return;}
    if(v==='flute'){  // 숨이 조금 섞인 피리 선율
      const root=this.root0(480,80),n=3+Math.floor(u()*3);
      for(let k=0;k<n;k++){const f=pickF(root),d=(0.32+u()*0.3)*P.dur;this.note({t,d,fa:f*(1-gl*.3),fb:f,amp:0.42,atk:.07,rel:.14,parts:[[1,1],[2,.22],[3,.07]],vibHz:5,vibD:.006+vd,breath:.035,kind:'FLUTE'});t+=d*0.95/Math.sqrt(P.rate);}
      this.next=t+(1-0.85*(P.legato||0))*(0.6+u()*0.6)/Math.sqrt(P.rate);return;}
    if(v==='chime'){  // 부드럽게 친 종(비정수 배음, 높은 배음이 먼저 사라짐)
      const root=this.root0(620,80),n=1+Math.floor(u()*3);
      for(let k=0;k<n;k++){const f=pickF(root);this.note({t,d:2.6*P.dur,fa:f,fb:f*(1-gl*.05),amp:0.4,atk:.004,strike:0.7*P.dur,parts:[[1,1],[2.76,.3],[5.4,.1],[8.93,.04]],vibHz:0,kind:'CHIME'});t+=(0.35+u()*0.4)/P.rate;}
      this.next=t+(1-0.85*(P.legato||0))*(0.9+u()*0.8)/Math.sqrt(P.rate);return;}
    if(v==='hum'){    // 숨 쉬듯 낮게 웅웅
      const f=this.root0(104,12);
      this.note({t,d:4.4*P.dur,fa:f*(1-gl*.15),fb:f*(1+gl*.15),amp:0.45,atk:1.3,rel:1.6,parts:[[1,1],[2,.28],[3,.09]],vibHz:3,vibD:.002+vd*.3,trem:.3,kind:'HUM'});
      this.next=t+(1-0.85*(P.legato||0))*3.4/P.rate;return;}
    if(v==='toy'){    /* 아기 장난감: 펠트 망치로 친 나무 실로폰·칼림바·오르골 같은 부드러운 '톡-'
       같은 화면 오브젝트들이 공통 박(clock·bpm)과 같은 '박 무늬'(hash)를 공유 → 여러 개가 같은 순간에 쳐서 화음이 또렷 */
      const beat=60/(P.bpm||66),T0=P.clock||0,hash=k=>{const x=Math.sin(k*12.9898+78.233)*43758.5453;return x-Math.floor(x);};
      const dens=Math.max(0.15,Math.min(0.9,(P.density||0.42)*P.rate));
      let k=Math.ceil((this.next+T0)/beat-1e-6);for(let i=0;i<24&&hash(k)>=dens;i++)k++;
      const tb=k*beat-T0, T=P.T||[0,0,0,0], L=P.legato||0;
      const base=(P.key&&P.note?P.note:523.25)*P.pitch;
      // 한 번에 2~3음(근음·3도·5도), 오르골처럼 살짝 흩어 침(위로 굴림)
      const n=2+(hash(k*7.13)<0.55?1:0), R=[1,1.26,1.5];
      // 질감 → 부드러운 음색: SQUARE=조금 딱딱한 나무 · NEEDLE=또렷한 톡 · PINK=더 둥글게 · WHITE=아주 작은 숨
      const parts=[[1,1],[2,0.16*(1-0.6*T[2])+0.22*T[0]],[3,0.04+0.08*T[0]],[4,0.012+0.04*T[1]]];
      const atk=0.009*(1-0.6*T[1])+0.004, ring=(1.3+0.4*u())*P.dur*(1-0.35*T[0]);
      for(let j=0;j<n;j++){const fj=base*R[j],tj=tb+j*0.035;
        this.note({t:tj,d:3.2*P.dur,fa:fj,fb:fj,amp:0.155/(1+0.25*j),atk,strike:ring,parts,vibHz:0,breath:0.03*T[3],kind:'TOY'});}
      // 길게 늘이면(레가토) 지속음 대신 같은 음을 살살 여러 번(오르골 롤)
      const rolls=Math.round(L*3);for(let r=1;r<=rolls;r++){const fr=base*R[(r)%n];this.note({t:tb+r*beat/4,d:2.6*P.dur,fa:fr,fb:fr,amp:0.1*Math.pow(0.7,r),atk,strike:ring*0.8,parts,vibHz:0,kind:'TOY'});}
      this.next=tb+beat*0.5;return;}
    if(v==='drop'){   // 물방울: 짧게 위로 튀는 맑은 음
      const n=1+Math.floor(u()*3);
      for(let k=0;k<n;k++){const f=P.key&&P.note?pickF(P.note*P.pitch):(650+u()*700)*P.pitch;this.note({t,d:0.14*P.dur,fa:f,fb:f*(1.6+gl*4),amp:0.45,atk:.002,strike:0.045*P.dur,parts:[[1,1],[2,.05]],vibHz:0,kind:'DROP'});t+=(0.12+u()*0.25)/P.rate;}
      this.next=t+(1-0.85*(P.legato||0))*(0.5+u()*0.9)/Math.sqrt(P.rate);return;}
  }
  process(_,outs){const o=outs[0][0],sr=sampleRate,P=this.P,T=P.T,Ts=Math.min(1,T[0]+T[1]+T[2]+T[3]);
    const TOY=P.voice==='toy', g0=TOY?(1-0.25*Ts):(1-0.6*Ts), g1=(TOY?0.06:0.35)*T[0], gn=(TOY?0.08:0.5)*T[1], gw=(TOY?0.04:0.3)*T[3], gp=TOY?0.003+0.05*T[2]:0.012+0.25*T[2];
    const lpA=Math.exp(-2*Math.PI*(TOY?(P.lp||2300):(P.key?3500:6500))/sr);   // 고역을 부드럽게 깎음(화음 모드는 3.5kHz — 귀 피로 줄이기)
    // 키가 바뀐 순간: 아직 시작 안 한 예약음은 버리고 지금부터 새 키로 다시 예약, 울리던 옛 화음 꼬리는 빨리 줄임
    if(this.keyChange){this.keyChange=false;const t=this.t;this.notes=this.notes.filter(n=>n.t<=t);for(const n of this.notes)if(n.kill==null)n.kill=t;this.next=t;}
    for(let i=0;i<o.length;i++){const t=this.t;if(t>=this.next)this.phrase();
      const c=[0,0,0,this.pink(this.b)*gp,0];let best=0;
      for(let k=this.notes.length-1;k>=0;k--){const nt=this.notes[k];const tau=t-nt.t;if(tau<0)continue;if(tau>nt.d){this.notes.splice(k,1);continue;}
        const uu=tau/nt.d;let env;
        if(nt.strike){env=Math.min(1,tau/nt.atk)*Math.exp(-tau/nt.strike)*Math.min(1,(nt.d-tau)/0.05);}
        else{const a=Math.min(1,tau/nt.atk),r=Math.min(1,(nt.d-tau)/nt.rel);env=(0.5-0.5*Math.cos(Math.PI*a))*(0.5-0.5*Math.cos(Math.PI*r));}
        if(nt.trem)env*=1-nt.trem*(0.5+0.5*Math.sin(2*Math.PI*0.25*tau));
        if(nt.kill!=null)env*=Math.exp(-(t-nt.kill)/0.18);   // 키 바뀐 뒤 옛 음: 0.5초에 약 −14dB
        // 화음 모드: 음 길이의 앞 15%(최대 0.06초) 안에 미끄러져 도착한 뒤 스케일 음에 머묾 + 떨림 0.35배 → 들리는 시간 대부분이 키 안의 음
        const ug=P.key?Math.min(1,tau/Math.min(0.15*nt.d,0.06)):uu, vk=P.key?0.35:1;   // 음이 아무리 길어도 0.06초 안에 도착(짧은 음은 길이의 15%)
        const vD=P.key?Math.min(0.006,vk*nt.vibD):nt.vibD;   // 화음 모드 떨림은 ±0.6%(약 ±10센트) 이하
        const f=(nt.fa+(nt.fb-nt.fa)*(0.5-0.5*Math.cos(Math.PI*ug)))*(1+vD*Math.sin(2*Math.PI*nt.vibHz*tau));
        nt.ph+=2*Math.PI*f/sr;let s=0;
        for(const [r,a] of nt.parts){s+=Math.sin(nt.ph*r)*a*(nt.strike?Math.exp(-tau*(r-1)/(nt.strike*3)):1);}
        const A=nt.amp*env;
        c[0]+=s*g0*A;
        c[1]+=(Math.sin(nt.ph)>=0?1:-1)*g1*A;
        const w=Math.floor(nt.ph/(2*Math.PI));if(w!==nt.lw){nt.lw=w;c[2]+=gn*A;}
        c[4]+=this.rnd()*(gw+nt.breath)*A;
        c[3]+=this.pink(this.b2)*0.4*T[2]*A;
        if(env>best){best=env;this.f=f;this.tag=nt.kind;}}
      if(best<0.15)this.tag='REST';
      let v=0;for(let k=0;k<5;k++){v+=c[k];this.e[k]+=c[k]*c[k];}
      this.lp=this.lp*lpA+v*(1-lpA); v=this.lp;
      o[i]=Math.max(-1,Math.min(1,v*0.9*(P.level==null?1:P.level)));   // level: 동시에 노래하는 수만큼 낮춤
      this.s2+=v*v;this.d2+=(v-this.prev)*(v-this.prev);this.pk=Math.max(this.pk,Math.abs(v));this.prev=v;this.t+=1/sr;
      if(++this.n>=1600){const es=this.e.reduce((x,y)=>x+y,0)||1,rms=Math.sqrt(this.s2/this.n),drms=Math.sqrt(this.d2/this.n);
        this.port.postMessage({share:this.e.map(x=>x/es),rms,hf:Math.min(1,drms/(rms+1e-6)/1.41),crest:Math.min(1,Math.max(0,(this.pk/(rms+1e-6)-1.41)/6)),f0:this.tag==='REST'?0:this.f,tag:this.tag});
        this.e=[0,0,0,0,0];this.s2=this.d2=this.pk=0;this.n=0;}}
    return true;}}
registerProcessor('sound-clay-voice',Voice);`;

/* =====================================================================
   createSoundClay(options)
   필수: THREE, MarchingCubes, parent(Object3D), camera, canvas, material
   선택: base(거리함수, 기본 roundBox), voice(VOICES 중 하나: 'tone'|'bird'|'pad'|'flute'|'chime'|'hum'|'drop'), mute, rotateOnEmptyDrag, rules(RULES 일부 덮어쓰기),
         onChange(state) — 상태가 바뀔 때마다 호출(색 연동 등 나중 확장용 슬롯)
   반환: { root, mesh, state, update(t), start(), stop(), reset(), undo(), dispose(), paint(), pull() }
   ===================================================================== */
/* 조합(mix) 모드: 주소에 ?mix=A(A 장화음 고정) 또는 ?mix=prog(A→F#m→D→E, 2마디씩)가 있으면
   이 페이지의 모든 오브젝트가 toy 목소리로, 벽시계 기준의 같은 코드를 냄 → 여러 화면(iframe)을 한 페이지에 모아도 같은 박·같은 화음.
   페이지가 setKey로 키를 바꿔도 mix 모드에선 무시함(코드는 벽시계가 정함). */
export const MIX_PROGRESSION = [
  { name: 'A', rootHz: 110.00, scale: 'chord' }, { name: 'F#m', rootHz: 92.50, scale: 'minor-chord' },
  { name: 'D', rootHz: 146.83, scale: 'chord' }, { name: 'E', rootHz: 164.81, scale: 'chord' },
];
const MIX = (() => { try { const m = new URLSearchParams(globalThis.location?.search || '').get('mix'); return m === 'A' || m === 'prog' ? m : null; } catch (_) { return null; } })();
const MIX_APIS = new Set();
const wallSec = () => (performance.timeOrigin + performance.now()) / 1000;   // 벽시계(초): 다른 iframe·창과 같은 기준
export function mixChord() {
  if (!MIX) return null;
  if (MIX === 'A') return { idx: 0, ...MIX_PROGRESSION[0] };
  const sec = 2 * 4 * 60 / RULES.toy.bpm, idx = Math.floor(wallSec() / sec) % MIX_PROGRESSION.length;
  return { idx, ...MIX_PROGRESSION[idx] };
}
let mixIdx = -1;
if (MIX === 'prog') setInterval(() => { const c = mixChord(); if (c.idx === mixIdx) return; mixIdx = c.idx;
  for (const a of MIX_APIS) a._mixKey({ rootHz: c.rootHz, scale: c.scale }); }, 100);
export const MIX_MODE = MIX;

export function createSoundClay(o) {
  const { THREE, MarchingCubes, parent, camera, canvas, material } = o;
  const R = deepMerge(structuredClone(RULES), o.rules || {});
  const base = o.base || SHAPES.roundBox();
  if (MIX) { const c = mixChord(); o = { ...o, voice: 'toy', key: { rootHz: c.rootHz, scale: c.scale } }; }
  let voice = VOICES.includes(o.voice) ? o.voice : 'tone'; const mute = !!o.mute;
  let stiffness = o.stiffness ?? R.pull.stiffness;
  let spread = o.spread ?? R.pull.spread;
  let pitchScale = Math.max(0.1, Math.min(8, o.pitchScale ?? 1));
  /* 화음 모드: key = { rootHz, scale } (같은 캔버스에서 공유), note = 이 오브젝트가 맡은 음(Hz) */
  let keyOpt = o.key || null, note = o.note || 0, level = 1;
  const keyInfo = () => { const k = keyOpt || group.key; if (!k || !k.rootHz) return null; return { root: k.rootHz, steps: SCALES[k.scale] || SCALES['major-pentatonic'] }; };   // 오브젝트별 기본 음높이 배율(조율)   // 퍼짐: 0 = 손 댄 곳만 국소, 1 = 몸통 전체가 같이 늘어남   // 강성(되돌아가진 않지만 덜 당겨짐)
  const CR = R.grid.resolution, CE = R.grid.extent, TGR = R.grid.textureGrid;

  const root = new THREE.Group(); parent.add(root);
  /* 같은 캔버스에 붙은 인스턴스들(물방울 여러 개 등) — 입력을 서로 나눠 가짐 */
  const REG = (globalThis.__soundClayReg ||= new WeakMap());
  let group = REG.get(canvas); if (!group) { group = { peers: [], active: null }; REG.set(canvas, group); }
  const isActive = () => group.peers.length < 2 || group.active === api || (!group.active && group.peers[0] === api);
  const isFirst = () => group.peers[0] === api;
  if (o.key) group.key = o.key;   // 한 오브젝트에만 넘겨도 같은 화면 전체가 같은 키
  if (!group.clock) group.clock = -performance.timeOrigin;   // 공통 박의 기준 = 벽시계 0초(toy) → 같은 화면은 물론 다른 iframe·창끼리도 같은 박
  /* 잡은 점 ↔ 손(커서) 연결선: 무엇을 잡고 있는지, 얼마나 버티는지 보여줌 */
  const tGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const tether = new THREE.Line(tGeo, new THREE.LineBasicMaterial({ color: o.tetherColor ?? 0xffffff, transparent: true, opacity: 0.85, depthTest: false }));
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), new THREE.MeshBasicMaterial({ color: o.tetherColor ?? 0xffffff, depthTest: false }));
  tether.renderOrder = knob.renderOrder = 999; tether.visible = knob.visible = false; tether.frustumCulled = false; root.add(tether, knob);
  function tetherShow(a, b) { const p = tGeo.attributes.position.array; p[0] = a.x; p[1] = a.y; p[2] = a.z; p[3] = b.x; p[4] = b.y; p[5] = b.z;
    tGeo.attributes.position.needsUpdate = true; knob.position.set(a.x, a.y, a.z); tether.visible = knob.visible = true; }  const mc = new MarchingCubes(CR, material, false, false, 150000);
  mc.isolation = 0; mc.scale.setScalar(CE); root.add(mc);

  /* 상태(밖에서 읽어 색·UI 등에 연결) */
  const state = {
    share: [1, 0, 0, 0, 0],                 // 실제(또는 목표) 파형 에너지 비율 SINE·SQUARE·NEEDLE·PINK·WHITE
    texture: [0, 0, 0, 0],                  // 보이는 면의 질감 비율 SQUARE·NEEDLE·PINK·WHITE
    shape: { size: 1, stretch: 1, horn: 0, lean: 0, flat: 1, volume: 1 },   // 처음 형태 = 기준
    voice: { pitch: 1, sweep: 1, rate: 1, vib: 0, dur: 1, legato: 0, ring: 0.15, long: 0 },   // 형태 → 목소리 변수(ring·long = 울림)
    f0: 0, rms: 0, hf: 0, crest: 0, tag: 'IDLE', playing: false,
  };

  const strokes = [];                      // {type:'pull'|'dent', a, b, hit}
  const TEXG = new Float32Array(TGR ** 3 * 4), TDG = new Float32Array(TGR ** 3 * 3);
  const cons = { delta: 0, lastV: null, lastD: 0 };   // 부피 맞춤: 반대쪽을 안으로 미는 양 δ(+면 줄어듦)
  let baseS = 1, VBOX1 = null, V0 = null, volGoal = 1, texUsed = false, dirty = true, mcN = 0, mcBase = null, csv0 = null, tick = 0;
  const TI = { square: 0, needle: 1, pink: 2, white: 3 };
  /* ---------- 되돌리기 기록 ----------
     동작을 시작하기 직전 상태를 쌓는다. 질감(3D 격자)은 문지르기·지우기·초기화처럼 질감을 바꾸는 동작에서만 복사.
     아무것도 안 바뀐 클릭(거리 0 당기기, 칠 안 된 문지르기)은 기록에서 뺀다 → Ctrl+Z가 '헛돌지' 않음. */
  const undoStack = [], redoStack = [], HMAX = 40;
  const cloneStroke = st => { const c = { ...st }; for (const k of ['a', 'b', 'hit', 'n', 'bT']) if (st[k] && st[k].clone) c[k] = st[k].clone(); return c; };
  const snapshot = withTex => ({ strokes: strokes.map(cloneStroke), tex: withTex ? TEXG.slice() : null, tdg: withTex ? TDG.slice() : null, texUsed, volGoal, baseS });
  function pushHistory(withTex) { undoStack.push(snapshot(withTex)); if (undoStack.length > HMAX) undoStack.shift(); redoStack.length = 0; }
  function restore(sn) { cons.lastV = null; strokes.length = 0; sn.strokes.forEach(st => strokes.push(cloneStroke(st)));
    if (sn.tex) { TEXG.set(sn.tex); TDG.set(sn.tdg); } texUsed = sn.texUsed; volGoal = sn.volGoal; baseS = sn.baseS; dirty = true; }
  function undo() { if (!undoStack.length) return false; const sn = undoStack.pop(); redoStack.push(snapshot(!!sn.tex)); restore(sn); state.tag = 'UNDO'; return true; }
  function redo() { if (!redoStack.length) return false; const sn = redoStack.pop(); undoStack.push(snapshot(!!sn.tex)); restore(sn); state.tag = 'REDO'; return true; }
  let lastWheel = 0;
  const tg = v => Math.max(0, Math.min(TGR - 1, Math.round((v / CE * 0.5 + 0.5) * (TGR - 1))));

  function texDisp(x, y, z) {
    const c = (tg(z) * TGR + tg(y)) * TGR + tg(x);
    let live = 0;
    if (listen && listen.vis > 0.01) {
      // 목소리 믹스 비율 S[0..4]만큼 다섯 결을 섞는다(합이 1이라 조합이 바뀌면 표면이 바뀜). 시간 t로 계속 흐름.
      const S = listen.shares, g = listen.vis * R.listen.texGain * 0.5, t = listen.t;
      live = g * (
          S[0] * 0.11 * (Math.sin(x * 2.1 + t * 1.6) * Math.sin(y * 1.9 - t * 1.1) + 0.7 * Math.sin(z * 1.7 + y * 0.8 + t * 0.9))   // SINE: 크고 매끈한 물결
        + S[1] * 0.06 * Math.tanh(Math.sin((x + y * 0.55 - z * 0.3) * 13 + t * 3) * 5)                          // SQUARE: 계단 줄무늬
        + S[2] * 0.22 * Math.pow(Math.max(0, noise3(x * 4.5 + t * 0.6, y * 4.5, z * 4.5 - t * 0.4)), 3)          // NEEDLE: 튀어나온 가시
        + S[3] * 0.13 * noise3(x * 1.6 + t * 0.35, y * 1.6 - t * 0.2, z * 1.6)                                    // PINK: 큰 얼룩 덩이
        + S[4] * 0.05 * noise3(x * 9 + t * 3.5, y * 9 - t * 2, z * 9));                                           // WHITE: 잔모래
    }
    const w0 = TEXG[c*4], w1 = TEXG[c*4+1], w2 = TEXG[c*4+2], w3 = TEXG[c*4+3];
    if (w0 + w1 + w2 + w3 < 0.003) return live;
    const T = R.texture; let d = 0;
    d += live;
    if (w0 > 0) { const pr = x * TDG[c*3] + y * TDG[c*3+1] + z * TDG[c*3+2]; d += w0 * T.square.amp * Math.tanh(Math.sin(pr * T.square.freq) * 6); }
    if (w1 > 0) d += w1 * T.needle.amp * Math.pow(Math.max(0, noise3(x * T.needle.freq + 3, y * T.needle.freq, z * T.needle.freq - 2)), T.needle.pow);
    if (w2 > 0) d += w2 * T.pink.amp * noise3(x * T.pink.freq + 7, y * T.pink.freq, z * T.pink.freq);
    if (w3 > 0) d += w3 * T.white.amp * noise3(x * T.white.freq, y * T.white.freq + 5, z * T.white.freq);
    return d;
  }
  function strokeShape(s) {
    const P = R.pull, len = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y, s.b.z - s.a.z), sp = spread, bs = s.size || 1;
    // 퍼짐이 클수록 목·끝이 굵고, 몸통과 더 넓게 섞임
    return { neck: Math.max(P.neckMin, P.neck0 - P.neckPerLen * len) * (1 + 1.0 * sp) * bs, end: Math.max(P.endMin, P.end0 - P.endPerLen * len) * (1 + 0.8 * sp) * bs,
             kN: P.kNeck * (1 + 1.5 * sp), kE: P.kEnd * (1 + 1.0 * sp) };
  }

  /* 부피장 → 마칭큐브 표면, 부피 유지, 형태 변수 */
  function build() {
    const N = CR, h = N / 2, f = mc.field, toP = i => (i - h) / h * CE, band = R.texture.band, bandL = listen ? Math.max(band, 0.4) : band;
    /* 퍼짐(spread): 당긴 쪽 몸통 전체가 당기는 방향으로 같이 늘어나도록 공간을 휘게 함(반대쪽은 거의 그대로).
       몸통 반쪽 너비 Rb 안에서 당기는 축을 따라 0→1로 부드럽게 증가하는 비율만큼, 당긴 벡터의 g배를 옮긴다. */
    const g = 0.55 * spread, Rb = 1.1 * baseS;
    const AX = []; let AXw = 0;
    for (const st of strokes) {
      if (st.type === 'pull' && st.hit) { const vx = st.b.x - st.hit.x, vy = st.b.y - st.hit.y, vz = st.b.z - st.hit.z, l = Math.hypot(vx, vy, vz);
        if (l > 0.02) { AX.push({ x: -vx / l, y: -vy / l, z: -vz / l, w: l }); AXw += l; } }
      else if (st.type === 'dent') { const l = Math.hypot(st.a.x, st.a.y, st.a.z) || 1; AX.push({ x: -st.a.x / l, y: -st.a.y / l, z: -st.a.z / l, w: 0.3 }); AXw += 0.3; }
    }
    const ctr = R.pull.counter, useCons = AX.length > 0 && Math.abs(cons.delta) > 1e-5;
    // 한 점 p에서 '얼마나 반대쪽인가' 0~1(당긴 쪽 0 → 반대쪽 끝 1), counter로 전체 고르게와 섞음
    const oppW = (x, y, z) => { let ws = 0; for (const a of AX) { let t = ((x * a.x + y * a.y + z * a.z) + 0.2 * Rb) / (1.2 * Rb); t = t < 0 ? 0 : t > 1 ? 1 : t; ws += a.w * t * t * (3 - 2 * t); }
      return (1 - ctr) + ctr * (ws / AXw); };
    const W = g > 0 ? strokes.filter(s => s.type === 'pull' && s.hit).map(s => { const vx = s.b.x - s.hit.x, vy = s.b.y - s.hit.y, vz = s.b.z - s.hit.z, l = Math.hypot(vx, vy, vz) || 1;
      const f = Math.min(1, l / R.pull.grow), gg = g * f * f * (3 - 2 * f);   // 몸통 휘기도 드래그 거리에 비례(클릭·손떨림엔 0)
      return { vx: vx * gg, vy: vy * gg, vz: vz * gg, dx: vx / l, dy: vy / l, dz: vz / l }; }) : [];
    const warpT = (w, x, y, z) => { let t = ((x * w.dx + y * w.dy + z * w.dz) + Rb) / (2 * Rb); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
    const S = strokes.map(s => { const sh = strokeShape(s);
      let a = s.a;
      /* 당기기는 '드래그한 거리 L'에 비례해서만 나온다: 클릭(L=0)엔 아무 변화 없음.
         목·끝 덩어리 굵기와 섞임이 L 0→grow 구간에서 0→100%로 부드럽게 커짐.
         잡은 점 = 끝 덩어리의 바깥 표면(덩어리 중심은 표면 안쪽으로 반지름만큼), 목 시작점은 항상 목 굵기보다 깊게. */
      if (s.type === 'pull') {
        const L = Math.hypot(s.b.x - s.hit.x, s.b.y - s.hit.y, s.b.z - s.hit.z), f = Math.min(1, L / R.pull.grow), g = f * f * (3 - 2 * f);
        if (g < 0.01) return null;
        sh.neck *= g; sh.end *= g; sh.kN *= g; sh.kE *= g;
        const n = s.n || { x: 0, y: 0, z: 0 }, depth = Math.max(R.pull.inset, sh.neck + 0.08);
        a = { x: s.hit.x - n.x * depth, y: s.hit.y - n.y * depth, z: s.hit.z - n.z * depth };
        for (const w of W) { const t = warpT(w, a.x, a.y, a.z); a.x += w.vx * t; a.y += w.vy * t; a.z += w.vz * t; }   // 목 시작점도 늘어난 몸통을 따라감
        sh.c = { x: s.b.x - n.x * sh.end, y: s.b.y - n.y * sh.end, z: s.b.z - n.z * sh.end };
      }
      const m = (s.type === 'pull' ? Math.max(sh.neck + 0.06, sh.end) + sh.kN : R.dent.radius * (s.size || 1)) + 0.45;
      return { ...s, ...sh, a, x0: Math.min(a.x, s.b.x) - m, x1: Math.max(a.x, s.b.x) + m, y0: Math.min(a.y, s.b.y) - m, y1: Math.max(a.y, s.b.y) + m, z0: Math.min(a.z, s.b.z) - m, z1: Math.max(a.z, s.b.z) + m }; }).filter(Boolean);
    let n = 0, nb = 0, sx = 0, sy = 0, sz = 0, sxx = 0, syy = 0, szz = 0, sxy = 0, sxz = 0, syz = 0, rmax = 0;
    for (let z = 0; z < N; z++) { const pz = toP(z); for (let y = 0; y < N; y++) { const py = toP(y); for (let x = 0; x < N; x++) {
      const px = toP(x), q = x + y * N + z * N * N;
      if (x < 1 || y < 1 || z < 1 || x > N - 3 || y > N - 3 || z > N - 3) { f[q] = -1; continue; }
      let wx = px, wy = py, wz = pz;
      if (listen && listen.sy !== 1) { const sy = listen.sy, q = Math.sqrt(sy); wy /= sy; wx *= q; wz *= q; }
      for (const w of W) { const t = warpT(w, px, py, pz); wx -= w.vx * t; wy -= w.vy * t; wz -= w.vz * t; }
      let d = base(wx, wy, wz, baseS) + 0.0013 + (useCons ? cons.delta * oppW(px, py, pz) : 0); if (d < 0) nb++;   // 반대쪽을 δ만큼 안으로(부피 맞춤)   // 0.0013: 면이 격자점에 정확히 걸려 삼각형이 깜빡이는 것 방지
      for (const s of S) {
        if (px < s.x0 || px > s.x1 || py < s.y0 || py > s.y1 || pz < s.z0 || pz > s.z1) continue;
        if (s.type === 'pull') { d = sminK(d, sdCap(px, py, pz, s.a, s.c, s.neck + 0.06, s.neck), s.kN);
          const ex = px - s.c.x, ey = py - s.c.y, ez = pz - s.c.z; d = sminK(d, Math.sqrt(ex * ex + ey * ey + ez * ez) - s.end, s.kE); }
        else { const dr = R.dent.radius * (s.size || 1); d = smaxK(d, -sdCap(px, py, pz, s.a, s.b, dr, dr), R.dent.k * (s.size || 1)); }
      }
      if ((texUsed || listen) && d > -bandL && d < bandL) d -= texDisp(px, py, pz);
      f[q] = -d;
      if (d < 0) { n++; sx += px; sy += py; sz += pz; const xx = px*px, yy = py*py, zz = pz*pz; sxx += xx; syy += yy; szz += zz; sxy += px*py; sxz += px*pz; syz += py*pz; if (xx+yy+zz > rmax) rmax = xx+yy+zz; }
    } } }
    mc.normal_cache.fill(0); mc.update();
    mcN = mc.count; mcBase = mc.positionArray.slice(0, mcN * 3); mc.geometry.computeBoundingSphere();
    // 부피 유지: 바탕 크기만 조절(뽑은 덩어리는 그대로)
    const cell = (2 * CE / N) ** 3, V = n * cell, Vb = nb * cell;
    if (VBOX1 === null) { VBOX1 = Vb / baseS ** 3; V0 = V; }
    const goalF = volGoal * (listen ? 1 + R.listen.loudVol * listen.loud : 1), Vgoal = V0 * goalF, sT = Math.cbrt(goalF);
    if (Math.abs(sT - baseS) > 0.002) { baseS += (sT - baseS) * 0.6; dirty = true; cons.lastV = null; }
    else if (AX.length) {
      const err = (V - Vgoal) / Vgoal;
      if (Math.abs(err) > 0.006) {
        // dV/dδ(음수)를 직전 두 번으로 추정, 없거나 이상하면 대략값
        let A = (cons.lastV != null && Math.abs(cons.delta - cons.lastD) > 1e-4) ? (V - cons.lastV) / (cons.delta - cons.lastD) : -8;
        if (!(A < -0.5)) A = -8;
        const nd = Math.max(-0.8, Math.min(0.8, cons.delta - (V - Vgoal) / A));
        cons.lastV = V; cons.lastD = cons.delta; cons.delta += (nd - cons.delta) * 0.9; dirty = true;
      }
    } else if (cons.delta) { cons.delta = 0; cons.lastV = null; dirty = true; }
    // 부피 → 울림: 커질수록 잔향이 깊고 길게, 작아지면 마른 소리
    const Vr = R.volume, vol = V / V0; state.shape.volume = vol;
    state.voice.ring = Math.max(Vr.ringMin, Math.min(Vr.ringMax, Vr.ringBase + Vr.ringPerVol * (vol - 1)));
    state.voice.long = Math.max(0, Math.min(1, (vol - Vr.longFrom) / Vr.longSpan));
    // 형태 변수(처음 형태 = ×1)
    if (n > 0) {
      const cx = sx / n, cy = sy / n, cz = sz / n;
      const [l1, l2, l3] = eig3(sxx/n - cx*cx, syy/n - cy*cy, szz/n - cz*cz, sxy/n - cx*cy, sxz/n - cx*cz, syz/n - cy*cz);
      const size = Math.sqrt(Math.max(1e-9, l1 + l2 + l3));
      const cur = { size, elong: Math.sqrt(l1 / Math.max(l2, 1e-9)), flat: Math.sqrt(Math.max(l3, 1e-9) / Math.max(l2, 1e-9)), peak: Math.sqrt(rmax) / size, lean: Math.hypot(cx, cy, cz) / size };
      if (!csv0) csv0 = cur;
      const G = R.shapeToVoice, sh = state.shape;
      sh.size = Math.cbrt(Math.max(1e-6, vol));   // 덩치 = 실제 부피 기준(∛부피). 길쭉해져도 부피가 같으면 그대로
      sh.stretch = Math.max(0.3, 1 + G.stretchGain * (cur.elong - csv0.elong));
      sh.horn = Math.max(0, (cur.peak - csv0.peak) / G.hornDiv);
      sh.lean = Math.max(0, (cur.lean - csv0.lean) / G.leanDiv);
      sh.flat = Math.max(G.flatMin, Math.min(G.flatMax, cur.flat / csv0.flat));
      const v = state.voice;
      // 음높이 = 부피 축(커지면 낮게) × 길이 비율 축(길게 늘이면 높게). 듣기 방향(높은 음 → 위로 늘어남)과 대칭
      v.pitch = Math.max(G.pitchMin, Math.min(G.pitchMax, Math.pow(1 / sh.size, G.pitchExp) * Math.pow(Math.max(0.3, sh.stretch), G.pitchStretchExp)))
        * pitchScale;   // 오브젝트별 조율(예: 작은 물방울은 처음부터 높게). 형태 규칙(×1 기준)은 그대로, 최종 음높이에만 곱함
      v.sweep = Math.min(G.sweepMax, sh.stretch); v.rate = Math.min(G.rateMax, 1 + G.rateGain * sh.horn);
      v.vib = Math.min(G.vibMax, G.vibGain * sh.lean);
      // 길게 늘일수록 음이 길어지고(dur), 이어지다가(legato) 끊기지 않는 지속음이 됨. 납작함은 계속 짧게 끊는 쪽으로 곱해짐.
      const ds = Math.max(0, sh.stretch - 1);
      v.legato = Math.max(0, Math.min(1, (ds - G.legatoFrom) / G.legatoSpan));
      v.dur = Math.max(G.flatMin, Math.min(6, sh.flat * (1 + G.durPerStretch * ds)));
    }
  }

  /* 질감 칠하기(3D 격자) */
  function paint(cL, kind, amt, dirL, rad = R.texture.brush) {
    rad *= R.brush.size; amt = Math.min(1, amt * R.brush.strength);   // 브러시 크기·세기
    if (drag) drag.changed = true;
    const r = Math.ceil(rad / CE * 0.5 * (TGR - 1)) + 1, cx = tg(cL.x), cy = tg(cL.y), cz = tg(cL.z), step = 2 * CE / (TGR - 1);
    const dl = dirL && dirL.lengthSq() > 0 ? dirL.clone().normalize() : null;
    for (let z = Math.max(0, cz - r); z <= Math.min(TGR - 1, cz + r); z++) for (let y = Math.max(0, cy - r); y <= Math.min(TGR - 1, cy + r); y++) for (let x = Math.max(0, cx - r); x <= Math.min(TGR - 1, cx + r); x++) {
      const px = -CE + x * step, py = -CE + y * step, pz = -CE + z * step, d2 = ((px - cL.x) ** 2 + (py - cL.y) ** 2 + (pz - cL.z) ** 2) / (rad * rad);
      if (d2 >= 1) continue;
      const f = (1 - d2) * (1 - d2) * amt, c = (z * TGR + y) * TGR + x;
      if (kind === 'sine') { for (let k = 0; k < 4; k++) TEXG[c*4+k] *= 1 - f; continue; }
      const t = TI[kind];
      for (let k = 0; k < 4; k++) TEXG[c*4+k] = k === t ? TEXG[c*4+k] + f * (1 - TEXG[c*4+k]) : TEXG[c*4+k] * (1 - f * 0.6);
      if (t === 0 && dl) { const qq = Math.min(1, f * 2); TDG[c*3] += (dl.x - TDG[c*3]) * qq; TDG[c*3+1] += (dl.y - TDG[c*3+1]) * qq; TDG[c*3+2] += (dl.z - TDG[c*3+2]) * qq; }
    }
    texUsed = true; dirty = true;
  }

  /* 보이는 면의 질감 비율 → 소리 */
  function mix() {
    if (!mcN) return;
    const cam = root.worldToLocal(camera.position.clone()), nA = mc.normalArray, m = [0, 0, 0, 0]; let ws = 0;
    for (let i = 0; i < mcN; i += 3) {
      const x = mcBase[i*3] * CE, y = mcBase[i*3+1] * CE, z = mcBase[i*3+2] * CE;
      const nx = nA[i*3], ny = nA[i*3+1], nz = nA[i*3+2], nl = Math.hypot(nx, ny, nz) || 1, vx = cam.x - x, vy = cam.y - y, vz = cam.z - z;
      const fw = Math.max(0, (nx * vx + ny * vy + nz * vz) / (nl * Math.hypot(vx, vy, vz))); if (fw === 0) continue;
      const c = (tg(z) * TGR + tg(y)) * TGR + tg(x); ws += fw; for (let k = 0; k < 4; k++) m[k] += TEXG[c*4+k] * fw;
    }
    state.texture = m.map(v => v / (ws || 1));
    const T = state.texture;
    if (listen) { o.onChange && o.onChange(state); return; }
    if (voice !== 'tone') { if (bird && bird.node) { bird.node.port.postMessage({ T, voice, ...state.voice, key: keyInfo(), note, level }); bird.space.set(state.voice.ring, state.voice.long); } }
    else {
      const w = [Math.max(0, 1 - T[0] - T[1] - T[2] - T[3]), ...T], sum = w.reduce((a, b) => a + b, 0) || 1;
      state.share = w.map(v => v / sum);
      { const K = keyInfo(); state.f0 = K ? snapHz((note || R.tone.baseHz) * state.voice.pitch, K) : R.tone.baseHz * state.voice.pitch; }
      state.hf = Math.min(1, state.share[4] + state.share[2] * 0.7); state.crest = state.share[2]; state.rms = 0.5;
      toneSet();
    }
    o.onChange && o.onChange(state);
  }

  /* 공간(울림): 짧은 잔향 + 긴 잔향을 부피에 따라 섞음 */
  function makeSpace(ac, gain) {
    const out = ac.createGain(); out.gain.value = mute ? 0 : gain; out.connect(ac.destination);
    const inp = ac.createGain(), dry = ac.createGain(); inp.connect(dry).connect(out);
    const ir = sec => { const n = Math.floor(ac.sampleRate * sec), b = ac.createBuffer(2, n, ac.sampleRate);
      for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.2); } return b; };
    const cs = ac.createConvolver(), cl = ac.createConvolver(); cs.buffer = ir(0.9); cl.buffer = ir(3.2);
    const ws = ac.createGain(), wl = ac.createGain(); ws.gain.value = wl.gain.value = 0;
    inp.connect(cs); inp.connect(cl); cs.connect(ws).connect(out); cl.connect(wl).connect(out);
    return { inp, set(ring, long) { const t = ac.currentTime; ws.gain.setTargetAtTime(ring * (1 - long) * 0.5, t, 0.1); wl.gain.setTargetAtTime(ring * long * 0.5, t, 0.1); } };
  }
  /* 소리: tone(오실레이터 5개 연속음) · 그 밖의 목소리(워크릿: bird·pad·flute·chime·hum·drop) */
  let tone = null, bird = null;
  function toneStart() {
    const ac = new AudioContext(), space = makeSpace(ac, R.tone.master), master = ac.createGain(); master.gain.value = level; master.connect(space.inp);
    const sine = ac.createOscillator(); sine.type = 'sine';
    const sq = ac.createOscillator(); sq.type = 'square';
    const nd = ac.createOscillator(); { const H = 48, re = new Float32Array(H + 1), im = new Float32Array(H + 1); for (let h = 1; h <= H; h++) re[h] = 1; nd.setPeriodicWave(ac.createPeriodicWave(re, im)); }
    const noise = pink => { const n = ac.sampleRate * 2, b = ac.createBuffer(1, n, ac.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = pink ? pinkGen() * 0.82 : rnd() * 0.4; const s = ac.createBufferSource(); s.buffer = b; s.loop = true; return s; };
    const srcs = [sine, sq, nd, noise(true), noise(false)], gains = srcs.map(() => { const g = ac.createGain(); g.gain.value = 0; g.connect(master); return g; });
    srcs.forEach((s, k) => { s.connect(gains[k]); s.start(); });
    tone = { ac, gains, oscs: [sine, sq, nd], space, master }; toneSet();
  }
  function toneSet() {
    if (!tone) return; const now = tone.ac.currentTime; tone.space.set(state.voice.ring, state.voice.long);
    tone.gains.forEach((g, k) => g.gain.setTargetAtTime(R.tone.cal[k] * Math.sqrt(state.share[k]), now, 0.04));
    tone.oscs.forEach(os => os.frequency.setTargetAtTime(Math.max(60, state.f0 || R.tone.baseHz), now, 0.05));
  }
  async function birdStart() {
    bird = { pending: true };
    const ac = new AudioContext();
    await ac.audioWorklet.addModule(URL.createObjectURL(new Blob([VOICE_WORKLET], { type: 'text/javascript' })));
    // 첫 소리부터 맞는 목소리로: 만들 때 목소리·키·맡은 음·형태 값·질감을 함께 넘김(예전엔 첫 mix 전까지 기본값 bird가 한 번 울렸음)
    const node = new AudioWorkletNode(ac, 'sound-clay-voice', { outputChannelCount: [1], processorOptions: { voice, ...state.voice, T: state.texture, key: keyInfo(), note, level, clock: (performance.now() - group.clock) / 1000, clockCtx: ac.currentTime, bpm: o.bpm || R.toy.bpm, density: R.toy.density, lp: R.toy.lp } });
    // 이 워크릿의 시간 0이 공통 시계에서 몇 초 뒤인지 → 다른 오브젝트와 같은 박에 침
    node.port.postMessage({ clock: (performance.now() - group.clock) / 1000, clockCtx: ac.currentTime, bpm: o.bpm || R.toy.bpm, density: R.toy.density, lp: R.toy.lp });
    const space = makeSpace(ac, R.bird.master); node.connect(space.inp);
    node.port.onmessage = e => { Object.assign(state, e.data); o.onChange && o.onChange(state); };
    bird = { ac, node, space }; mix();
  }
  async function start() { if (listen) return; if (state.playing) return;
    if (o.exclusiveVoice !== false) for (const p of group.peers) if (p !== api && p.state.playing && !p.listening) p.stop(); state.playing = true; if (voice !== 'tone') await birdStart(); else toneStart(); }
  function stop() { state.playing = false; if (tone) { tone.ac.close(); tone = null; } if (bird && bird.ac) { bird.ac.close(); bird = null; } }

  /* 조작: 왼드래그 당기기 · 오른드래그/Shift 문지르기 · Ctrl 홈 · Alt 질감 지우기 · 빈 곳 드래그 회전 */
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(); let drag = null;
  const loc = w => root.worldToLocal(w.clone());
  const toNDC = e => { const r = canvas.getBoundingClientRect(); ndc.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1); };
  const hitTest = () => { mc.updateMatrixWorld(); return ray.intersectObject(mc)[0]; };
  // 포인터 아래 이 인스턴스까지 거리(안 맞으면 무한대) — 이웃끼리 누가 받을지 비교
  function hitDist(e) { toNDC(e); ray.setFromCamera(ndc, camera); const h = hitTest(); return h ? h.distance : Infinity; }
  const nearestOwner = e => { let best = null, bd = Infinity; for (const p of group.peers) { const d = p._hitDist(e); if (d < bd) { bd = d; best = p; } } return best; };
  function onDown(e) {
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    if (group.peers.length > 1) { const own = nearestOwner(e);
      if (own && own !== api) return;                                   // 더 가까운 이웃이 받음
      if (!own && !isFirst()) return; }                                 // 빈 곳 회전은 첫 인스턴스만
    toNDC(e); ray.setFromCamera(ndc, camera); const hit = hitTest();
    if (!hit) { if (o.rotateOnEmptyDrag !== false) drag = { kind: 'rotate', pid: e.pointerId, x: e.clientX, y: e.clientY }; return; }
    group.active = api;
    start();
    const kind = (e.ctrlKey || e.metaKey) ? 'dent' : e.altKey ? 'smooth' : (e.button === 2 || e.shiftKey) ? 'rub' : 'pull';
    pushHistory(kind === 'rub' || kind === 'smooth');
    const hl = loc(hit.point), inward = hl.clone().multiplyScalar(-1).normalize(), now = performance.now();
    drag = { kind, pid: e.pointerId, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()).negate(), hit.point),
      t0: now, lastMove: now, hist: [{ x: e.clientX, y: e.clientY, t: now }], pdir: null, revs: [], trail: [hl.clone()], changed: kind === 'dent' };
    if (kind === 'pull') {
      // 클릭한 표면의 바깥 법선(없으면 중심 반대 방향) — 잡은 점이 이 표면 그 자체가 되도록
      const n = hit.face && hit.face.normal ? hit.face.normal.clone().normalize() : inward.clone().negate();
      drag.stroke = { type: 'pull', a: hl.clone().addScaledVector(n, -R.pull.inset), b: hl.clone(), hit: hl.clone(), n, size: R.brush.size, str: R.brush.strength };
      strokes.push(drag.stroke); tetherShow(hl, hl);
    }
    if (kind === 'dent') { const dep = R.dent.depth * R.brush.strength, p = hl.clone().addScaledVector(inward, dep); drag.stroke = { type: 'dent', a: p.clone(), b: p.clone(), size: R.brush.size, dep }; strokes.push(drag.stroke); dirty = true; }
    state.tag = { rub: 'RUB', pull: 'PULL', dent: 'DENT', smooth: 'SMOOTH' }[kind];
  }
  function onMove(e) {
    if (!drag || e.buttons === 0 || e.pointerId !== drag.pid) return;
    if (drag.kind === 'rotate') { root.rotation.y += (e.clientX - drag.x) * 0.008; root.rotation.x += (e.clientY - drag.y) * 0.008; drag.x = e.clientX; drag.y = e.clientY; return; }
    toNDC(e); ray.setFromCamera(ndc, camera);
    const p = ray.ray.intersectPlane(drag.plane, new THREE.Vector3()); if (!p) return;
    const pl = loc(p), now = performance.now(), Gs = R.gesture; drag.lastMove = now;
    drag.hist.push({ x: e.clientX, y: e.clientY, t: now }); while (drag.hist.length > 2 && now - drag.hist[0].t > 90) drag.hist.shift();
    const h0 = drag.hist[0], speed = Math.hypot(e.clientX - h0.x, e.clientY - h0.y) / Math.max(30, now - h0.t);
    if (drag.hist.length >= 3) { const dx = e.clientX - h0.x, dy = e.clientY - h0.y, l = Math.hypot(dx, dy);
      if (l > 6) { const d = [dx / l, dy / l]; if (drag.pdir && d[0] * drag.pdir[0] + d[1] * drag.pdir[1] < -0.3) drag.revs.push(now); drag.pdir = d; } }
    drag.revs = drag.revs.filter(t => now - t < Gs.reversalWindowMs); drag.speed = speed;
    if (speed < Gs.slow) { if (!drag.slowSince) drag.slowSince = now; } else drag.slowSince = 0;
    if (drag.kind === 'pull') {
      // 강성: 손이 간 만큼 다 따라오지 않음(멀리 당길수록 덜 늘어남, 한계에 점점 다가감). 놓아도 되돌아가지 않음.
      const s = drag.stroke, v = pl.clone().sub(s.hit), d = v.length(), k = stiffness;
      const M = R.pull.maxLen * (1 - 0.45 * k) * (s.str || 1), eff = M * (1 - Math.exp(-d * (1 - 0.7 * k) / M));
      if (d > 1e-6) v.setLength(eff);
      s.bT = s.hit.clone().add(v); const lim = CE - 0.55; s.bT.clampScalar(-lim, lim); drag.cursor = pl; state.tag = 'PULL'; return;
    }
    const hp = hitTest();
    if (drag.kind === 'dent') { if (hp) { const q = loc(hp.point); drag.stroke.b.copy(q.addScaledVector(q.clone().normalize(), -(drag.stroke.dep || R.dent.depth))); dirty = true; } state.tag = 'DENT'; return; }
    let tex = null, amt = Gs.rubAmt;
    if (drag.kind === 'rub') {
      if (drag.revs.length >= Gs.scrubReversals) { tex = 'square'; state.tag = 'SCRUB → SQUARE'; }
      else if (drag.revs.length >= 1) state.tag = 'SCRUB…';
      else if (speed > Gs.fast) { tex = 'white'; state.tag = 'FAST → WHITE'; }
      else if (drag.slowSince && now - drag.slowSince > Gs.slowHoldMs) { tex = 'sine'; amt = Gs.eraseAmt; state.tag = 'SLOW → SINE'; }
      else state.tag = 'SMEAR';
    } else { tex = 'sine'; amt = 0.15; state.tag = 'SMOOTH → SINE'; }
    if (hp) { const q = loc(hp.point), prev = drag.trail[drag.trail.length - 1]; if (tex) paint(q, tex, amt, q.clone().sub(prev)); drag.trail.push(q); if (drag.trail.length > 8) drag.trail.shift(); }
  }
  function onUp() {
    const Gs = R.gesture;
    if (drag && drag.kind === 'rub' && performance.now() - drag.t0 < Gs.flickMs && (drag.speed || 0) > Gs.flickSpeed) {
      drag.trail.slice(-6).forEach(q => paint(q, 'needle', Gs.flickAmt, null, 0.28)); state.tag = 'FLICK → NEEDLE';
    } else state.tag = 'IDLE';
    if (drag && drag.kind === 'pull' && drag.stroke) {
      drag.stroke.bT = drag.stroke.b.clone();   // 놓은 자리에서 멈춤(되돌아가지 않음)
      const st = drag.stroke, L = Math.hypot(st.b.x - st.hit.x, st.b.y - st.hit.y, st.b.z - st.hit.z);
      if (L * L < 1e-4) { const i = strokes.indexOf(st); if (i >= 0) strokes.splice(i, 1); dirty = true; } else drag.changed = true;
    }
    if (drag && drag.kind !== 'rotate' && !drag.changed) undoStack.pop();
    tether.visible = knob.visible = false;
    drag = null;
  }
  // 휠: 오브젝트 위에서 굴리면 찰흙을 더하거나 덜어냄(부피 목표값)
  function onWheel(e) {
    if (group.peers.length > 1 && nearestOwner(e) !== api) return;
    toNDC(e); ray.setFromCamera(ndc, camera); if (!hitTest()) return;
    group.active = api;
    e.preventDefault(); start();
    const tw = performance.now(); if (tw - lastWheel > 400) pushHistory(false); lastWheel = tw;
    inflate(Math.exp(-e.deltaY * R.volume.wheel)); state.tag = e.deltaY < 0 ? 'INFLATE' : 'DEFLATE';
  }
  function inflate(f) { volGoal = Math.max(R.volume.min, Math.min(R.volume.max, volGoal * f)); dirty = true; }
  const noMenu = e => e.preventDefault();
  canvas.addEventListener('wheel', onWheel, { passive: false });
  /* ---------- 브러시 원 커서 · F(크기) / Shift+F(세기) — 블렌더 문법 ----------
     F: 마우스를 원 중심에서 멀리/가까이 → 크기. Shift+F: 같은 방식으로 세기(안쪽 채움이 진해짐).
     클릭·Enter = 확정, Esc·오른클릭 = 취소. 조절 중엔 주무르기 입력이 막힘. */
  const ui = o.brushUI !== false && typeof document !== 'undefined';
  const mouse = { x: 0, y: 0, over: false };
  let bmode = null;   // {kind:'size'|'strength', cx, cy, d0, v0}
  let cur = null, curFill = null, curLabel = null;
  if (ui) {
    cur = document.createElement('div');
    cur.style.cssText = 'position:fixed;pointer-events:none;z-index:60;border:1.5px solid rgba(255,255,255,.85);border-radius:50%;transform:translate(-50%,-50%);display:none;box-shadow:0 0 0 1px rgba(0,0,0,.15)';
    curFill = document.createElement('div'); curFill.style.cssText = 'position:absolute;left:50%;top:50%;border-radius:50%;transform:translate(-50%,-50%);background:rgba(255,255,255,.22)';
    curLabel = document.createElement('div'); curLabel.style.cssText = 'position:fixed;pointer-events:none;z-index:61;font:11px Inter,system-ui,sans-serif;color:#fff;background:rgba(0,0,0,.45);padding:2px 6px;border-radius:4px;display:none';
    cur.appendChild(curFill); document.body.append(cur, curLabel);
  }
  const pxPerWorld = () => { const wp = new THREE.Vector3(); root.getWorldPosition(wp); const dist = camera.position.distanceTo(wp);
    return canvas.clientHeight / (2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)); };
  function drawCursor() {
    if (!ui) return;
    const show = isActive() && (bmode || (mouse.over && !(drag && drag.kind === 'rotate')));
    cur.style.display = show ? 'block' : 'none';
    if (!show) { curLabel.style.display = 'none'; return; }
    const rpx = R.texture.brush && R.brush.cursorRadius * R.brush.size * pxPerWorld();
    const cx = bmode ? bmode.cx : mouse.x, cy = bmode ? bmode.cy : mouse.y;
    cur.style.left = cx + 'px'; cur.style.top = cy + 'px'; cur.style.width = cur.style.height = (2 * rpx) + 'px';
    const sf = Math.min(1, R.brush.strength / R.brush.strengthMax); curFill.style.width = curFill.style.height = (2 * rpx * Math.sqrt(sf)) + 'px';
    if (bmode) { curLabel.style.display = 'block'; curLabel.style.left = (cx + rpx + 8) + 'px'; curLabel.style.top = (cy - 10) + 'px';
      curLabel.textContent = bmode.kind === 'size' ? 'SIZE ' + R.brush.size.toFixed(2) : 'STRENGTH ' + R.brush.strength.toFixed(2); }
    else curLabel.style.display = 'none';
  }
  function onKey(e) {
    if (!isActive()) return;
    const tag = (e.target && e.target.tagName) || ''; if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
    if ((e.ctrlKey || e.metaKey) && !bmode && !drag) {
      const k = e.key.toLowerCase();
      if (k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if (k === 'y') { e.preventDefault(); redo(); return; }
    }
    if ((e.key === 'f' || e.key === 'F') && !bmode && mouse.over) {
      e.preventDefault();
      const kind = e.shiftKey ? 'strength' : 'size', rpx = R.brush.cursorRadius * R.brush.size * pxPerWorld();
      // 블렌더처럼: 원 중심을 커서 왼쪽에 두어 '지금 커서까지 거리 = 지금 값'에서 시작
      const d0 = kind === 'size' ? rpx : Math.max(20, rpx * Math.sqrt(Math.min(1, R.brush.strength / R.brush.strengthMax)));
      bmode = { kind, cx: mouse.x - d0, cy: mouse.y, d0, v0: kind === 'size' ? R.brush.size : R.brush.strength, size0: R.brush.size, str0: R.brush.strength };
      drawCursor();
    } else if (bmode && e.key === 'Enter') { e.preventDefault(); bmodeEnd(true); }
    else if (bmode && e.key === 'Escape') { e.preventDefault(); bmodeEnd(false); }
  }
  function bmodeMove() {
    const d = Math.max(4, Math.hypot(mouse.x - bmode.cx, mouse.y - bmode.cy)), B = R.brush;
    if (bmode.kind === 'size') B.size = Math.max(B.sizeMin, Math.min(B.sizeMax, bmode.v0 * d / bmode.d0));
    else B.strength = Math.max(B.strengthMin, Math.min(B.strengthMax, bmode.v0 * (d / bmode.d0) ** 2));
    drawCursor();
  }
  function bmodeEnd(ok) {
    if (!ok) { R.brush.size = bmode.size0; R.brush.strength = bmode.str0; }
    bmode = null; drawCursor();
    if (ok) for (const p of group.peers) if (p !== api) p.setBrush({ size: R.brush.size, strength: R.brush.strength });
    if (ok && o.onFeelChange) o.onFeelChange(api.getFeel());
  }
  // 조절 중 클릭은 확정(오른클릭은 취소)으로만 쓰고 주무르기로는 안 넘김 — capture 단계에서 먼저 가로챔
  const onDownCap = e => { if (!bmode) return; e.stopImmediatePropagation(); e.preventDefault(); bmodeEnd(e.button !== 2); };
  const onHover = e => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.over = true; if (bmode) bmodeMove(); else drawCursor(); };
  const onLeave = () => { mouse.over = false; if (!bmode) drawCursor(); };
  if (ui) { window.addEventListener('keydown', onKey); canvas.addEventListener('pointerdown', onDownCap, true);
    canvas.addEventListener('pointermove', onHover); canvas.addEventListener('pointerleave', onLeave); }
  canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp); canvas.addEventListener('pointercancel', onUp); canvas.addEventListener('contextmenu', noMenu);
  canvas.style.touchAction = 'none';

  /* 매 프레임: 필요하면 다시 뽑고, 출렁임·소리 반응은 법선 방향으로만 살짝 */
  /* ---------- 듣기: 마이크·음성 파일 ----------
     매 프레임 분석 → 크기(dB)·음높이(자기상관)·밝기(스펙트럼 중심)·잡음도(평탄도)·어택(스펙트럼 변화량)
     → 다섯 파형 비율: 맑고 낮은 모음=SINE · 밝고 배음 많은 소리=SQUARE · 'ㅅ/쉬' 같은 높은 잡음=WHITE · 숨·낮은 잡음=PINK · 파열음·박수=NEEDLE
     → 형태: 크기=부풀기, 음높이=위로 늘어남(부피 유지), 비율=표면 질감. 손으로 만든 형태는 그대로, 그 위에 덧입혀짐. */
  let listen = null;
  async function listenStart(source) {
    listenStop(); stop();
    const ac = new AudioContext(), an = ac.createAnalyser(); an.fftSize = 2048; an.smoothingTimeConstant = 0.2;
    if (ac.state === 'suspended') { try { await ac.resume(); } catch (_) {} }
    let node, stream = null, label;
    if (source === 'mic') {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      node = ac.createMediaStreamSource(stream); node.connect(an); label = 'MIC';
    } else {
      const ab = source instanceof ArrayBuffer ? source : source instanceof Blob ? await source.arrayBuffer() : await (await fetch(source)).arrayBuffer();
      const buf = await ac.decodeAudioData(ab); node = ac.createBufferSource(); node.buffer = buf; node.loop = true;
      const g = ac.createGain(); g.gain.value = mute ? 0 : 0.9; node.connect(an); node.connect(g).connect(ac.destination); node.start(); label = 'FILE';
    }
    listen = { ac, an, node, stream, label, td: new Float32Array(an.fftSize), fd: new Float32Array(an.frequencyBinCount), prev: null,
      loud: 0, sy: 1, pitch: 0, shares: [1, 0, 0, 0, 0], liveTex: [0, 0, 0, 0], tick: 0 };
    state.playing = false; dirty = true;
  }
  function listenStop() {
    if (!listen) return;
    try { listen.node.stop && listen.node.stop(); } catch (_) {}
    if (listen.stream) listen.stream.getTracks().forEach(t => t.stop());
    listen.ac.close(); listen = null; state.tag = 'IDLE'; dirty = true;
  }
  function analyze() {
    const L = listen, an = L.an, sr = L.ac.sampleRate, td = L.td, fd = L.fd, a = R.listen.smooth;
    an.getFloatTimeDomainData(td); an.getFloatFrequencyData(fd);
    let s2 = 0, pk = 0; for (let i = 0; i < td.length; i++) { s2 += td[i] * td[i]; const av = Math.abs(td[i]); if (av > pk) pk = av; }
    const rms = Math.sqrt(s2 / td.length), db = 20 * Math.log10(rms + 1e-9);
    const loud = Math.max(0, Math.min(1, (db - R.listen.dbFloor) / (R.listen.dbCeil - R.listen.dbFloor)));
    // 음높이: 자기상관(70~1000Hz), 또렷함 = 최고 상관 / r0
    let pitch = 0, clarity = 0;
    if (loud > 0.08) {
      const n = 1024, minL = Math.floor(sr / 1000), maxL = Math.floor(sr / 70); let r0 = 0; for (let i = 0; i < n; i++) r0 += td[i] * td[i];
      const rr = new Float32Array(maxL + 2); let gmax = 0;
      for (let lag = minL; lag <= maxL + 1; lag++) { let r = 0; for (let i = 0; i < n; i++) r += td[i] * td[i + lag]; rr[lag] = r / (r0 || 1); if (lag <= maxL && rr[lag] > gmax) gmax = rr[lag]; }
      let bl = 0;
      for (let lag = minL + 1; lag <= maxL; lag++) if (rr[lag] >= 0.9 * gmax && rr[lag] >= rr[lag - 1] && rr[lag] >= rr[lag + 1]) { bl = lag; break; }
      clarity = gmax;
      if (bl && gmax > 0.55) { const a0 = rr[bl - 1], a1 = rr[bl], a2 = rr[bl + 1], den = a0 - 2 * a1 + a2, off = den ? 0.5 * (a0 - a2) / den : 0; pitch = sr / (bl + off); }
    }
    // 스펙트럼: 밝기(중심)·잡음도(평탄도)·어택(변화량), 80Hz~10kHz
    const bin = sr / an.fftSize, b0 = Math.floor(80 / bin), b1 = Math.min(fd.length - 1, Math.floor(10000 / bin));
    let ps = 0, pc = 0, lg = 0, flux = 0, cnt = 0; const P = L.prev || new Float32Array(fd.length);
    for (let i = b0; i <= b1; i++) { const p = Math.pow(10, fd[i] / 10); ps += p; pc += p * i * bin; lg += Math.log(p + 1e-20); cnt++;
      const d = p - P[i]; if (d > 0) flux += d; P[i] = p; }
    L.prev = P;
    const centroid = ps > 0 ? pc / ps : 0, flat = ps > 0 ? Math.exp(lg / cnt) / (ps / cnt) : 0, fluxN = ps > 0 ? flux / ps : 0;
    let rich = 0; if (pitch) { const cut = Math.floor(3.5 * pitch / bin); let up = 0; for (let i = Math.max(b0, cut); i <= b1; i++) up += Math.pow(10, fd[i] / 10); rich = ps > 0 ? up / ps : 0; }
    const crest = rms > 0 ? pk / rms : 0, active = loud >= 0.06 || pk > 0.08;
    const bright = Math.max(0, Math.min(1, (centroid - 900) / 2600)), noisy = Math.max(0, Math.min(1, (flat - 0.05) / 0.3));
    const tonal = pitch ? Math.max(0, Math.min(1, (clarity - 0.4) / 0.5)) * (1 - noisy * 0.7) : 0;
    const buzz = Math.max(0, Math.min(1, (rich - 0.015) / 0.1));   // 톱니·버즈처럼 배음 많은 유성음(사람 목소리는 보통 일부 섞임)
    const breath = (1 - tonal) * Math.min(1, loud * 1.5);            // 유성음이 아닌 몫(숨·거친 소리)
    const hi = Math.max(0, Math.min(1, (centroid - 2200) / 2500));
    const att = Math.max(Math.max(0, Math.min(1, (crest - 4) / 5)), Math.max(0, Math.min(1, (fluxN - 0.6) / 1.5)) * loud);   // 짧고 뾰족한 어택
    const w = !active ? null : [
      tonal * (1 - buzz) * (1 - noisy * 0.5) + 0.02,                  // SINE: 맑은 모음·휘파람
      tonal * buzz,                                                     // SQUARE: 배음 많은 버즈
      att * 1.5,                                                        // NEEDLE: 파열음·박수
      (noisy + breath * 0.5) * (1 - hi) * (1 - att),                    // PINK: 숨·낮은 잡음
      (noisy + breath * 0.3) * hi * (1 - att),                          // WHITE: ㅅ·쉬
    ];
    if (w) { const sum = w.reduce((x, y) => x + y, 0) || 1; for (let k = 0; k < 5; k++) L.shares[k] += (w[k] / sum - L.shares[k]) * a; }
    const loudIn = Math.max(loud, Math.min(1, pk * 1.2) * 0.6);   // 짧은 어택도 부풀게
    L.loud += (loudIn - L.loud) * (loudIn > L.loud ? 0.7 : 0.18);   // 빨리 부풀고 천천히 가라앉음
    if (pitch) L.pitch = L.pitch ? L.pitch + (pitch - L.pitch) * 0.35 : pitch;
    const pn = L.pitch ? Math.max(0, Math.min(1, Math.log2(L.pitch / R.listen.pitchLo) / Math.log2(R.listen.pitchHi / R.listen.pitchLo))) : 0;
    const grow = baseS, wp = root.getWorldPosition(new THREE.Vector3()), viewHalf = camera.position.distanceTo(wp) * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * 0.9 - Math.abs(wp.y);
    const syMax = Math.max(1, Math.min(CE - 0.45, viewHalf) / (1.05 * grow));   // 계산 공간과 '화면 높이' 둘 다 안 넘게
    const syT = 1 + Math.min(R.listen.pitchStretch, syMax - 1) * pn * Math.min(1, L.loud * 2);   // 남은 높이 안에서 음높이를 나눠 씀 → 높은 음끼리도 차이 유지
    L.sy += (syT - L.sy) * 0.35;
    L.vis = Math.min(1, L.loud * 1.6); L.t = (L.t || 0) + 1 / 60;   // 결의 세기(소리 크기)·흐름 시간
    state.share = L.shares.slice(); state.f0 = pitch || 0; state.rms = rms * 3; state.hf = Math.min(1, L.shares[4] + L.shares[2] * 0.7); state.crest = L.shares[2];
    state.tag = L.label + ' · ' + (!active ? 'SILENT' : pitch ? (buzz > 0.5 ? 'BUZZ' : 'VOICED') : att > 0.5 ? 'ATTACK' : noisy > 0.5 ? 'NOISE' : 'SOUND');
    state.listen = { loud: L.loud, pitch: L.pitch, stretch: L.sy, centroid, flat, clarity, rich, crest };
  }
  function update(t) {
    { const n = Math.max(1, group.peers.filter(p => p.state.playing).length), lv = 1 / Math.sqrt(n);
      if (Math.abs(lv - level) > 0.01) { level = lv;
        if (tone) tone.master.gain.setTargetAtTime(level, tone.ac.currentTime, 0.1);
        if (bird && bird.node) bird.node.port.postMessage({ level }); } }
    if (listen) { analyze(); if ((listen.tick++ & 1) === 0) dirty = true; }
    // 강성: 끝 덩어리가 목표를 한 박자 늦게, 무겁게 따라감
    const follow = 1 - R.pull.lag * stiffness;   // 지연은 약하게(직접 잡고 있는 느낌 유지), 저항은 '덜 늘어남'으로 표현
    if (drag && drag.kind === 'pull' && drag.stroke && drag.cursor) tetherShow(drag.stroke.b, drag.cursor);
    for (const s of strokes) if (s.bT) { const dx = s.bT.x - s.b.x, dy = s.bT.y - s.b.y, dz = s.bT.z - s.b.z;
      if (dx * dx + dy * dy + dz * dz > 1e-6) { s.b.x += dx * follow; s.b.y += dy * follow; s.b.z += dz * follow; dirty = true; } }
    if (drag && drag.kind === 'rub' && performance.now() - drag.lastMove > R.gesture.holdMs && drag.trail.length) {
      paint(drag.trail[drag.trail.length - 1], 'pink', R.gesture.holdAmt, null, 0.45); state.tag = 'HOLD → PINK'; }
    if (dirty) { dirty = false; build(); mix(); } else if ((tick++ % 6) === 0) mix();
    const M = R.motion, k = M.react, F = state, inv = 1 / CE, tt = t * 0.55;
    const A = { breath: k * 0.010 * F.rms, grain: k * 0.007 * F.hf * Math.min(1, F.rms * 4), spike: k * 0.010 * F.crest * Math.min(1, F.rms * 6), gf: 5 + Math.min(4, (F.f0 || 0) / 1000), ph: t * (0.6 + 5 * F.hf) };
    const pa = mc.positionArray, nA = mc.normalArray;
    for (let i = 0; i < mcN; i++) {
      const x = mcBase[i*3], y = mcBase[i*3+1], z = mcBase[i*3+2], X = x * CE, Y = y * CE, Z = z * CE;
      let nx = nA[i*3], ny = nA[i*3+1], nz = nA[i*3+2]; const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      let d = M.wobble * (Math.sin(X * 1.7 + tt) * Math.sin(Y * 1.5 - tt * 0.8) + 0.6 * Math.sin(Z * 1.9 + tt * 0.6));
      d += A.breath + A.grain * Math.sin(X * A.gf + A.ph) * Math.sin(Y * A.gf - A.ph * 0.6) + A.spike * Math.max(0, Math.sin(X * 11 + A.ph * 2) * Math.sin(Z * 11 - A.ph));
      d *= inv; pa[i*3] = x + nx * d; pa[i*3+1] = y + ny * d; pa[i*3+2] = z + nz * d;
    }
    mc.geometry.getAttribute('position').needsUpdate = true;
  }

  const api = {
    get brush() { return { size: R.brush.size, strength: R.brush.strength }; },
    setBrush({ size, strength } = {}) { const B = R.brush; if (size != null) B.size = Math.max(B.sizeMin, Math.min(B.sizeMax, size)); if (strength != null) B.strength = Math.max(B.strengthMin, Math.min(B.strengthMax, strength)); drawCursor(); },
    root, mesh: mc, state, rules: R, update, start, stop,
    reset() { pushHistory(true); cons.delta = 0; cons.lastV = null; strokes.length = 0; TEXG.fill(0); baseS = 1; volGoal = 1; dirty = true; },   // 초기화도 Ctrl+Z로 되돌릴 수 있음
    inflate,                                   // inflate(1.1) = 10% 더 / inflate(0.9) = 덜어냄
    setStiffness(v) { stiffness = Math.max(0, Math.min(1, v)); },   // 0 = 무른 찰흙(손 따라 1:1), 1 = 아주 단단함
    get stiffness() { return stiffness; },
    // 목소리만 바꿈: 형태·질감·부피는 그대로 두고, 새 목소리가 지금 형태 변수를 바로 읽어 그에 맞춰 소리 냄
    async setVoice(v) {
      if (!VOICES.includes(v) || v === voice) return;
      const was = state.playing; stop(); voice = v; state.tag = 'IDLE'; state.f0 = 0;
      if (was) await start(); else mix();
    },
    get voice() { return voice; },
    // 듣기: listen('mic') 내 목소리 · listen(File/Blob/ArrayBuffer/URL) 음성 파일(반복 재생하며 분석) · stopListening()
    listen: listenStart, stopListening: listenStop, get listening() { return listen ? listen.label : null; },
    setSpread(v) { spread = Math.max(0, Math.min(1, v)); dirty = true; },   // 0 = 국소, 1 = 몸통 전체가 같이 늘어남
    get spread() { return spread; },
    setPitchScale(x) { pitchScale = Math.max(0.1, Math.min(8, x)); dirty = true; },   // 조율 바꾸기(형태·질감은 그대로)
    get pitchScale() { return pitchScale; },
    // 화음 모드: setKey({ rootHz, scale }) — 같은 캔버스 전체에 적용 · setNote(Hz) — 이 오브젝트가 맡은 음
    setKey(k) { if (MIX) return; keyOpt = k || null; group.key = k || null; for (const p of group.peers) p._dirty(); },
    _mixKey(k) { keyOpt = k; group.key = k; dirty = true; mix(); },   // mix 모드 전용(벽시계 코드) — 화면 갱신(rAF)이 멈춰 있어도(숨은 탭) 소리 엔진에 바로 전달
    get key() { return keyOpt || group.key || null; },
    setNote(hz) { note = hz || 0; dirty = true; },
    get note() { return note; },
    _dirty() { dirty = true; },
    // 감각 프리셋 내보내기/적용 — 다른 세션·화면에 그대로 옮길 때 쓰는 단위
    getFeel(name = 'feel') { const values = {};
      for (const f of FEEL_SCHEMA) values[f.key] = f.key === 'stiffness' ? stiffness : f.key === 'spread' ? spread : getPath(R, f.key);
      return { type: 'sound-clay-feel', version: 1, name, values }; },
    setFeel(feel) { const v = (feel && feel.values) || feel || {};
      for (const f of FEEL_SCHEMA) { if (!(f.key in v)) continue; const x = Math.max(f.min, Math.min(f.max, +v[f.key]));
        if (f.key === 'stiffness') stiffness = x; else if (f.key === 'spread') spread = x; else setPath(R, f.key, x); }
      dirty = true; },
    undo, redo,                                // Ctrl+Z / Ctrl+Shift+Z·Ctrl+Y 와 같음
    get history() { return { undo: undoStack.length, redo: redoStack.length }; },
    // 코드로 직접 조작(테스트·자동 연출용)
    pull(fromLocal, toLocal) { const a = fromLocal.clone(), inward = a.clone().multiplyScalar(-1).normalize();
      strokes.push({ type: 'pull', a: a.clone().addScaledVector(inward, R.pull.inset), b: toLocal.clone(), hit: a.clone() }); dirty = true; },
    paint(localPoint, kind, amt = 0.3, dir = null, rad) { paint(localPoint, kind, amt, dir, rad); },
    rebuild() { build(); mix(); },
    dispose() { stop(); if (ui) { window.removeEventListener('keydown', onKey); canvas.removeEventListener('pointerdown', onDownCap, true); canvas.removeEventListener('pointermove', onHover); canvas.removeEventListener('pointerleave', onLeave); cur.remove(); curLabel.remove(); }
      canvas.removeEventListener('wheel', onWheel); canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp); canvas.removeEventListener('pointercancel', onUp); canvas.removeEventListener('contextmenu', noMenu);
      parent.remove(root); mc.geometry.dispose();
      const i = group.peers.indexOf(api); if (i >= 0) group.peers.splice(i, 1); if (group.active === api) group.active = null; MIX_APIS.delete(api); },
    activate() { group.active = api; },        // 코드로 '지금 만질 대상' 지정(마이크 연결할 물방울 고를 때 등)
    get active() { return isActive(); },
  };
  if (o.feel) api.setFeel(o.feel);   // 감각 프리셋을 넘기면 시작부터 그 손맛
  api._hitDist = hitDist; group.peers.push(api); if (MIX) MIX_APIS.add(api);
  return api;
}

function deepMerge(a, b) { for (const k in b) { if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k])) a[k] = deepMerge(a[k] || {}, b[k]); else a[k] = b[k]; } return a; }
