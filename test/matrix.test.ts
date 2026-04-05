import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { decodeSilkFile, encodeSilkFile } from '../src/silk_file';

// --- 类型定义 ---

type InputProfile =
  | 'speechy'
  | 'silence'
  | 'impulse_step'
  | 'clip_toggle'
  | 'chirp_noise'
  | 'dc_ramp'
  | 'burst_noise';

type CaseCfg = {
  name: string;
  apiSampleRate: number;
  maxInternalSampleRate: number;
  packetSizeMs: number;
  bitRate: number;
  packetLossPercentage: number;
  useInBandFEC: boolean;
  complexity: number;
  useDTX: boolean;
  profile: InputProfile;
  sampleCount: number;
};

type DiffPoint = {
  offset: number;
  a: number | null;
  b: number | null;
};

// --- 实用工具 ---

function writePcm16(filePath: string, pcm: Int16Array): void {
  const out = Buffer.allocUnsafe(pcm.length * 2);
  for (let i = 0; i < pcm.length; i++) {
    out.writeInt16LE(pcm[i] | 0, i * 2);
  }
  fs.writeFileSync(filePath, out);
}

function readPcm16(filePath: string): Int16Array {
  const buf = fs.readFileSync(filePath);
  return new Int16Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

function makeRng(seed0: number): () => number {
  let seed = seed0 | 0;
  return () => {
    seed = (Math.imul(seed, 1103515245) + 12345) | 0;
    return ((seed >>> 16) & 0x7fff) / 32768;
  };
}

function genProfilePcm(sampleRate: number, sampleCount: number, profile: InputProfile, seedBase: number): Int16Array {
  const pcm = new Int16Array(sampleCount);
  const rnd = makeRng(seedBase ^ sampleRate ^ (profile.length << 20));

  for (let i = 0; i < sampleCount; i++) {
    const t = i / Math.max(1, sampleRate);
    const p = i / Math.max(1, sampleCount - 1);
    let v = 0;

    if (profile === 'silence') {
      v = (p > 0.48 && p < 0.5) ? 0.002 * (rnd() * 2 - 1) : 0;
    } else if (profile === 'impulse_step') {
      const step = p > 0.55 ? 0.3 : -0.3;
      const imp = (i % Math.max(1, Math.floor(sampleRate / 53)) === 0) ? 0.8 : 0;
      v = step + imp + 0.18 * Math.sin(2 * Math.PI * 290 * t);
    } else if (profile === 'clip_toggle') {
      const block = Math.floor(i / Math.max(1, Math.floor(sampleRate * 0.0125)));
      const sq = (block & 1) ? 0.98 : -0.98;
      v = sq + 0.15 * Math.sin(2 * Math.PI * 710 * t);
    } else if (profile === 'chirp_noise') {
      const f = 60 + 3500 * p;
      const gate = (p > 0.2 && p < 0.26) || (p > 0.66 && p < 0.73) ? 0 : 1;
      const noise = (rnd() * 2 - 1) * (0.03 + 0.2 * (p > 0.5 ? 1 : 0));
      v = gate * (0.7 * Math.sin(2 * Math.PI * f * t) + noise);
    } else if (profile === 'dc_ramp') {
      const ramp = -0.6 + 1.2 * p;
      v = ramp + 0.08 * Math.sin(2 * Math.PI * 180 * t);
    } else if (profile === 'burst_noise') {
      const burst = ((Math.floor(p * 10) % 2) === 0) ? 0.35 : 0.0;
      v = burst * (rnd() * 2 - 1) + 0.22 * Math.sin(2 * Math.PI * (220 + 400 * p) * t);
    } else {
      // speechy
      if (p < 0.14) {
        v = 0.82 * Math.sin(2 * Math.PI * 220 * t);
      } else if (p < 0.23) {
        v = 0;
      } else if (p < 0.49) {
        v = 0.58 * Math.sin(2 * Math.PI * 670 * t) + 0.12 * Math.sin(2 * Math.PI * 1340 * t);
      } else if (p < 0.72) {
        v = (rnd() * 2 - 1) * 0.3;
      } else if (p < 0.79) {
        v = 0;
      } else {
        const f = 150 + 600 * ((p - 0.79) / 0.21);
        v = 0.62 * Math.sin(2 * Math.PI * f * t);
      }
    }

    const s = Math.max(-1, Math.min(1, v));
    pcm[i] = (s * 32767) | 0;
  }
  return pcm;
}

function compareBuffers(
  a: Buffer,
  b: Buffer,
  maxPoints: number,
): { equal: boolean; diffCount: number; points: DiffPoint[] } {
  const minLen = Math.min(a.length, b.length);
  let diffCount = 0;
  const points: DiffPoint[] = [];

  for (let i = 0; i < minLen; i++) {
    if (a[i] !== b[i]) {
      diffCount++;
      if (points.length < maxPoints) {
        points.push({ offset: i, a: a[i], b: b[i] });
      }
    }
  }

  if (a.length !== b.length) {
    const diffLen = Math.abs(a.length - b.length);
    diffCount += diffLen;
    const padLen = Math.min(diffLen, Math.max(0, maxPoints - points.length));
    for (let i = 0; i < padLen; i++) {
      const off = minLen + i;
      points.push({
        offset: off,
        a: off < a.length ? a[off] : null,
        b: off < b.length ? b[off] : null,
      });
    }
  }

  return { equal: diffCount === 0, diffCount, points };
}

function silenceStdout<T>(fn: () => T): T {
  const originalWrite = process.stdout.write.bind(process.stdout);
  const sink = (() => true) as unknown as typeof process.stdout.write;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.stdout as any).write = sink;
  try {
    return fn();
  } finally {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stdout as any).write = originalWrite;
  }
}

