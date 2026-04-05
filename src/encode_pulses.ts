import { RangeCoderState, rangeEncode } from './range_coder';
import {
    MAX_FRAME_LENGTH,
    SHELL_CODEC_FRAME_LENGTH,
    MAX_NB_SHELL_BLOCKS,
    MAX_PULSES,
    N_RATE_LEVELS,
} from './defines';
import * as T from './tables';
import { SKP_RSHIFT } from './macros';

function combineAndCheck(
    pulsesComb: Int32Array,
    pulsesIn: Int32Array,
    maxPulses: number,
    len: number,
    inOffset: number,
    outOffset: number
): number {
    for (let k = 0; k < len; k++) {
        const sum = pulsesIn[inOffset + 2 * k] + pulsesIn[inOffset + 2 * k + 1];
        if (sum > maxPulses) {
            return 1;
        }
        pulsesComb[outOffset + k] = sum;
    }
    return 0;
}

function encodeSplit(
    sRC: RangeCoderState,
    pChild1: number,
    p: number,
    shellTable: Uint16Array
): void {
    if (p > 0) {
        const cdf = shellTable.subarray(T.SKP_Silk_shell_code_table_offsets[p]);
        rangeEncode(sRC, pChild1, cdf);
    }
}

function shellEncode(sRC: RangeCoderState, pulses0: Int32Array, offset: number): void {
    const pulses1 = new Int32Array(8);
    const pulses2 = new Int32Array(4);
    const pulses3 = new Int32Array(2);
    const pulses4 = new Int32Array(1);

    combineAndCheck(pulses1, pulses0, Number.MAX_SAFE_INTEGER, 8, offset, 0);
    combineAndCheck(pulses2, pulses1, Number.MAX_SAFE_INTEGER, 4, 0, 0);
    combineAndCheck(pulses3, pulses2, Number.MAX_SAFE_INTEGER, 2, 0, 0);
    combineAndCheck(pulses4, pulses3, Number.MAX_SAFE_INTEGER, 1, 0, 0);

    encodeSplit(sRC, pulses3[0], pulses4[0], T.SKP_Silk_shell_code_table3);

    encodeSplit(sRC, pulses2[0], pulses3[0], T.SKP_Silk_shell_code_table2);

    encodeSplit(sRC, pulses1[0], pulses2[0], T.SKP_Silk_shell_code_table1);
    encodeSplit(sRC, pulses0[offset + 0], pulses1[0], T.SKP_Silk_shell_code_table0);
    encodeSplit(sRC, pulses0[offset + 2], pulses1[1], T.SKP_Silk_shell_code_table0);

    encodeSplit(sRC, pulses1[2], pulses2[1], T.SKP_Silk_shell_code_table1);
    encodeSplit(sRC, pulses0[offset + 4], pulses1[2], T.SKP_Silk_shell_code_table0);
    encodeSplit(sRC, pulses0[offset + 6], pulses1[3], T.SKP_Silk_shell_code_table0);

    encodeSplit(sRC, pulses2[2], pulses3[1], T.SKP_Silk_shell_code_table2);

    encodeSplit(sRC, pulses1[4], pulses2[2], T.SKP_Silk_shell_code_table1);
    encodeSplit(sRC, pulses0[offset + 8], pulses1[4], T.SKP_Silk_shell_code_table0);
    encodeSplit(sRC, pulses0[offset + 10], pulses1[5], T.SKP_Silk_shell_code_table0);

    encodeSplit(sRC, pulses1[6], pulses2[3], T.SKP_Silk_shell_code_table1);
    encodeSplit(sRC, pulses0[offset + 12], pulses1[6], T.SKP_Silk_shell_code_table0);
    encodeSplit(sRC, pulses0[offset + 14], pulses1[7], T.SKP_Silk_shell_code_table0);
}

function encodeSigns(
    sRC: RangeCoderState,
    q: Int8Array,
    length: number,
    sigtype: number,
    quantOffsetType: number,
    rateLevelIndex: number
): void {
    const idx = (N_RATE_LEVELS - 1) * ((sigtype << 1) + quantOffsetType) + rateLevelIndex;
    const cdf = new Uint16Array([0, T.SKP_Silk_sign_CDF[idx], 65535]);

    for (let i = 0; i < length; i++) {
        if (q[i] !== 0) {
            const inData = (SKP_RSHIFT(q[i], 15) + 1) | 0;
            rangeEncode(sRC, inData, cdf);
        }
    }
}

