import { NLSFCB } from './nlsf';
import { SKP_RSHIFT, SKP_SMULBB, SKP_SMLAWB, SKP_SMLAWT, SKP_ADD_POS_SAT32, SKP_SMULWB, SKP_SMLABB, SKP_max_int, SKP_min_int } from './macros';
import { NLSF_MSVQ_decode } from './nlsf';
import { NLSF2A_stable } from './nlsf2a_stable';

const MIN_NDELTA = 3;
const Q_OUT = 6;

export function SKP_Silk_NLSF_VQ_weights_laroia(
    pNLSFW_Q6: Int32Array,
    pNLSF_Q15: Int32Array,
    D: number
): void {
    let tmp1_int: number, tmp2_int: number;

    tmp1_int = SKP_max_int(pNLSF_Q15[0], MIN_NDELTA);
    tmp1_int = Math.floor((1 << (15 + Q_OUT)) / tmp1_int);
    tmp2_int = SKP_max_int(pNLSF_Q15[1] - pNLSF_Q15[0], MIN_NDELTA);
    tmp2_int = Math.floor((1 << (15 + Q_OUT)) / tmp2_int);
    pNLSFW_Q6[0] = SKP_min_int(tmp1_int + tmp2_int, 32767);

    for (let k = 1; k < D - 1; k += 2) {
        tmp1_int = SKP_max_int(pNLSF_Q15[k + 1] - pNLSF_Q15[k], MIN_NDELTA);
        tmp1_int = Math.floor((1 << (15 + Q_OUT)) / tmp1_int);
        pNLSFW_Q6[k] = SKP_min_int(tmp1_int + tmp2_int, 32767);

        tmp2_int = SKP_max_int(pNLSF_Q15[k + 2] - pNLSF_Q15[k + 1], MIN_NDELTA);
        tmp2_int = Math.floor((1 << (15 + Q_OUT)) / tmp2_int);
        pNLSFW_Q6[k + 1] = SKP_min_int(tmp1_int + tmp2_int, 32767);
    }
    
    tmp1_int = SKP_max_int((1 << 15) - pNLSF_Q15[D - 1], MIN_NDELTA);
    tmp1_int = Math.floor((1 << (15 + Q_OUT)) / tmp1_int);
    pNLSFW_Q6[D - 1] = SKP_min_int(tmp1_int + tmp2_int, 32767);
}

export function SKP_Silk_interpolate(
    xi: Int32Array | Int16Array,
    x0: Int32Array | Int16Array,
    x1: Int32Array | Int16Array,
    ifact_Q2: number,
    d: number
): void {
    for (let i = 0; i < d; i++) {
        xi[i] = x0[i] + SKP_RSHIFT(SKP_SMULBB(x1[i] - x0[i], ifact_Q2), 2);
    }
}

export function SKP_Silk_NLSF_VQ_sum_error_FIX(
    err_Q20: Int32Array,
    in_Q15: Int32Array,
    in_offset: number,
    w_Q6: Int32Array,
    pCB_Q15: Int16Array,
    N: number,
    K: number,
    LPC_order: number
): void {
    const Wcpy_Q6 = new Int32Array(LPC_order >> 1);
    for (let m = 0; m < (LPC_order >> 1); m++) {
        Wcpy_Q6[m] = w_Q6[2 * m] | (w_Q6[2 * m + 1] << 16);
    }

    let err_offset = 0;
    for (let n = 0; n < N; n++) {
        let cb_offset = 0;
        for (let i = 0; i < K; i++) {
            let sum_error = 0;
            for (let m = 0; m < LPC_order; m += 2) {
                const Wtmp_Q6 = Wcpy_Q6[m >> 1];
                let diff_Q15 = in_Q15[in_offset + m] - pCB_Q15[cb_offset++];
                sum_error = SKP_SMLAWB(sum_error, SKP_SMULBB(diff_Q15, diff_Q15), Wtmp_Q6);
                
                diff_Q15 = in_Q15[in_offset + m + 1] - pCB_Q15[cb_offset++];
                sum_error = SKP_SMLAWT(sum_error, SKP_SMULBB(diff_Q15, diff_Q15), Wtmp_Q6);
            }
            err_Q20[err_offset + i] = sum_error;
        }
        err_offset += K;
        in_offset += LPC_order;
    }
}