// --- 核心运行逻辑 ---

function runCase(cfg: CaseCfg, paths: {
  outDir: string;
  cEncoder: string;
  cDecoder: string;
  pcmInput: string;
}): {
  cfg: CaseCfg;
  ok: boolean;
  details: string;
  points: string[];
} {
  try {
    const slug = cfg.name;
    const cSilk = path.join(paths.outDir, `${slug}.c.silk`);
    const tsSilk = path.join(paths.outDir, `${slug}.ts.silk`);
    const cFromC = path.join(paths.outDir, `${slug}.c_from_c.pcm`);
    const cFromTs = path.join(paths.outDir, `${slug}.c_from_ts.pcm`);
    const tsFromC = path.join(paths.outDir, `${slug}.ts_from_c.pcm`);
    const tsFromTs = path.join(paths.outDir, `${slug}.ts_from_ts.pcm`);

    execFileSync(paths.cEncoder, [
      paths.pcmInput,
      cSilk,
      '-Fs_API', String(cfg.apiSampleRate),
      '-Fs_maxInternal', String(cfg.maxInternalSampleRate),
      '-packetlength', String(cfg.packetSizeMs),
      '-rate', String(cfg.bitRate),
      '-loss', String(cfg.packetLossPercentage),
      '-inbandFEC', cfg.useInBandFEC ? '1' : '0',
      '-complexity', String(cfg.complexity),
      '-DTX', cfg.useDTX ? '1' : '0',
      '-quiet',
    ], { stdio: 'ignore' });

    const pcm = readPcm16(paths.pcmInput);
    const tsData = silenceStdout(() =>
      encodeSilkFile(pcm, cfg.apiSampleRate, {
        bitRate: cfg.bitRate,
        packetSizeMs: cfg.packetSizeMs,
        maxInternalSampleRate: cfg.maxInternalSampleRate,
        packetLossPercentage: cfg.packetLossPercentage,
        useInBandFEC: cfg.useInBandFEC,
        complexity: cfg.complexity,
        useDTX: cfg.useDTX,
      }),
    );
    fs.writeFileSync(tsSilk, Buffer.from(tsData));

    const cSilkBuf = fs.readFileSync(cSilk);
    const tsSilkBuf = fs.readFileSync(tsSilk);

    execFileSync(paths.cDecoder, [cSilk, cFromC, '-Fs_API', String(cfg.apiSampleRate), '-loss', '0', '-quiet'], { stdio: 'ignore' });
    execFileSync(paths.cDecoder, [tsSilk, cFromTs, '-Fs_API', String(cfg.apiSampleRate), '-loss', '0', '-quiet'], { stdio: 'ignore' });

    writePcm16(tsFromC, silenceStdout(() => decodeSilkFile(cSilkBuf, cfg.apiSampleRate)));
    writePcm16(tsFromTs, silenceStdout(() => decodeSilkFile(tsSilkBuf, cfg.apiSampleRate)));

    const encCmp = compareBuffers(cSilkBuf, tsSilkBuf, 10);
    const decCCmp = compareBuffers(fs.readFileSync(cFromC), fs.readFileSync(tsFromC), 10);
    const decTSCmp = compareBuffers(fs.readFileSync(cFromTs), fs.readFileSync(tsFromTs), 10);

    const ok = encCmp.equal && decCCmp.equal && decTSCmp.equal;
    const details = `enc=${encCmp.diffCount} decC=${decCCmp.diffCount} decTs=${decTSCmp.diffCount}`;

    const points: string[] = [];
    const append = (label: string, cmp: ReturnType<typeof compareBuffers>) => {
      for (const p of cmp.points) {
        if (points.length >= 10) break;
        points.push(`${label}@${p.offset}: C=${p.a === null ? 'EOF' : p.a} TS=${p.b === null ? 'EOF' : p.b}`);
      }
    };
    append('enc', encCmp);
    append('decC', decCCmp);
    append('decTs', decTSCmp);

    return { cfg, ok, details, points };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { cfg, ok: false, details: `error=${msg}`, points: [] };
  }
}

