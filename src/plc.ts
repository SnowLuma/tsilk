/**
 * PLC (Packet Loss Concealment) - Part 1: Update & Control
 * Ported from SKP_Silk_PLC.c
 */
import { DecoderState, DecoderControl } from './structs';
import * as D from './defines';
import {
    toInt32, toInt16, SKP_RSHIFT, SKP_LSHIFT, SKP_SMULWB, SKP_SMLAWB,
    SKP_SMULBB, SKP_RSHIFT_ROUND, SKP_SAT16, SKP_SMULWW,
    SKP_RAND, SKP_MUL, SKP_DIV32, SKP_Silk_bwexpander, SKP_Silk_CLZ32,
    SKP_max, SKP_min, SKP_min_32, SKP_max_32, SKP_Silk_sum_sqr_shift, SKP_DIV32_16,
} from './macros';
import { LPC_inverse_pred_gain } from './lpc_inv_pred_gain';
import { PLC_conceal } from './plc_conceal';
import { SKP_Silk_SQRT_APPROX } from './macros';

const HARM_ATT_Q15 = [32440, 31130];     // 0.99, 0.95
const PLC_RAND_ATTENUATE_V_Q15 = [31130, 26214]; // 0.95, 0.8
const PLC_RAND_ATTENUATE_UV_Q15 = [32440, 29491]; // 0.99, 0.9
const NB_ATT = 2;

export function PLC_Reset(psDec: DecoderState): void {
    psDec.PLC_pitchL_Q8 = psDec.frame_length >> 1;
}

export function PLC(
    psDec: DecoderState, psDecCtrl: DecoderControl,
    signal: Int16Array, length: number, lost: boolean
): void {
    if (psDec.fs_kHz !== psDec.PLC_fs_kHz) {
        PLC_Reset(psDec);
        psDec.PLC_fs_kHz = psDec.fs_kHz;
    }
    if (lost) {
        PLC_conceal(psDec, psDecCtrl, signal, length);
        psDec.lossCnt++;
    } else {
        PLC_update(psDec, psDecCtrl, signal, length);
    }
}

function PLC_update(
    psDec: DecoderState, psDecCtrl: DecoderControl,
    signal: Int16Array, length: number
): void {
    psDec.prev_sigtype = psDecCtrl.sigtype;
    let LTP_Gain_Q14 = 0;
    if (psDecCtrl.sigtype === D.SIG_TYPE_VOICED) {
        for (let j = 0; j * psDec.subfr_length < psDecCtrl.pitchL[D.NB_SUBFR - 1]; j++) {
            let temp = 0;
            for (let i = 0; i < D.LTP_ORDER; i++) {
                temp += psDecCtrl.LTPCoef_Q14[(D.NB_SUBFR - 1 - j) * D.LTP_ORDER + i];
            }
            if (temp > LTP_Gain_Q14) {
                LTP_Gain_Q14 = temp;
                const srcOff = (D.NB_SUBFR - 1 - j) * D.LTP_ORDER;
                for (let i = 0; i < D.LTP_ORDER; i++) {
                    psDec.PLC_LTPCoef_Q14[i] = psDecCtrl.LTPCoef_Q14[srcOff + i];
                }
                psDec.PLC_pitchL_Q8 = psDecCtrl.pitchL[D.NB_SUBFR - 1 - j] << 8;
            }
        }
        // Limit LT coefs
        if (LTP_Gain_Q14 < D.V_PITCH_GAIN_START_MIN_Q14) {
            const scale = SKP_DIV32(D.V_PITCH_GAIN_START_MIN_Q14 << 10, SKP_max(LTP_Gain_Q14, 1));
            for (let i = 0; i < D.LTP_ORDER; i++) {
                psDec.PLC_LTPCoef_Q14[i] = toInt16(SKP_RSHIFT(SKP_SMULBB(psDec.PLC_LTPCoef_Q14[i], scale), 10));
            }
        } else if (LTP_Gain_Q14 > D.V_PITCH_GAIN_START_MAX_Q14) {
            const scale = SKP_DIV32(D.V_PITCH_GAIN_START_MAX_Q14 << 14, SKP_max(LTP_Gain_Q14, 1));
            for (let i = 0; i < D.LTP_ORDER; i++) {
                psDec.PLC_LTPCoef_Q14[i] = toInt16(SKP_RSHIFT(SKP_SMULBB(psDec.PLC_LTPCoef_Q14[i], scale), 14));
            }
        }
    } else {
        psDec.PLC_pitchL_Q8 = (psDec.fs_kHz * 18) << 8;
        psDec.PLC_LTPCoef_Q14.fill(0);
    }
    // Save LPC coefficients
    psDec.PLC_prevLPC_Q12.set(psDecCtrl.PredCoef_Q12[1].subarray(0, psDec.LPC_order));
    psDec.PLC_prevLTP_scale_Q14 = psDecCtrl.LTP_scale_Q14;
    // Save Gains
    psDec.PLC_prevGain_Q16.set(psDecCtrl.Gains_Q16);
}

function sumSqrShift(sig: Int16Array, len: number): { energy: number, shift: number } {
    const nrg = { val: 0 };
    const sh = { val: 0 };
    SKP_Silk_sum_sqr_shift(nrg, sh, sig, len);
    return { energy: nrg.val | 0, shift: sh.val | 0 };
}

export function PLC_glue_frames(
    psDec: DecoderState, psDecCtrl: DecoderControl,
    signal: Int16Array, length: number
): void {
    if (psDec.lossCnt) {
        const { energy, shift } = sumSqrShift(signal, length);
        psDec.PLC_conc_energy = energy;
        psDec.PLC_conc_energy_shift = shift;
        psDec.PLC_last_frame_lost = 1;
    } else {
        if (psDec.PLC_last_frame_lost) {
            let { energy, shift: energy_shift } = sumSqrShift(signal, length);
            if (energy_shift > psDec.PLC_conc_energy_shift) {
                psDec.PLC_conc_energy = SKP_RSHIFT(psDec.PLC_conc_energy, energy_shift - psDec.PLC_conc_energy_shift);
            } else if (energy_shift < psDec.PLC_conc_energy_shift) {
                energy = SKP_RSHIFT(energy, psDec.PLC_conc_energy_shift - energy_shift);
            }
            if (energy > psDec.PLC_conc_energy) {
                let LZ = SKP_Silk_CLZ32(psDec.PLC_conc_energy) - 1;
                psDec.PLC_conc_energy = SKP_LSHIFT(psDec.PLC_conc_energy, LZ);
                energy = SKP_RSHIFT(energy, SKP_max_32(24 - LZ, 0));
                
                const frac_Q24 = SKP_DIV32(psDec.PLC_conc_energy, SKP_max(energy, 1));
                let gain_Q12 = SKP_Silk_SQRT_APPROX(frac_Q24);
                const slope_Q12 = SKP_DIV32_16((1 << 12) - gain_Q12, length);

                for (let i = 0; i < length; i++) {
                    signal[i] = toInt16(SKP_RSHIFT(SKP_MUL(gain_Q12, signal[i]), 12));
                    gain_Q12 += slope_Q12;
                    gain_Q12 = SKP_min(gain_Q12, 1 << 12);
                }
            }
        }
        psDec.PLC_last_frame_lost = 0;
    }
}
