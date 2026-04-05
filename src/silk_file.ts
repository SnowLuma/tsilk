/**
 * SILK v3 File Format Handler
 * Handles the SILK file container format:
 *   - "#!SILK_V3" header (9 bytes) or "\x02#!SILK_V3" (Tencent variant, 10 bytes)
 *   - Sequence of: [int16_le payload_size] [payload_bytes...]
 *   - payload_size == -1 signals end of stream
 */
import { SilkDecoder, DecControlStruct } from './decoder';
import { SILK_V3_HEADER, SILK_V3_HEADER_TENCENT } from './defines';
import { SilkEncoder } from './encoder';
import { encodeFrame } from './encode_frame';
import { resample } from './resampler';
import * as D from './defines';
import { DecoderState, createDecoderControl } from './structs';
import { initDecoder } from './decoder_init';
import { rangeDecInit } from './range_coder';
import { decodeParameters } from './decode_parameters';

const SUPPORTED_API_SAMPLE_RATES = new Set([8000, 12000, 16000, 24000]);

function validateApiSampleRate(sampleRate: number): number {
    const normalized = sampleRate | 0;
    if (!SUPPORTED_API_SAMPLE_RATES.has(normalized)) {
        throw new Error(
            `Unsupported SILK sample rate: ${sampleRate}. Expected one of 8000, 12000, 16000, 24000 Hz.`
        );
    }
    return normalized;
}

/** Decode a SILK v3 file buffer to PCM Int16 samples */
export function decodeSilkFile(
    silkData: Buffer | Uint8Array,
    sampleRate: number = 24000
): Int16Array {
    const data = silkData instanceof Uint8Array ? silkData : new Uint8Array(silkData);
    let offset = 0;

    // Check and skip header
    const headerStr9 = String.fromCharCode(...data.subarray(0, 9));
    const headerStr10 = String.fromCharCode(...data.subarray(0, 10));

    if (headerStr10 === SILK_V3_HEADER_TENCENT) {
        offset = 10;
    } else if (headerStr9 === SILK_V3_HEADER) {
        offset = 9;
    } else {
        throw new Error('Invalid SILK v3 file: header not found');
    }

    const decoder = new SilkDecoder();
    const decControl: DecControlStruct = {
        API_sampleRate: sampleRate,
        frameSize: 0,
        framesPerPacket: 1,
        moreInternalDecoderFrames: 0,
        inBandFECOffset: 0,
    };

    const allSamples: Int16Array[] = [];

    const packets: Uint8Array[] = [];
    while (offset + 2 <= data.length) {
        const payloadSize = data[offset] | (data[offset + 1] << 8);
        offset += 2;

        const signedSize = payloadSize > 32767 ? payloadSize - 65536 : payloadSize;
        if (signedSize < 0) break;
        if (offset + signedSize > data.length) break;

        packets.push(data.subarray(offset, offset + signedSize));
        offset += signedSize;
    }

    const MAX_LBRR_DELAY = D.MAX_LBRR_DELAY;
    const q: Uint8Array[] = [new Uint8Array(0), new Uint8Array(0), new Uint8Array(0)];
    let readIdx = 0;

    for (let i = 0; i < MAX_LBRR_DELAY && readIdx < packets.length; i++) {
        q[i] = packets[readIdx++];
    }

    const decodePacket = (payload: Uint8Array): void => {
        const result = decoder.decode(payload, payload.length, decControl);
        if (result.samplesOut > 0) {
            allSamples.push(new Int16Array(result.samples));
        }
        while (decControl.moreInternalDecoderFrames) {
            const moreResult = decoder.decode(payload, payload.length, decControl);
            if (moreResult.samplesOut > 0) {
                allSamples.push(new Int16Array(moreResult.samples));
            }
        }
    };

    const decodeLoss = (): void => {
        const plcFrames = Math.max(1, decControl.framesPerPacket | 0);
        for (let i = 0; i < plcFrames; i++) {
            const plcResult = decoder.decode(null, 0, decControl);
            if (plcResult.samplesOut > 0) {
                allSamples.push(new Int16Array(plcResult.samples));
            }
        }
    };

    const processQueueHead = (): void => {
        let lost = q[0].length === 0;
        let payloadToDec: Uint8Array | null = lost ? null : q[0];

        if (lost) {
            for (let i = 0; i < MAX_LBRR_DELAY; i++) {
                const candidate = q[i + 1];
                if (candidate.length > 0) {
                    const fec = searchForLBRR(candidate, i + 1);
                    if (fec && fec.length > 0) {
                        payloadToDec = fec;
                        lost = false;
                        break;
                    }
                }
            }
        }

        if (lost || !payloadToDec) {
            decodeLoss();
        } else {
            decodePacket(payloadToDec);
        }

        q[0] = q[1];
        q[1] = q[2];
        q[2] = new Uint8Array(0);
    };

    while (readIdx < packets.length) {
        q[2] = packets[readIdx++];
        processQueueHead();
    }

    for (let i = 0; i < MAX_LBRR_DELAY; i++) {
        processQueueHead();
    }

    // Concatenate all decoded samples
    const totalLen = allSamples.reduce((sum, arr) => sum + arr.length, 0);
    const output = new Int16Array(totalLen);
    let pos = 0;
    for (const chunk of allSamples) {
        output.set(chunk, pos);
        pos += chunk.length;
    }
    return output;
}

