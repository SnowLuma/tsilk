/**
 * Decode excitation pulses
 * Ported from SKP_Silk_decode_pulses.c + SKP_Silk_shell_coder.c + SKP_Silk_code_signs.c
 */
import { RangeCoderState } from './range_coder';
import { rangeDecode } from './range_coder_dec';
import { DecoderControl } from './structs';
import { SHELL_CODEC_FRAME_LENGTH, N_RATE_LEVELS, MAX_PULSES } from './defines';
import * as T from './tables';

export function decodePulses(
    psRC: RangeCoderState,
    psDecCtrl: DecoderControl,
    q: Int32Array,
    frame_length: number
): void {
    // Decode rate level
    psDecCtrl.RateLevelIndex = rangeDecode(psRC,
        T.SKP_Silk_rate_levels_CDF[psDecCtrl.sigtype],
        T.SKP_Silk_rate_levels_CDF_offset
    );

    const iter = Math.floor(frame_length / SHELL_CODEC_FRAME_LENGTH);
    const sum_pulses = new Int32Array(iter);
    const nLshifts = new Int32Array(iter);

    // Sum-weighted-pulses decoding
    const cdf_ptr = T.SKP_Silk_pulses_per_block_CDF[psDecCtrl.RateLevelIndex];
    for (let i = 0; i < iter; i++) {
        nLshifts[i] = 0;
        sum_pulses[i] = rangeDecode(psRC, cdf_ptr, T.SKP_Silk_pulses_per_block_CDF_offset);
        while (sum_pulses[i] === MAX_PULSES + 1) {
            nLshifts[i]++;
            sum_pulses[i] = rangeDecode(psRC,
                T.SKP_Silk_pulses_per_block_CDF[N_RATE_LEVELS - 1],
                T.SKP_Silk_pulses_per_block_CDF_offset
            );
        }
    }

    // Shell decoding
    for (let i = 0; i < iter; i++) {
        const offset = i * SHELL_CODEC_FRAME_LENGTH;
        if (sum_pulses[i] > 0) {
            shellDecoder(q, offset, psRC, sum_pulses[i]);
        } else {
            for (let j = 0; j < SHELL_CODEC_FRAME_LENGTH; j++) q[offset + j] = 0;
        }
    }

    // LSB decoding
    for (let i = 0; i < iter; i++) {
        if (nLshifts[i] > 0) {
            const offset = i * SHELL_CODEC_FRAME_LENGTH;
            for (let k = 0; k < SHELL_CODEC_FRAME_LENGTH; k++) {
                let abs_q = q[offset + k];
                for (let j = 0; j < nLshifts[i]; j++) {
                    abs_q = abs_q << 1;
                    const bit = rangeDecode(psRC, T.SKP_Silk_lsb_CDF, 1);
                    abs_q += bit;
                }
                q[offset + k] = abs_q;
            }
        }
    }

    // Decode and add signs
    decodeSigns(psRC, q, frame_length, psDecCtrl.sigtype,
        psDecCtrl.QuantOffsetType, psDecCtrl.RateLevelIndex);
}

function shellDecoder(
    pulses0: Int32Array, offset: number,
    sRC: RangeCoderState, pulses4: number
): void {
    const p3 = [0, 0], p2 = [0, 0, 0, 0], p1 = [0, 0, 0, 0, 0, 0, 0, 0];
    decodeSplit(p3, 0, sRC, pulses4, T.SKP_Silk_shell_code_table3);
    decodeSplit(p2, 0, sRC, p3[0], T.SKP_Silk_shell_code_table2);
    decodeSplit(p1, 0, sRC, p2[0], T.SKP_Silk_shell_code_table1);
    decodeSplitTo(pulses0, offset + 0, sRC, p1[0], T.SKP_Silk_shell_code_table0);
    decodeSplitTo(pulses0, offset + 2, sRC, p1[1], T.SKP_Silk_shell_code_table0);
    decodeSplit(p1, 2, sRC, p2[1], T.SKP_Silk_shell_code_table1);
    decodeSplitTo(pulses0, offset + 4, sRC, p1[2], T.SKP_Silk_shell_code_table0);
    decodeSplitTo(pulses0, offset + 6, sRC, p1[3], T.SKP_Silk_shell_code_table0);
    decodeSplit(p2, 2, sRC, p3[1], T.SKP_Silk_shell_code_table2);
    decodeSplit(p1, 4, sRC, p2[2], T.SKP_Silk_shell_code_table1);
    decodeSplitTo(pulses0, offset + 8, sRC, p1[4], T.SKP_Silk_shell_code_table0);
    decodeSplitTo(pulses0, offset + 10, sRC, p1[5], T.SKP_Silk_shell_code_table0);
    decodeSplit(p1, 6, sRC, p2[3], T.SKP_Silk_shell_code_table1);
    decodeSplitTo(pulses0, offset + 12, sRC, p1[6], T.SKP_Silk_shell_code_table0);
    decodeSplitTo(pulses0, offset + 14, sRC, p1[7], T.SKP_Silk_shell_code_table0);
}

function decodeSplit(
    out: number[], outIdx: number,
    sRC: RangeCoderState, p: number, table: Uint16Array
): void {
    if (p > 0) {
        const cdf_middle = p >> 1;
        const cdf_offset = T.SKP_Silk_shell_code_table_offsets[p];
        const cdf = table.subarray(cdf_offset);
        const child1 = rangeDecode(sRC, cdf, cdf_middle);
        out[outIdx] = child1;
        out[outIdx + 1] = p - child1;
    } else {
        out[outIdx] = 0;
        out[outIdx + 1] = 0;
    }
}

function decodeSplitTo(
    out: Int32Array, outIdx: number,
    sRC: RangeCoderState, p: number, table: Uint16Array
): void {
    if (p > 0) {
        const cdf_middle = p >> 1;
        const cdf_offset = T.SKP_Silk_shell_code_table_offsets[p];
        const cdf = table.subarray(cdf_offset);
        const child1 = rangeDecode(sRC, cdf, cdf_middle);
        out[outIdx] = child1;
        out[outIdx + 1] = p - child1;
    } else {
        out[outIdx] = 0;
        out[outIdx + 1] = 0;
    }
}

function decodeSigns(
    sRC: RangeCoderState, q: Int32Array, length: number,
    sigtype: number, QuantOffsetType: number, RateLevelIndex: number
): void {
    const idx = (N_RATE_LEVELS - 1) * (sigtype * 2 + QuantOffsetType) + RateLevelIndex;
    const cdf = new Uint16Array([0, T.SKP_Silk_sign_CDF[idx], 65535]);

    for (let i = 0; i < length; i++) {
        if (q[i] > 0) {
            const data = rangeDecode(sRC, cdf, 1);
            // data=0 means negative, data=1 means positive
            q[i] *= (data * 2 - 1); // map: 0->-1, 1->+1
        }
    }
}
