/**
 * SILK v3 SDK Decoder API
 * Ported from SKP_Silk_dec_API.c
 */
import { DecoderState } from './structs';
import { initDecoder, decoderSetFs } from './decoder_init';
import { decodeFrame } from './decode_frame';
import { resample, resampleUp2HqStateful } from './resampler';
import * as D from './defines';

export interface DecControlStruct {
    API_sampleRate: number;
    frameSize: number;
    framesPerPacket: number;
    moreInternalDecoderFrames: number;
    inBandFECOffset: number;
}

export interface DecodeResult {
    samples: Int16Array;
    samplesOut: number;
}

export class SilkDecoder {
    private state: DecoderState;
    private decodeCallNo: number = 0;

    constructor() {
        this.state = new DecoderState();
        initDecoder(this.state);
    }

    /** Get decoder size info */
    getSize(): number {
        return 1; // Single decoder struct
    }

    /** Initialize/reset the decoder */
    init(): void {
        this.state = new DecoderState();
        initDecoder(this.state);
    }

    /** Decode a single SILK packet */
    decode(
        payload: Uint8Array | null,
        nBytesIn: number,
        decControl: DecControlStruct
    ): DecodeResult {
        const psDec = this.state;
        let used_bytes = 0;
        let nSamplesOutDec = 0;

        // Determine the action (0 = decode, 1 = PLC)
        const action = (payload === null || nBytesIn === 0) ? 1 : 0;
        this.decodeCallNo = (this.decodeCallNo + 1) | 0;

        // First frame in payload
        if (psDec.moreInternalDecoderFrames === 0) {
            psDec.nFramesDecoded = 0;
        }

        if (action === 0 && payload) {
            const prevFsKhz = psDec.fs_kHz | 0;
            if (psDec.moreInternalDecoderFrames === 0 && nBytesIn > D.MAX_ARITHM_BYTES) {
                // Match C API behavior on oversized payload.
                const plc = decodeFrame(psDec, payload, nBytesIn, 1);
                const internalRate = psDec.fs_kHz * 1000;
                const apiRate = decControl.API_sampleRate;
                let outSamples = plc.output;
                let outLen = plc.nSamplesOut;
                if (internalRate !== apiRate && outLen > 0) {
                    if (apiRate === internalRate * 2) {
                        if (psDec.prev_API_sampleRate !== apiRate) {
                            psDec.resamplerStateIIR.fill(0);
                        }
                        outSamples = resampleUp2HqStateful(plc.output.subarray(0, outLen), psDec.resamplerStateIIR);
                    } else {
                        outSamples = resample(plc.output.subarray(0, outLen), internalRate, apiRate);
                    }
                    outLen = outSamples.length;
                }
                psDec.prev_API_sampleRate = apiRate;
                decControl.frameSize = outLen;
                decControl.framesPerPacket = psDec.nFramesInPacket;
                decControl.moreInternalDecoderFrames = 0;
                return { samples: outSamples, samplesOut: outLen };
            }

            const { output, nSamplesOut, decBytes, ret } = decodeFrame(
                psDec, payload, nBytesIn, 0
            );
            nSamplesOutDec = nSamplesOut;
            used_bytes = decBytes;

            if (ret !== 0) {
                // decodeFrame() already falls back to PLC on decode error.
                nSamplesOutDec = nSamplesOut;
            }

            // Update packet framing info, aligned with SKP_Silk_SDK_Decode().
            if (used_bytes > 0) {
                if (psDec.nBytesLeft > 0 &&
                    psDec.FrameTermination === D.SKP_SILK_MORE_FRAMES &&
                    psDec.nFramesDecoded < 5) {
                    psDec.moreInternalDecoderFrames = 1;
                } else {
                    psDec.moreInternalDecoderFrames = 0;
                    psDec.nFramesInPacket = psDec.nFramesDecoded;

                    if (psDec.vadFlag === D.VOICE_ACTIVITY) {
                        if (psDec.FrameTermination === D.SKP_SILK_LAST_FRAME) {
                            psDec.no_FEC_counter++;
                            if (psDec.no_FEC_counter > D.NO_LBRR_THRES) {
                                psDec.inband_FEC_offset = 0;
                            }
                        } else if (psDec.FrameTermination === D.SKP_SILK_LBRR_VER1) {
                            psDec.inband_FEC_offset = 1;
                            psDec.no_FEC_counter = 0;
                        } else if (psDec.FrameTermination === D.SKP_SILK_LBRR_VER2) {
                            psDec.inband_FEC_offset = 2;
                            psDec.no_FEC_counter = 0;
                        }
                    }
                }
            }

            // Resample if needed
            const internalRate = psDec.fs_kHz * 1000;
            const apiRate = decControl.API_sampleRate;

            if (internalRate !== apiRate && nSamplesOutDec > 0) {
                const decoded = output.subarray(0, nSamplesOutDec);
                let resampled: Int16Array;
                if (apiRate === internalRate * 2) {
                    if (prevFsKhz !== (psDec.fs_kHz | 0) || psDec.prev_API_sampleRate !== apiRate) {
                        psDec.resamplerStateIIR.fill(0);
                    }
                    resampled = resampleUp2HqStateful(decoded, psDec.resamplerStateIIR);
                } else {
                    resampled = resample(decoded, internalRate, apiRate);
                }
                decControl.frameSize = resampled.length;
                decControl.framesPerPacket = psDec.nFramesInPacket;
                decControl.moreInternalDecoderFrames = psDec.moreInternalDecoderFrames;
                psDec.prev_API_sampleRate = apiRate;
                if (psDec.moreInternalDecoderFrames === 0) {
                    psDec.nFramesDecoded = 0;
                }
                return { samples: resampled, samplesOut: resampled.length };
            }

            decControl.frameSize = nSamplesOutDec;
            decControl.framesPerPacket = psDec.nFramesInPacket;
            decControl.moreInternalDecoderFrames = psDec.moreInternalDecoderFrames;
            psDec.prev_API_sampleRate = apiRate;
            
            if (psDec.moreInternalDecoderFrames === 0) {
                psDec.nFramesDecoded = 0;
            }
            return { samples: output.subarray(0, nSamplesOutDec), samplesOut: nSamplesOutDec };
        } else {
            // PLC mode
            if (psDec.fs_kHz === 0) {
                decoderSetFs(psDec, 24);
            }
            const plc = decodeFrame(psDec, new Uint8Array(0), 0, 1);
            const internalRate = psDec.fs_kHz * 1000;
            const apiRate = decControl.API_sampleRate;
            let outSamples = plc.output;
            let outLen = plc.nSamplesOut;
            if (internalRate !== apiRate && outLen > 0) {
                if (apiRate === internalRate * 2) {
                    if (psDec.prev_API_sampleRate !== apiRate) {
                        psDec.resamplerStateIIR.fill(0);
                    }
                    outSamples = resampleUp2HqStateful(plc.output.subarray(0, outLen), psDec.resamplerStateIIR);
                } else {
                    outSamples = resample(plc.output.subarray(0, outLen), internalRate, apiRate);
                }
                outLen = outSamples.length;
            }
            psDec.prev_API_sampleRate = apiRate;
            decControl.frameSize = outLen;
            return { samples: outSamples, samplesOut: outLen };
        }
    }
}