// --- 测试用例构建 ---

function main(): void {
  const pkgRoot = path.resolve(__dirname, '..');
  const outDir = path.resolve(pkgRoot, 'out_matrix');
  fs.mkdirSync(outDir, { recursive: true });

  const silkcDir = path.resolve(pkgRoot, 'silkc');
  const cEncoder = path.resolve(silkcDir, 'Encoder' + (process.platform === 'win32' ? '.exe' : ''));
  const cDecoder = path.resolve(silkcDir, 'Decoder' + (process.platform === 'win32' ? '.exe' : ''));
  
  if (!fs.existsSync(cEncoder) || !fs.existsSync(cDecoder)) {
    throw new Error(`C Encoder/Decoder not found in ${silkcDir}.`);
  }

  // 1. 基础矩阵用例 (原 matrix.ts)
  const baseCases: CaseCfg[] = [
    { name: 'base_sr8_pkt20_br6000_c0_f0_d0', apiSampleRate: 8000, maxInternalSampleRate: 8000, packetSizeMs: 20, bitRate: 6000, packetLossPercentage: 0, useInBandFEC: false, complexity: 0, useDTX: false, profile: 'speechy', sampleCount: 8000 * 2 },
    { name: 'base_sr8_pkt100_br10000_c2_f1_d0', apiSampleRate: 8000, maxInternalSampleRate: 8000, packetSizeMs: 100, bitRate: 10000, packetLossPercentage: 5, useInBandFEC: true, complexity: 2, useDTX: false, profile: 'speechy', sampleCount: 8000 * 2 },
    { name: 'base_sr12_pkt20_br12000_c1_f0_d1', apiSampleRate: 12000, maxInternalSampleRate: 12000, packetSizeMs: 20, bitRate: 12000, packetLossPercentage: 0, useInBandFEC: false, complexity: 1, useDTX: true, profile: 'speechy', sampleCount: 12000 * 2 },
    { name: 'base_sr12_pkt60_br18000_c2_f1_d0', apiSampleRate: 12000, maxInternalSampleRate: 12000, packetSizeMs: 60, bitRate: 18000, packetLossPercentage: 10, useInBandFEC: true, complexity: 2, useDTX: false, profile: 'speechy', sampleCount: 12000 * 2 },
    { name: 'base_sr16_pkt20_br25000_c2_f0_d0', apiSampleRate: 16000, maxInternalSampleRate: 16000, packetSizeMs: 20, bitRate: 25000, packetLossPercentage: 0, useInBandFEC: false, complexity: 2, useDTX: false, profile: 'speechy', sampleCount: 16000 * 2 },
    { name: 'base_sr16_pkt40_br14000_c0_f1_d1', apiSampleRate: 16000, maxInternalSampleRate: 16000, packetSizeMs: 40, bitRate: 14000, packetLossPercentage: 15, useInBandFEC: true, complexity: 0, useDTX: true, profile: 'speechy', sampleCount: 16000 * 2 },
    { name: 'base_sr24_pkt20_br40000_c2_f0_d0', apiSampleRate: 24000, maxInternalSampleRate: 24000, packetSizeMs: 20, bitRate: 40000, packetLossPercentage: 0, useInBandFEC: false, complexity: 2, useDTX: false, profile: 'speechy', sampleCount: 24000 * 2 },
    { name: 'base_sr24_pkt60_br25000_c1_f1_d0', apiSampleRate: 24000, maxInternalSampleRate: 24000, packetSizeMs: 60, bitRate: 25000, packetLossPercentage: 5, useInBandFEC: true, complexity: 1, useDTX: false, profile: 'speechy', sampleCount: 24000 * 2 },
    { name: 'base_sr24_pkt100_br12000_c0_f1_d1', apiSampleRate: 24000, maxInternalSampleRate: 24000, packetSizeMs: 100, bitRate: 12000, packetLossPercentage: 20, useInBandFEC: true, complexity: 0, useDTX: true, profile: 'speechy', sampleCount: 24000 * 2 },
  ];

  // 2. 压力/边缘用例
  const stressCases: CaseCfg[] = [
    { name: 'stress_resample_sr16_i8', apiSampleRate: 16000, maxInternalSampleRate: 8000, packetSizeMs: 20, bitRate: 8000, packetLossPercentage: 0, useInBandFEC: false, complexity: 2, useDTX: false, profile: 'chirp_noise', sampleCount: 16000 * 1 },
    { name: 'stress_resample_sr24_i12', apiSampleRate: 24000, maxInternalSampleRate: 12000, packetSizeMs: 40, bitRate: 12000, packetLossPercentage: 10, useInBandFEC: true, complexity: 1, useDTX: true, profile: 'speechy', sampleCount: 24000 * 1 },
    { name: 'stress_dc_ramp', apiSampleRate: 12000, maxInternalSampleRate: 12000, packetSizeMs: 20, bitRate: 12000, packetLossPercentage: 0, useInBandFEC: false, complexity: 1, useDTX: false, profile: 'dc_ramp', sampleCount: 12000 * 1 },
  ];

  const allCases = [...baseCases, ...stressCases];
  const results = [] as ReturnType<typeof runCase>[];
  let seed = 12345;

  for (const cfg of allCases) {
    const pcmInput = path.join(outDir, `${cfg.name}_in.pcm`);
    writePcm16(pcmInput, genProfilePcm(cfg.apiSampleRate, cfg.sampleCount, cfg.profile, seed++));
    
    const r = runCase(cfg, { outDir, cEncoder, cDecoder, pcmInput });
    results.push(r);
    
    console.log(`${r.ok ? '[OK]' : '[DIFF]'} ${cfg.name}`);
    if (!r.ok) {
      console.log(`  ${r.details}`);
      r.points.forEach(p => console.log(`  ${p}`));
    }
  }

  const failed = results.filter(r => !r.ok);
  console.log(`\nSummary: total=${results.length}, passed=${results.length - failed.length}, failed=${failed.length}`);

  // 清理 C 程序生成的诊断日志
  const diagLog = path.resolve(pkgRoot, 'c_diag_trace.jsonl');
  if (fs.existsSync(diagLog)) {
    try {
      fs.unlinkSync(diagLog);
    } catch {
      // ignore
    }
  }

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main();
