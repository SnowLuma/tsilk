/**
 * SILK v3 Decode Core - Inverse NSQ (LTP + LPC synthesis)
 * Ported from SKP_Silk_decode_core.c
 */
import { DecoderState, DecoderControl } from './structs';
import * as D from './defines';
import {
    SKP_SMULWB, toInt32,
    SKP_RAND, SKP_SAT16, SKP_RSHIFT_ROUND, SKP_SMULWW, 
    SKP_max, SKP_DIV32_varQ, SKP_min, SKP_Silk_MA_Prediction, SKP_INVERSE32_varQ
} from './macros';

export function decodeCore(
    psDec: DecoderState,
    psDecCtrl: DecoderControl,
    xq: Int16Array,
    q: Int32Array
): void {
    const offset_Q10 = [
        [D.OFFSET_VL_Q10, D.OFFSET_VH_Q10],
        [D.OFFSET_UVL_Q10, D.OFFSET_UVH_Q10]
    ][psDecCtrl.sigtype][psDecCtrl.QuantOffsetType];

    const NLSF_interp_flag = psDecCtrl.NLSFInterpCoef_Q2 < 4 ? 1 : 0;
    const LTP_ORDER_HALF = D.LTP_ORDER >> 1;

    const sLTP = new Int16Array(psDec.frame_length);
    if (psDec.prev_inv_gain_Q16 !== 0) {
        sLTP.set(psDec.outBuf.subarray(0, psDec.frame_length));
    }

    // Decode excitation
    let rand_seed = psDecCtrl.Seed;
    for (let i = 0; i < psDec.frame_length; i++) {
        rand_seed = SKP_RAND(rand_seed);
        const dither = rand_seed >> 31; // 0 or -1
        psDec.exc_Q10[i] = (q[i] << 10) + offset_Q10;
        psDec.exc_Q10[i] = (psDec.exc_Q10[i] ^ dither) - dither;
        rand_seed = toInt32(rand_seed + q[i]);
    }

    let pexc_off = 0;
    let pres_off = 0;
    let pxq_off = psDec.frame_length; // write into outBuf[frame_length..]
    let sLTP_buf_idx = psDec.frame_length;

    for (let k = 0; k < D.NB_SUBFR; k++) {
        const A_Q12 = psDecCtrl.PredCoef_Q12[k >> 1];
        const B_Q14_off = k * D.LTP_ORDER;
        const Gain_Q16 = psDecCtrl.Gains_Q16[k];
        let sigtype = psDecCtrl.sigtype;
        let ltpStateQ16Head: number[] | undefined;
        let ltpInputHead: number[] | undefined;
        let ltpRewhiteHead: number[] | undefined;
        let ltpPredQ14First: number | undefined;
        let vecQ10Head: number[] | undefined;

        let inv_gain_Q16 = SKP_INVERSE32_varQ(SKP_max(Gain_Q16, 1), 32);
        inv_gain_Q16 = SKP_min(inv_gain_Q16, 32767);
        let gain_adj_Q16 = 65536;
        if (inv_gain_Q16 !== psDec.prev_inv_gain_Q16) {
            gain_adj_Q16 = SKP_DIV32_varQ(inv_gain_Q16, psDec.prev_inv_gain_Q16, 16);
        }

        // Handle voiced->unvoiced transition after loss
        let lag = 0;
        if (psDec.lossCnt && psDec.prev_sigtype === D.SIG_TYPE_VOICED &&
            psDecCtrl.sigtype === D.SIG_TYPE_UNVOICED && k < (D.NB_SUBFR >> 1)) {
            sigtype = D.SIG_TYPE_VOICED;
            psDecCtrl.pitchL[k] = psDec.lagPrev;
            // Also reset B_Q14 to match C: B_Q14[LTP_ORDER/2] = 0.25 (1024)
            for (let j = 0; j < D.LTP_ORDER; j++) {
                psDecCtrl.LTPCoef_Q14[B_Q14_off + j] = (j === LTP_ORDER_HALF) ? 1024 : 0;
            }
        }

        if (sigtype === D.SIG_TYPE_VOICED) {
            lag = psDecCtrl.pitchL[k];

            // Re-whitening
            if ((k & (3 - (NLSF_interp_flag << 1))) === 0) {
                const start_idx = psDec.frame_length - lag - psDec.LPC_order - LTP_ORDER_HALF;
                const FiltState = new Int32Array(psDec.LPC_order); // initialized to 0

                SKP_Silk_MA_Prediction(
                    psDec.outBuf, start_idx + k * (psDec.frame_length >> 2),
                    A_Q12, 0,
                    FiltState, 0,
                    sLTP, start_idx,
                    psDec.frame_length - start_idx,
                    psDec.LPC_order
                );

                let inv_gain_Q32 = inv_gain_Q16 << 16;
                if (k === 0) {
                    inv_gain_Q32 = SKP_SMULWB(inv_gain_Q32, psDecCtrl.LTP_scale_Q14) << 2;
                }
                for (let i = 0; i < (lag + LTP_ORDER_HALF); i++) {
                    psDec.sLTP_Q16[sLTP_buf_idx - i - 1] = SKP_SMULWB(inv_gain_Q32, sLTP[psDec.frame_length - i - 1]);
                }
                if (k === 0) {
                    const baseSrc = psDec.frame_length - lag + LTP_ORDER_HALF;
                    ltpInputHead = [
                        sLTP[baseSrc] | 0,
                        sLTP[baseSrc - 1] | 0,
                        sLTP[baseSrc - 2] | 0,
                        sLTP[baseSrc - 3] | 0,
                        sLTP[baseSrc - 4] | 0
                    ];
                    ltpRewhiteHead = [
                        sLTP[baseSrc] | 0,
                        sLTP[baseSrc - 1] | 0,
                        sLTP[baseSrc - 2] | 0,
                        sLTP[baseSrc - 3] | 0,
                        sLTP[baseSrc - 4] | 0
                    ];
                }
            } else {
                if (gain_adj_Q16 !== 65536) {
                    for (let i = 0; i < (lag + LTP_ORDER_HALF); i++) {
                        psDec.sLTP_Q16[sLTP_buf_idx - i - 1] = SKP_SMULWW(gain_adj_Q16, psDec.sLTP_Q16[sLTP_buf_idx - i - 1]);
                    }
                }
            }
        }

        // Scale short-term state
        for (let i = 0; i < D.MAX_LPC_ORDER; i++) {
            psDec.sLPC_Q14[i] = SKP_SMULWW(gain_adj_Q16, psDec.sLPC_Q14[i]);
        }
        psDec.prev_inv_gain_Q16 = inv_gain_Q16;

        // Long-term prediction
        if (sigtype === D.SIG_TYPE_VOICED) {
            for (let i = 0; i < psDec.subfr_length; i++) {
                let LTP_pred_Q14 = 0;
                if (i === 0) {
                    const base = sLTP_buf_idx - lag + LTP_ORDER_HALF;
                    ltpStateQ16Head = [
                        psDec.sLTP_Q16[base] | 0,
                        psDec.sLTP_Q16[base - 1] | 0,
                        psDec.sLTP_Q16[base - 2] | 0,
                        psDec.sLTP_Q16[base - 3] | 0,
                        psDec.sLTP_Q16[base - 4] | 0
                    ];
                }
                for (let j = 0; j < D.LTP_ORDER; j++) {
                    const sltpIdx = sLTP_buf_idx - lag + LTP_ORDER_HALF - j;
                    if (sltpIdx >= 0 && sltpIdx < psDec.sLTP_Q16.length) {
                        LTP_pred_Q14 = toInt32(LTP_pred_Q14 +
                            SKP_SMULWB(psDec.sLTP_Q16[sltpIdx], psDecCtrl.LTPCoef_Q14[B_Q14_off + j]));
                    }
                }
                if (i === 0) {
                    ltpPredQ14First = LTP_pred_Q14;
                }
                psDec.res_Q10[pres_off + i] = toInt32(
                    psDec.exc_Q10[pexc_off + i] + SKP_RSHIFT_ROUND(LTP_pred_Q14, 4)
                );
                psDec.sLTP_Q16[sLTP_buf_idx] = psDec.res_Q10[pres_off + i] << 6;
                sLTP_buf_idx++;
            }
        } else {
            for (let i = 0; i < psDec.subfr_length; i++) {
                psDec.res_Q10[pres_off + i] = psDec.exc_Q10[pexc_off + i];
            }
        }

        // Short-term prediction (LPC synthesis)
        for (let i = 0; i < psDec.subfr_length; i++) {
            let LPC_pred_Q10 = 0;
            for (let j = 0; j < psDec.LPC_order; j++) {
                LPC_pred_Q10 = toInt32(LPC_pred_Q10 +
                    SKP_SMULWB(psDec.sLPC_Q14[D.MAX_LPC_ORDER + i - 1 - j], A_Q12[j]));
            }
            const vec_Q10 = toInt32(psDec.res_Q10[pres_off + i] + LPC_pred_Q10);
            psDec.sLPC_Q14[D.MAX_LPC_ORDER + i] = vec_Q10 << 4;
            if (i < 4) {
                if (!vecQ10Head) vecQ10Head = [];
                vecQ10Head.push(vec_Q10);
            }

            // Scale with gain
            const sample = SKP_SAT16(SKP_RSHIFT_ROUND(SKP_SMULWW(vec_Q10, Gain_Q16), 10));
            psDec.outBuf[pxq_off + i] = sample;
        }

        psDec.sLPC_Q14.copyWithin(0, psDec.subfr_length, psDec.subfr_length + D.MAX_LPC_ORDER);
        pexc_off += psDec.subfr_length;
        pres_off += psDec.subfr_length;
        pxq_off += psDec.subfr_length;
    }

    // Copy to output
    xq.set(psDec.outBuf.subarray(psDec.frame_length, psDec.frame_length * 2));
}