export function SKP_Silk_NLSF_VQ_rate_distortion_FIX(
    pRD_Q20: Int32Array,
    pCB_Q15: Int16Array,
    Rates_Q5: Int16Array,
    nVectors: number,
    in_Q15: Int32Array,
    in_offset: number,
    w_Q6: Int32Array,
    rate_acc_Q5: Int32Array,
    mu_Q15: number,
    N: number,
    LPC_order: number
): void {
    SKP_Silk_NLSF_VQ_sum_error_FIX(pRD_Q20, in_Q15, in_offset, w_Q6, pCB_Q15, N, nVectors, LPC_order);

    let pRD_vec_offset = 0;
    for (let n = 0; n < N; n++) {
        for (let i = 0; i < nVectors; i++) {
            pRD_Q20[pRD_vec_offset + i] = SKP_SMLABB(
                pRD_Q20[pRD_vec_offset + i],
                (rate_acc_Q5[n] + Rates_Q5[i]) | 0,
                mu_Q15 | 0
            );
        }
        pRD_vec_offset += nVectors;
    }
}

export function SKP_Silk_insertion_sort_increasing(
    a: Int32Array,
    idx: Int32Array,
    L: number,
    K: number
): void {
    for (let i = 0; i < K; i++) {
        idx[i] = i;
    }
    for (let i = 1; i < K; i++) {
        const value = a[i];
        const id = idx[i];
        let j = i - 1;
        while (j >= 0 && value < a[j]) {
            a[j + 1] = a[j];
            idx[j + 1] = idx[j];
            j--;
        }
        a[j + 1] = value;
        idx[j + 1] = id;
    }
    for (let i = K; i < L; i++) {
        const value = a[i];
        if (value < a[K - 1]) {
            let j = K - 2;
            while (j >= 0 && value < a[j]) {
                a[j + 1] = a[j];
                idx[j + 1] = idx[j];
                j--;
            }
            a[j + 1] = value;
            idx[j + 1] = i;
        }
    }
}

