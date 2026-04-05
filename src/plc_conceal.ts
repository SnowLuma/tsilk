/**
 * PLC (Packet Loss Concealment) - Part 2: Conceal
 * Ported from SKP_Silk_PLC.c
 */
import { DecoderState, DecoderControl } from './structs';
import * as D from './defines';
import {
    toInt32, toInt16, SKP_RSHIFT, SKP_LSHIFT, SKP_SMULWB, SKP_SMLAWB,
    SKP_SMULBB, SKP_RSHIFT_ROUND, SKP_SAT16, SKP_SMULWW,
    SKP_RAND, SKP_MUL, SKP_DIV32, SKP_Silk_bwexpander,
    SKP_max, SKP_min, SKP_min_32, SKP_max_32, SKP_max_int, SKP_min_int,
    SKP_SMLAWT, SKP_ADD32, SKP_Silk_sum_sqr_shift
} from './macros';
import { LPC_inverse_pred_gain } from './lpc_inv_pred_gain';

const HARM_ATT_Q15 = [32440, 31130];     // 0.99, 0.95
const PLC_RAND_ATTENUATE_V_Q15 = [31130, 26214]; // 0.95, 0.8
const PLC_RAND_ATTENUATE_UV_Q15 = [32440, 29491]; // 0.99, 0.9
const NB_ATT = 2;

function sumSqrShift(sig: Int16Array, offset: number, len: number): { energy: number, shift: number } {
    const nrg = { val: 0 };
    const sh = { val: 0 };
    SKP_Silk_sum_sqr_shift(nrg, sh, sig.subarray(offset, offset + len), len);
    return { energy: nrg.val | 0, shift: sh.val | 0 };
}