export function encodePulses(
    psRC: RangeCoderState,
    sigtype: number,
    quantOffsetType: number,
    q: Int8Array,
    frameLength: number,
    frameNo?: number
): void {
    const iter = (frameLength / SHELL_CODEC_FRAME_LENGTH) | 0;
    const absPulses = new Int32Array(MAX_FRAME_LENGTH);
    const sumPulses = new Int32Array(MAX_NB_SHELL_BLOCKS);
    const nRshifts = new Int32Array(MAX_NB_SHELL_BLOCKS);
    const pulsesComb = new Int32Array(8);

    for (let i = 0; i < frameLength; i++) {
        absPulses[i] = Math.abs(q[i]);
    }

    let absOffset = 0;
    for (let i = 0; i < iter; i++) {
        nRshifts[i] = 0;
        while (true) {
            let scaleDown = 0;
            scaleDown += combineAndCheck(pulsesComb, absPulses, T.SKP_Silk_max_pulses_table[0], 8, absOffset, 0);
            scaleDown += combineAndCheck(pulsesComb, pulsesComb, T.SKP_Silk_max_pulses_table[1], 4, 0, 0);
            scaleDown += combineAndCheck(pulsesComb, pulsesComb, T.SKP_Silk_max_pulses_table[2], 2, 0, 0);

            sumPulses[i] = pulsesComb[0] + pulsesComb[1];
            if (sumPulses[i] > T.SKP_Silk_max_pulses_table[3]) {
                scaleDown++;
            }

            if (scaleDown > 0) {
                nRshifts[i]++;
                for (let k = 0; k < SHELL_CODEC_FRAME_LENGTH; k++) {
                    absPulses[absOffset + k] = SKP_RSHIFT(absPulses[absOffset + k], 1);
                }
            } else {
                break;
            }
        }
        absOffset += SHELL_CODEC_FRAME_LENGTH;
    }

    let rateLevelIndex = 0;
    let minSumBitsQ6 = 0x7fffffff;
    for (let k = 0; k < N_RATE_LEVELS - 1; k++) {
        const nBitsPtr = T.SKP_Silk_pulses_per_block_BITS_Q6[k];
        let sumBitsQ6 = T.SKP_Silk_rate_levels_BITS_Q6[sigtype][k];
        for (let i = 0; i < iter; i++) {
            if (nRshifts[i] > 0) {
                sumBitsQ6 += nBitsPtr[MAX_PULSES + 1];
            } else {
                sumBitsQ6 += nBitsPtr[sumPulses[i]];
            }
        }
        if (sumBitsQ6 < minSumBitsQ6) {
            minSumBitsQ6 = sumBitsQ6;
            rateLevelIndex = k;
        }
    }

    rangeEncode(psRC, rateLevelIndex, T.SKP_Silk_rate_levels_CDF[sigtype]);

    const cdfPtr = T.SKP_Silk_pulses_per_block_CDF[rateLevelIndex];
    for (let i = 0; i < iter; i++) {
        if (nRshifts[i] === 0) {
            rangeEncode(psRC, sumPulses[i], cdfPtr);
        } else {
            rangeEncode(psRC, MAX_PULSES + 1, cdfPtr);
            for (let k = 0; k < nRshifts[i] - 1; k++) {
                rangeEncode(psRC, MAX_PULSES + 1, T.SKP_Silk_pulses_per_block_CDF[N_RATE_LEVELS - 1]);
            }
            rangeEncode(psRC, sumPulses[i], T.SKP_Silk_pulses_per_block_CDF[N_RATE_LEVELS - 1]);
        }
    }

    for (let i = 0; i < iter; i++) {
        if (sumPulses[i] > 0) {
            shellEncode(psRC, absPulses, i * SHELL_CODEC_FRAME_LENGTH);
        }
    }

    for (let i = 0; i < iter; i++) {
        if (nRshifts[i] > 0) {
            const pulsesOffset = i * SHELL_CODEC_FRAME_LENGTH;
            const nLS = nRshifts[i] - 1;
            for (let k = 0; k < SHELL_CODEC_FRAME_LENGTH; k++) {
                // C does: abs_q = (SKP_int8)SKP_abs(pulses_ptr[k]);
                // Preserve that int8 wrap semantics for |q| == 128.
                let absQ = (Math.abs(q[pulsesOffset + k]) << 24) >> 24;
                for (let j = nLS; j > 0; j--) {
                    const bit = (absQ >> j) & 1;
                    rangeEncode(psRC, bit, T.SKP_Silk_lsb_CDF);
                }
                rangeEncode(psRC, absQ & 1, T.SKP_Silk_lsb_CDF);
            }
        }
    }

    encodeSigns(psRC, q, frameLength, sigtype, quantOffsetType, rateLevelIndex);
}