export function SKP_Silk_NLSF_MSVQ_encode_FIX(
    NLSFIndices: number[],
    pNLSF_Q15: Int32Array,
    psNLSF_CB: NLSFCB,
    pNLSF_q_Q15_prev: Int32Array,
    pW_Q6: Int32Array,
    NLSF_mu_Q15: number,
    NLSF_mu_fluc_red_Q16: number,
    NLSF_MSVQ_Survivors: number,
    LPC_order: number,
    deactivate_fluc_red: number
): void {
    const min_survivors = Math.floor(NLSF_MSVQ_Survivors / 2);
    let pRateDist_Q18 = new Int32Array(256);
    let pRate_Q5 = new Int32Array(16);
    let pRate_new_Q5 = new Int32Array(16);
    let pTempIndices = new Int32Array(16);
    let pPath = new Int32Array(16 * 10);
    let pPath_new = new Int32Array(16 * 10);
    let pRes_Q15 = new Int32Array(16 * 16);
    let pRes_new_Q15 = new Int32Array(16 * 16);

    for (let i = 0; i < LPC_order; i++) {
        pRes_Q15[i] = pNLSF_Q15[i];
    }
    let prev_survivors = 1;

    for (let s = 0; s < psNLSF_CB.nStages; s++) {
        const pCurrentCBStage = psNLSF_CB.CBStages[s];
        let cur_survivors = Math.min(NLSF_MSVQ_Survivors, prev_survivors * pCurrentCBStage.nVectors);

        SKP_Silk_NLSF_VQ_rate_distortion_FIX(
            pRateDist_Q18, pCurrentCBStage.CB_NLSF_Q15, pCurrentCBStage.Rates_Q5, pCurrentCBStage.nVectors,
            pRes_Q15, 0, pW_Q6, pRate_Q5, NLSF_mu_Q15, prev_survivors, LPC_order
        );

        SKP_Silk_insertion_sort_increasing(pRateDist_Q18, pTempIndices, prev_survivors * pCurrentCBStage.nVectors, cur_survivors);

        if (pRateDist_Q18[0] < 0x7FFFFFFF / 16) {
            let limit = SKP_SMLAWB(pRateDist_Q18[0], NLSF_MSVQ_Survivors * pRateDist_Q18[0], 6554); // 0.1 * Q16
            while (pRateDist_Q18[cur_survivors - 1] > limit && cur_survivors > min_survivors) {
                cur_survivors--;
            }
        }

        for (let k = 0; k < cur_survivors; k++) {
            let input_index = 0, cb_index = 0;
            if (s > 0) {
                if (pCurrentCBStage.nVectors === 8) {
                    input_index = pTempIndices[k] >> 3;
                    cb_index = pTempIndices[k] & 7;
                } else {
                    input_index = Math.floor(pTempIndices[k] / pCurrentCBStage.nVectors);
                    cb_index = pTempIndices[k] - input_index * pCurrentCBStage.nVectors;
                }
            } else {
                cb_index = pTempIndices[k];
            }

            const pConstInt_offset = input_index * LPC_order;
            const pCB_element_offset = cb_index * LPC_order;
            const pInt_offset = k * LPC_order;

            for (let i = 0; i < LPC_order; i++) {
                pRes_new_Q15[pInt_offset + i] = pRes_Q15[pConstInt_offset + i] - pCurrentCBStage.CB_NLSF_Q15[pCB_element_offset + i];
            }

            pRate_new_Q5[k] = pRate_Q5[input_index] + pCurrentCBStage.Rates_Q5[cb_index];

            const pPath_offset = input_index * psNLSF_CB.nStages;
            const pPath_new_offset = k * psNLSF_CB.nStages;
            for (let i = 0; i < s; i++) {
                pPath_new[pPath_new_offset + i] = pPath[pPath_offset + i];
            }
            pPath_new[pPath_new_offset + s] = cb_index;
        }

        if (s < psNLSF_CB.nStages - 1) {
            pRes_Q15.set(pRes_new_Q15);
            pRate_Q5.set(pRate_new_Q5);
            pPath.set(pPath_new);
        }
        prev_survivors = cur_survivors;
    }

    let bestIndex = 0;
    if (deactivate_fluc_red !== 1) {
        let bestRateDist_Q20 = 0x7FFFFFFF;
        for (let s = 0; s < prev_survivors; s++) {
            const pPath_new_offset = s * psNLSF_CB.nStages;
            let pathSlice = [];
            for(let j=0; j<psNLSF_CB.nStages; j++) pathSlice.push(pPath_new[pPath_new_offset+j]);
            
            NLSF_MSVQ_decode(pNLSF_Q15, psNLSF_CB, pathSlice, LPC_order);

            let wsse_Q20 = 0;
            for (let i = 0; i < LPC_order; i += 2) {
                let se_Q15 = pNLSF_Q15[i] - pNLSF_q_Q15_prev[i];
                wsse_Q20 = SKP_SMLAWB(wsse_Q20, SKP_SMULBB(se_Q15, se_Q15), pW_Q6[i]);

                se_Q15 = pNLSF_Q15[i + 1] - pNLSF_q_Q15_prev[i + 1];
                wsse_Q20 = SKP_SMLAWB(wsse_Q20, SKP_SMULBB(se_Q15, se_Q15), pW_Q6[i + 1]);
            }

            wsse_Q20 = SKP_ADD_POS_SAT32(pRateDist_Q18[s], SKP_SMULWB(wsse_Q20, NLSF_mu_fluc_red_Q16));
            if (wsse_Q20 < bestRateDist_Q20) {
                bestRateDist_Q20 = wsse_Q20;
                bestIndex = s;
            }
        }
    }

    const pPath_best_offset = bestIndex * psNLSF_CB.nStages;
    for (let i = 0; i < psNLSF_CB.nStages; i++) {
        NLSFIndices[i] = pPath_new[pPath_best_offset + i];
    }
    
    NLSF_MSVQ_decode(pNLSF_Q15, psNLSF_CB, NLSFIndices, LPC_order);
}