export function PLC_conceal(
    psDec: DecoderState, psDecCtrl: DecoderControl,
    signal: Int16Array, length: number
): void {
    const exc_buf = new Int16Array(D.MAX_FRAME_LENGTH);
    const sig_Q10 = new Int32Array(D.MAX_FRAME_LENGTH);
    
    psDec.sLTP_Q16.copyWithin(0, psDec.frame_length, psDec.frame_length * 2);
    SKP_Silk_bwexpander(psDec.PLC_prevLPC_Q12, 0, psDec.LPC_order, D.BWE_COEF_Q16);

    let exc_buf_ptr = 0;
    for (let k = (D.NB_SUBFR >> 1); k < D.NB_SUBFR; k++) {
        for (let i = 0; i < psDec.subfr_length; i++) {
            exc_buf[exc_buf_ptr + i] = toInt16(SKP_RSHIFT(
                SKP_SMULWW(psDec.exc_Q10[i + k * psDec.subfr_length], psDec.PLC_prevGain_Q16[k]), 10
            ));
        }
        exc_buf_ptr += psDec.subfr_length;
    }

    const { energy: e1, shift: s1 } = sumSqrShift(exc_buf, 0, psDec.subfr_length);
    const { energy: e2, shift: s2 } = sumSqrShift(exc_buf, psDec.subfr_length, psDec.subfr_length);

    let rand_ptr_offset = 0;
    if (SKP_RSHIFT(e1, s2) < SKP_RSHIFT(e2, s1)) {
        rand_ptr_offset = SKP_max_int(0, 3 * psDec.subfr_length - D.RAND_BUF_SIZE);
    } else {
        rand_ptr_offset = SKP_max_int(0, psDec.frame_length - D.RAND_BUF_SIZE);
    }

    let B_Q14 = new Int16Array(psDec.PLC_LTPCoef_Q14);
    let rand_scale_Q14 = psDec.PLC_randScale_Q14;

    const idx_att = SKP_min_int(NB_ATT - 1, psDec.lossCnt);
    let harm_Gain_Q15 = HARM_ATT_Q15[idx_att];
    let rand_Gain_Q15 = (psDec.prev_sigtype === D.SIG_TYPE_VOICED) 
        ? PLC_RAND_ATTENUATE_V_Q15[idx_att] : PLC_RAND_ATTENUATE_UV_Q15[idx_att];

    if (psDec.lossCnt === 0) {
        rand_scale_Q14 = 1 << 14;
        if (psDec.prev_sigtype === D.SIG_TYPE_VOICED) {
            for (let i = 0; i < D.LTP_ORDER; i++) rand_scale_Q14 -= B_Q14[i];
            rand_scale_Q14 = Math.max(3277, rand_scale_Q14);
            rand_scale_Q14 = toInt16(SKP_RSHIFT(SKP_SMULBB(rand_scale_Q14, psDec.PLC_prevLTP_scale_Q14), 14));
        } else if (psDec.prev_sigtype === D.SIG_TYPE_UNVOICED) {
            const { invGain_Q30 } = LPC_inverse_pred_gain(psDec.PLC_prevLPC_Q12, psDec.LPC_order);
            let down_scale_Q30 = SKP_min_32(SKP_RSHIFT(1 << 30, D.LOG2_INV_LPC_GAIN_HIGH_THRES), invGain_Q30);
            down_scale_Q30 = SKP_max_32(SKP_RSHIFT(1 << 30, D.LOG2_INV_LPC_GAIN_LOW_THRES), down_scale_Q30);
            down_scale_Q30 = SKP_LSHIFT(down_scale_Q30, D.LOG2_INV_LPC_GAIN_HIGH_THRES);
            rand_Gain_Q15 = SKP_RSHIFT(SKP_SMULWB(down_scale_Q30, rand_Gain_Q15), 14);
        }
    }

    let rand_seed = psDec.PLC_rand_seed;
    let lag = SKP_RSHIFT_ROUND(psDec.PLC_pitchL_Q8, 8);
    let sLTP_buf_idx = psDec.frame_length;

    let sig_Q10_ptr = 0;
    for (let k = 0; k < D.NB_SUBFR; k++) {
        let pred_lag_ptr = sLTP_buf_idx - lag + Math.floor(D.LTP_ORDER / 2);
        for (let i = 0; i < psDec.subfr_length; i++) {
            rand_seed = SKP_RAND(rand_seed);
            const idx = SKP_RSHIFT(rand_seed, 25) & D.RAND_BUF_MASK;

            let LTP_pred_Q14 = SKP_SMULWB(psDec.sLTP_Q16[pred_lag_ptr], B_Q14[0]);
            LTP_pred_Q14 = SKP_SMLAWB(LTP_pred_Q14, psDec.sLTP_Q16[pred_lag_ptr - 1], B_Q14[1]);
            LTP_pred_Q14 = SKP_SMLAWB(LTP_pred_Q14, psDec.sLTP_Q16[pred_lag_ptr - 2], B_Q14[2]);
            LTP_pred_Q14 = SKP_SMLAWB(LTP_pred_Q14, psDec.sLTP_Q16[pred_lag_ptr - 3], B_Q14[3]);
            LTP_pred_Q14 = SKP_SMLAWB(LTP_pred_Q14, psDec.sLTP_Q16[pred_lag_ptr - 4], B_Q14[4]);
            pred_lag_ptr++;

            let LPC_exc_Q10 = SKP_LSHIFT(SKP_SMULWB(psDec.exc_Q10[rand_ptr_offset + idx], rand_scale_Q14), 2);
            LPC_exc_Q10 = SKP_ADD32(LPC_exc_Q10, SKP_RSHIFT_ROUND(LTP_pred_Q14, 4));

            psDec.sLTP_Q16[sLTP_buf_idx] = SKP_LSHIFT(LPC_exc_Q10, 6);
            sLTP_buf_idx++;
            sig_Q10[sig_Q10_ptr + i] = LPC_exc_Q10;
        }
        sig_Q10_ptr += psDec.subfr_length;
        
        for (let j = 0; j < D.LTP_ORDER; j++) B_Q14[j] = SKP_RSHIFT(SKP_SMULBB(harm_Gain_Q15, B_Q14[j]), 15);
        rand_scale_Q14 = SKP_RSHIFT(SKP_SMULBB(rand_scale_Q14, rand_Gain_Q15), 15);

        psDec.PLC_pitchL_Q8 += SKP_SMULWB(psDec.PLC_pitchL_Q8, D.PITCH_DRIFT_FAC_Q16);
        psDec.PLC_pitchL_Q8 = SKP_min_32(psDec.PLC_pitchL_Q8, SKP_LSHIFT(SKP_SMULBB(D.MAX_PITCH_LAG_MS, psDec.fs_kHz), 8));
        lag = SKP_RSHIFT_ROUND(psDec.PLC_pitchL_Q8, 8);
    }

    sig_Q10_ptr = 0;
    const A_Q12 = psDec.PLC_prevLPC_Q12;
    for (let k = 0; k < D.NB_SUBFR; k++) {
        for (let i = 0; i < psDec.subfr_length; i++) {
            let LPC_pred_Q10 = 0;
            for (let j = 0; j < psDec.LPC_order; j++) {
                LPC_pred_Q10 = SKP_SMLAWB(LPC_pred_Q10, psDec.sLPC_Q14[D.MAX_LPC_ORDER + i - j - 1], A_Q12[j]);
            }
            sig_Q10[sig_Q10_ptr + i] = SKP_ADD32(sig_Q10[sig_Q10_ptr + i], LPC_pred_Q10);
            psDec.sLPC_Q14[D.MAX_LPC_ORDER + i] = SKP_LSHIFT(sig_Q10[sig_Q10_ptr + i], 4);
        }
        sig_Q10_ptr += psDec.subfr_length;
        psDec.sLPC_Q14.copyWithin(0, psDec.subfr_length, psDec.subfr_length + D.MAX_LPC_ORDER);
    }

    for (let i = 0; i < psDec.frame_length; i++) {
        signal[i] = toInt16(SKP_SAT16(SKP_RSHIFT_ROUND(SKP_SMULWW(sig_Q10[i], psDec.PLC_prevGain_Q16[D.NB_SUBFR - 1]), 10)));
    }
    
    psDec.PLC_rand_seed = rand_seed;
    psDec.PLC_randScale_Q14 = rand_scale_Q14;
    for (let i = 0; i < D.NB_SUBFR; i++) psDecCtrl.pitchL[i] = lag;
}
