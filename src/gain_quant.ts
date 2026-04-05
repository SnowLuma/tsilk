/**
 * Gain dequantization
 * Ported from SKP_Silk_gain_quant.c
 */
import {
    NB_SUBFR,
    MIN_QGAIN_DB,
    MAX_QGAIN_DB,
    N_LEVELS_QGAIN,
    MIN_DELTA_GAIN_QUANT,
    MAX_DELTA_GAIN_QUANT,
} from './defines';
import {
    SKP_SMULWB,
    SKP_min_32,
    SKP_Silk_log2lin,
    SKP_Silk_lin2log,
    toInt32,
    SKP_LIMIT_int,
    SKP_max_int,
} from './macros';

const OFFSET = (((MIN_QGAIN_DB * 128) / 6 | 0) + 16 * 128) | 0;
const SCALE_Q16 = ((65536 * (N_LEVELS_QGAIN - 1)) / ((((MAX_QGAIN_DB - MIN_QGAIN_DB) * 128) / 6) | 0)) | 0;
const INV_SCALE_Q16 = (Math.trunc(65536 * Math.trunc(((MAX_QGAIN_DB - MIN_QGAIN_DB) * 128) / 6)) / (N_LEVELS_QGAIN - 1)) | 0;

export function gainsQuant(
    ind: Int32Array,
    gain_Q16: Int32Array,
    prev_ind: { value: number },
    conditional: number
): void {
    for (let k = 0; k < NB_SUBFR; k++) {
        ind[k] = SKP_SMULWB(SCALE_Q16, SKP_Silk_lin2log(gain_Q16[k]) - OFFSET);

        // Hysteresis toward previous quantized gain.
        if (ind[k] < prev_ind.value) {
            ind[k]++;
        }

        if (k === 0 && conditional === 0) {
            ind[k] = SKP_LIMIT_int(ind[k], 0, N_LEVELS_QGAIN - 1);
            ind[k] = SKP_max_int(ind[k], prev_ind.value + MIN_DELTA_GAIN_QUANT);
            prev_ind.value = ind[k];
        } else {
            ind[k] = SKP_LIMIT_int(ind[k] - prev_ind.value, MIN_DELTA_GAIN_QUANT, MAX_DELTA_GAIN_QUANT);
            prev_ind.value += ind[k];
            ind[k] -= MIN_DELTA_GAIN_QUANT;
        }

        gain_Q16[k] = SKP_Silk_log2lin(
            SKP_min_32(
                toInt32(SKP_SMULWB(INV_SCALE_Q16, prev_ind.value) + OFFSET),
                3967
            )
        );
    }
}

export function gainsDequant(
    gain_Q16: Int32Array,
    ind: Int32Array,
    prev_ind: { value: number },
    conditional: number
): void {
    for (let k = 0; k < NB_SUBFR; k++) {
        if (k === 0 && conditional === 0) {
            prev_ind.value = ind[k];
        } else {
            prev_ind.value = prev_ind.value + ind[k] + MIN_DELTA_GAIN_QUANT;
        }
        gain_Q16[k] = SKP_Silk_log2lin(
            SKP_min_32(
                toInt32(SKP_SMULWB(INV_SCALE_Q16, prev_ind.value) + OFFSET),
                3967
            )
        );
    }
}
