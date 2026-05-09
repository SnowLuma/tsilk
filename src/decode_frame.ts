/**
 * SILK v3 Decode Frame
 * Ported from SKP_Silk_decode_frame.c
 */
import { DecoderState, DecoderControl, createDecoderControl } from './structs';
import { decoderSetFs } from './decoder_init';
import { rangeDecInit } from './range_coder';
import { decodeParameters } from './decode_parameters';
import { decodeCore } from './decode_core';
import { SKP_Silk_biquad } from './macros';
import * as D from './defines';
import { PLC, PLC_glue_frames } from './plc';
import { CNG } from './cng';

export interface DecodeFrameResult {
    output: Int16Array;
    nSamplesOut: number;
    decBytes: number;
    ret: number;
}

export function decodeFrame(
    psDec: DecoderState,
    pCode: Uint8Array,
    nBytes: number,
    action: number // 0 = normal, 1 = PLC
): DecodeFrameResult {
    const sDecCtrl = createDecoderControl();
    let ret = 0;
    let L = psDec.frame_length;
    sDecCtrl.LTP_scale_Q14 = 0;
    let decBytes = 0;

    const pOut = new Int16Array(D.MAX_FRAME_LENGTH);

    if (action === 0) {
        // Normal decode
        const fs_Khz_old = psDec.fs_kHz;

        if (psDec.nFramesDecoded === 0) {
            rangeDecInit(psDec.sRC, pCode, nBytes);
        }

        const Pulses = new Int32Array(D.MAX_FRAME_LENGTH);
        decodeParameters(psDec, sDecCtrl, Pulses, 1);

        if (psDec.sRC.error) {
            psDec.nBytesLeft = 0;
            action = 1; // fallback to PLC
            decoderSetFs(psDec, fs_Khz_old);
            decBytes = psDec.sRC.bufferLength;

            if (psDec.sRC.error === D.RANGE_CODER_DEC_PAYLOAD_TOO_LONG) {
                ret = D.SKP_SILK_DEC_PAYLOAD_TOO_LARGE;
            } else {
                ret = D.SKP_SILK_DEC_PAYLOAD_ERROR;
            }
        } else {
            decBytes = psDec.sRC.bufferLength - psDec.nBytesLeft;
            psDec.nFramesDecoded++;
            L = psDec.frame_length;

            // Inverse NSQ
            decodeCore(psDec, sDecCtrl, pOut, Pulses);

            psDec.lossCnt = 0;
            psDec.prev_sigtype = sDecCtrl.sigtype;
            psDec.first_frame_after_reset = 0;
        }
    }

    if (action === 0 && !psDec.sRC.error) {
        // Update PLC state for good frame
        PLC(psDec, sDecCtrl, pOut, L, false);
    }

    if (action === 1) {
        // Handle packet loss by extrapolation
        PLC(psDec, sDecCtrl, pOut, L, true);
    }

    // Copy to output buffer
    psDec.outBuf.set(pOut.subarray(0, L));

    // Ensure smooth connection of extrapolated and good frames
    PLC_glue_frames(psDec, sDecCtrl, pOut, L);

    // Comfort noise generation / estimation
    CNG(psDec, sDecCtrl, pOut, L);

    // HP filter output
    if (psDec.HP_A.length > 0 && psDec.HP_B.length > 0) {
        SKP_Silk_biquad(
            pOut, 0,
            psDec.HP_B, 0,
            psDec.HP_A, 0,
            psDec.HPState, 0,
            pOut, 0,
            L
        );
    }

    psDec.lagPrev = sDecCtrl.pitchL[D.NB_SUBFR - 1];

    return { output: pOut.subarray(0, L), nSamplesOut: L, decBytes, ret };
}