export function SKP_Silk_process_NLSFs_FIX(
    psEnc: any, // EncoderStateFIX
    psEncCtrl: any, // EncoderControlFIX
    pNLSF_Q15: Int32Array
): void {
    let pNLSFW_Q6 = new Int32Array(psEnc.sCmn.predictLPCOrder);
    let pNLSF0_temp_Q15 = new Int32Array(psEnc.sCmn.predictLPCOrder);
    let pNLSFW0_temp_Q6 = new Int32Array(psEnc.sCmn.predictLPCOrder);

    let NLSF_mu_Q15: number, NLSF_mu_fluc_red_Q16: number;

    if (psEncCtrl.sCmn.sigtype === 0 /* SIG_TYPE_VOICED */) {
        NLSF_mu_Q15 = SKP_SMLAWB(66, -8388, psEnc.speech_activity_Q8);
        NLSF_mu_fluc_red_Q16 = SKP_SMLAWB(6554, -838848, psEnc.speech_activity_Q8);
    } else {
        NLSF_mu_Q15 = SKP_SMLAWB(164, -33554, psEnc.speech_activity_Q8);
        NLSF_mu_fluc_red_Q16 = SKP_SMLAWB(13107, -1677696, psEnc.speech_activity_Q8 + psEncCtrl.sparseness_Q8);
    }

    NLSF_mu_Q15 = Math.max(NLSF_mu_Q15, 1);

    SKP_Silk_NLSF_VQ_weights_laroia(pNLSFW_Q6, pNLSF_Q15, psEnc.sCmn.predictLPCOrder);

    let doInterpolate = (psEnc.sCmn.useInterpolatedNLSFs === 1) && (psEncCtrl.sCmn.NLSFInterpCoef_Q2 < (1 << 2));

    if (doInterpolate) {
        SKP_Silk_interpolate(pNLSF0_temp_Q15, psEnc.sPred.prev_NLSFq_Q15, pNLSF_Q15, 
            psEncCtrl.sCmn.NLSFInterpCoef_Q2, psEnc.sCmn.predictLPCOrder);

        SKP_Silk_NLSF_VQ_weights_laroia(pNLSFW0_temp_Q6, pNLSF0_temp_Q15, psEnc.sCmn.predictLPCOrder);

        let i_sqr_Q15 = SKP_SMULBB(psEncCtrl.sCmn.NLSFInterpCoef_Q2, psEncCtrl.sCmn.NLSFInterpCoef_Q2) << 11;
        for (let i = 0; i < psEnc.sCmn.predictLPCOrder; i++) {
            pNLSFW_Q6[i] = SKP_SMLAWB(pNLSFW_Q6[i] >> 1, pNLSFW0_temp_Q6[i], i_sqr_Q15);
        }
    }

    let psNLSF_CB = psEnc.sCmn.psNLSF_CB[psEncCtrl.sCmn.sigtype];

    SKP_Silk_NLSF_MSVQ_encode_FIX(
        psEncCtrl.sCmn.NLSFIndices, pNLSF_Q15, psNLSF_CB, 
        psEnc.sPred.prev_NLSFq_Q15, pNLSFW_Q6, NLSF_mu_Q15, NLSF_mu_fluc_red_Q16, 
        psEnc.sCmn.NLSF_MSVQ_Survivors, psEnc.sCmn.predictLPCOrder, psEnc.sCmn.first_frame_after_reset
    );

    NLSF2A_stable(psEncCtrl.PredCoef_Q12[1], pNLSF_Q15, psEnc.sCmn.predictLPCOrder);

    if (doInterpolate) {
        SKP_Silk_interpolate(pNLSF0_temp_Q15, psEnc.sPred.prev_NLSFq_Q15, pNLSF_Q15, 
            psEncCtrl.sCmn.NLSFInterpCoef_Q2, psEnc.sCmn.predictLPCOrder);
        NLSF2A_stable(psEncCtrl.PredCoef_Q12[0], pNLSF0_temp_Q15, psEnc.sCmn.predictLPCOrder);
    } else {
        psEncCtrl.PredCoef_Q12[0].set(psEncCtrl.PredCoef_Q12[1]);
    }
}
