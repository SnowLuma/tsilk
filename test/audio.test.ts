import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import WavefilePkg from 'wavefile';
import { Mp3Encoder } from '@breezystack/lamejs';

import { encodeSilkFile, decodeSilkFile } from '../src/silk_file';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const { WaveFile } = WavefilePkg;

/**
 * 音频处理库测试：实现 WAV <-> MP3 <-> SILK 自由转换
 * 
 * 使用库：
 * - wavefile: 处理 WAV 读写
 * - @breezystack/lamejs: 纯 JS 实现的 MP3 编码
 * - audio-resampler: 重采样 (此处使用系统内置或手动实现简单重采样以确保位精确可控)
 * - tsilk: 本项目提供的 SILK 编解码器
 */

// 简单的线性重采样算法 (FFmpeg 同款思路的简化版)
function resample(input: Int16Array, fromRate: number, toRate: number): Int16Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const newLength = Math.round(input.length / ratio);
  const output = new Int16Array(newLength);
  for (let i = 0; i < newLength; i++) {
    const pos = i * ratio;
    const index = Math.floor(pos);
    const frac = pos - index;
    if (index + 1 < input.length) {
      output[i] = Math.round(input[index] * (1 - frac) + input[index + 1] * frac);
    } else {
      output[i] = input[index];
    }
  }
  return output;
}

// --- 核心转换逻辑 ---

/**
 * WAV 转 SILK (Tencent 格式，带 #!SILK\n 头部)
 */
async function wavToSilk(wavPath: string, silkPath: string, rate: number = 24000) {
  const wavBuffer = fs.readFileSync(wavPath);
  const wav = new WaveFile(wavBuffer);
  wav.toBitDepth('16'); // 强制 16bit
  const samples = wav.getSamples(false) as unknown as Int16Array;
  const currentRate = wav.container === 'RIFF' ? (wav as any).fmt.sampleRate : 0;
  
  // 重采样至 SILK 支持的速率 (8k, 12k, 16k, 24k)
  const pcm = resample(samples, currentRate || rate, rate);
  
  const silkData = encodeSilkFile(pcm, rate, {
      bitRate: 24000,
      packetSizeMs: 20,
      useDTX: true,
      tencent: true // 包含 #!SILK\n 头部
  });
  
  fs.writeFileSync(silkPath, Buffer.from(silkData));
  console.log(`[WAV -> SILK] ${wavPath} -> ${silkPath} (${rate}Hz)`);
}

/**
 * SILK 转 WAV
 */
async function silkToWav(silkPath: string, wavPath: string, outRate: number = 24000) {
  const silkData = fs.readFileSync(silkPath);
  const pcm = decodeSilkFile(silkData, outRate);
  
  const wav = new WaveFile();
  wav.fromScratch(1, outRate, '16', pcm);
  fs.writeFileSync(wavPath, wav.toBuffer());
  console.log(`[SILK -> WAV] ${silkPath} -> ${wavPath} (${outRate}Hz)`);
}

/**
 * WAV 转 MP3
 */
async function wavToMp3(wavPath: string, mp3Path: string) {
  const wavBuffer = fs.readFileSync(wavPath);
  const wav = new WaveFile(wavBuffer);
  wav.toBitDepth('16');
  const samples = wav.getSamples(false) as unknown as Int16Array;
  const sampleRate = (wav as any).fmt.sampleRate;
  
  const mp3encoder = new Mp3Encoder(1, sampleRate, 128);
  const mp3Data: Uint8Array[] = [];
  
  const sampleBlockSize = 576; // LAME 默认块大小
  for (let i = 0; i < samples.length; i += sampleBlockSize) {
    const chunk = samples.subarray(i, i + sampleBlockSize);
    const mp3buf = mp3encoder.encodeBuffer(chunk);
    if (mp3buf.length > 0) mp3Data.push(new Uint8Array(mp3buf));
  }
  const endBuf = mp3encoder.flush();
  if (endBuf.length > 0) mp3Data.push(new Uint8Array(endBuf));
  
  const totalLength = mp3Data.reduce((acc, curr) => acc + curr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of mp3Data) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  
  fs.writeFileSync(mp3Path, Buffer.from(result));
  console.log(`[WAV -> MP3] ${wavPath} -> ${mp3Path}`);
}

// --- 测试执行 ---

async function main() {
  const testDir = path.resolve(__dirname, '../out_audio_test');
  if (!fs.existsSync(testDir)) fs.mkdirSync(testDir);
  
  // 1. 生成一个正弦波 WAV（模拟输入）
  const sampleRate = 24000;
  const duration = 2; // 2秒
  const pcm = new Int16Array(sampleRate * duration);
  for (let i = 0; i < pcm.length; i++) {
     pcm[i] = Math.sin(2 * Math.PI * 440 * i / sampleRate) * 10000;
  }
  const inputWav = path.join(testDir, 'input.wav');
  const wav = new WaveFile();
  wav.fromScratch(1, sampleRate, '16', pcm);
  fs.writeFileSync(inputWav, wav.toBuffer());
  console.log(`[INIT] Created test input: ${inputWav}`);

  // 2. 转换流程测试
  const outputSilk = path.join(testDir, 'output.silk');
  const outputWavFromSilk = path.join(testDir, 'output_from_silk.wav');
  const outputMp3 = path.join(testDir, 'output.mp3');

  try {
    // WAV -> SILK
    await wavToSilk(inputWav, outputSilk, 24000);
    
    // SILK -> WAV
    await silkToWav(outputSilk, outputWavFromSilk, 24000);
    
    // WAV -> MP3
    await wavToMp3(inputWav, outputMp3);
    
    console.log('\n[SUCCESS] Audio conversion tool test passed!');
    console.log(`Check outputs in: ${testDir}`);
  } catch (err) {
    console.error('[ERROR]', err);
    process.exit(1);
  }
}

main();