function searchForLBRR(inData: Uint8Array, lostOffset: number): Uint8Array | null {
    if (lostOffset < 1 || lostOffset > D.MAX_LBRR_DELAY) {
        return null;
    }

    const sDec = new DecoderState();
    initDecoder(sDec);
    sDec.nFramesDecoded = 0;
    sDec.fs_kHz = 0;
    sDec.lossCnt = 0;
    sDec.prevNLSF_Q15.fill(0);
    rangeDecInit(sDec.sRC, inData, inData.length);

    const sDecCtrl = createDecoderControl();
    const tempQ = new Int32Array(D.MAX_FRAME_LENGTH);

    while (true) {
        decodeParameters(sDec, sDecCtrl, tempQ, 0);

        if (sDec.sRC.error) {
            return null;
        }

        if (((sDec.FrameTermination - 1) & lostOffset) !== 0 &&
            sDec.FrameTermination > 0 &&
            sDec.nBytesLeft >= 0) {
            return inData.subarray(inData.length - sDec.nBytesLeft);
        }

        if (sDec.nBytesLeft > 0 && sDec.FrameTermination === D.SKP_SILK_MORE_FRAMES) {
            sDec.nFramesDecoded++;
        } else {
            return null;
        }
    }
}

/** Encode PCM Int16 samples to SILK v3 file format (simplified) */
export function encodeSilkFile(
    pcmData: Int16Array,
    sampleRate: number = 24000,
    options: {
        tencent?: boolean;
        bitRate?: number;
        packetSizeMs?: number;
        maxInternalSampleRate?: number;
        packetLossPercentage?: number;
        useInBandFEC?: boolean;
        complexity?: number;
        useDTX?: boolean;
    } = {}
): Uint8Array {
    sampleRate = validateApiSampleRate(sampleRate);
    const frameMs = 20; // 20ms per frame
    const packetSizeMs = options.packetSizeMs ?? frameMs;
    const maxInternalSampleRate = validateApiSampleRate(options.maxInternalSampleRate ?? sampleRate);

    // Header
    const header = options.tencent ? SILK_V3_HEADER_TENCENT : SILK_V3_HEADER;
    const headerBytes = new TextEncoder().encode(header);

    const encoder = new SilkEncoder();
    // Initialize encoder options once to mirror C Encoder.c steady-state loop.
    encoder.encode(new Int16Array(0), {
        API_sampleRate: sampleRate,
        maxInternalSampleRate,
        packetSize: packetSizeMs,
        bitRate: options.bitRate,
        packetLossPercentage: options.packetLossPercentage ?? 0,
        useInBandFEC: options.useInBandFEC ?? false,
        complexity: options.complexity ?? 2,
        useDTX: options.useDTX ?? false,
    });

    const internalSampleRate = (encoder.state.fs_kHz | 0) * 1000;
    const pcmInternal = internalSampleRate === sampleRate
        ? pcmData
        : resample(pcmData, sampleRate, internalSampleRate);
    const frameSamples = (internalSampleRate * frameMs) / 1000;
    // Match C test encoder behavior: ignore trailing samples shorter than one frame.
    const nFrames = Math.floor(pcmInternal.length / frameSamples);

    const chunks: Uint8Array[] = [headerBytes];
    let samplesSinceLastPacket = 0;

    for (let f = 0; f < nFrames; f++) {
        const start = f * frameSamples;
        const frame = new Int16Array(frameSamples);
        frame.set(pcmInternal.subarray(start, start + frameSamples));

        const outPtr = new Uint8Array(D.MAX_ARITHM_BYTES);
        const nBytesOut = { val: outPtr.length };
        encodeFrame(encoder.state, outPtr, nBytesOut, frame);
        if (encoder.state.sCmn.useDTX && encoder.state.inDTX) {
            nBytesOut.val = 0;
        }

        // Match C test encoder: write one packet record only at packet boundary.
        samplesSinceLastPacket += frameSamples;
        if ((1000 * samplesSinceLastPacket) / internalSampleRate !== packetSizeMs) {
            continue;
        }

        // Write payload size (little-endian int16), including zero-size DTX packet.
        const payloadLen = nBytesOut.val | 0;
        const sizeBytes = new Uint8Array(2);
        sizeBytes[0] = payloadLen & 0xFF;
        sizeBytes[1] = (payloadLen >> 8) & 0xFF;
        chunks.push(sizeBytes);
        if (payloadLen > 0) {
            chunks.push(outPtr.subarray(0, payloadLen));
        }
        samplesSinceLastPacket = 0;
    }

    // End marker
    chunks.push(new Uint8Array([0xFF, 0xFF])); // -1 in int16 LE

    // Concatenate
    const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
    const result = new Uint8Array(totalLen);
    let pos = 0;
    for (const chunk of chunks) {
        result.set(chunk, pos);
        pos += chunk.length;
    }
    return result;
}
