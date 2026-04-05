/**
 * NLSF MSVQ decode + NLSF stabilize
 * Faithfully ported from SKP_Silk_NLSF_MSVQ_decode.c + SKP_Silk_NLSF_stabilize.c
 */
import { MAX_LPC_ORDER } from './defines';
import { SKP_RSHIFT, SKP_RSHIFT_ROUND, SKP_SMULBB, SKP_LSHIFT, toInt32 } from './macros';

/** NLSF codebook stage */
export interface NLSFCBStage {
    nVectors: number;
    CB_NLSF_Q15: Int16Array;
    Rates_Q5: Int16Array;
}

/** Full NLSF codebook */
export interface NLSFCB {
    nStages: number;
    CBStages: NLSFCBStage[];
    NDeltaMin_Q15: Int32Array;
    CDF: Uint16Array;
    CDF_start_offsets: number[];
    CDF_middle_idx: number[];
}

/** NLSF MSVQ decode: sum codebook vectors across stages */
export function NLSF_MSVQ_decode(
    pNLSF_Q15: Int32Array,
    psNLSF_CB: NLSFCB,
    NLSFIndices: number[],
    LPC_order: number
): void {
    // Stage 0: initialize with codebook vector
    const cb0 = psNLSF_CB.CBStages[0].CB_NLSF_Q15;
    const offset0 = NLSFIndices[0] * LPC_order;
    for (let i = 0; i < LPC_order; i++) {
        pNLSF_Q15[i] = cb0[offset0 + i];
    }

    // Stages 1..nStages-1: add codebook vectors
    for (let s = 1; s < psNLSF_CB.nStages; s++) {
        const cb = psNLSF_CB.CBStages[s].CB_NLSF_Q15;
        let offset: number;
        if (LPC_order === 16) {
            offset = NLSFIndices[s] << 4; // SKP_LSHIFT(idx, 4)
        } else {
            offset = NLSFIndices[s] * LPC_order;
        }
        for (let i = 0; i < LPC_order; i++) {
            pNLSF_Q15[i] = toInt32(pNLSF_Q15[i] + cb[offset + i]);
        }
    }

    // NLSF stabilization
    NLSF_stabilize(pNLSF_Q15, psNLSF_CB.NDeltaMin_Q15, LPC_order);
}

const MAX_LOOPS = 20;

/** NLSF stabilizer: ensures min distance between coefficients */
export function NLSF_stabilize(
    NLSF_Q15: Int32Array,
    NDeltaMin_Q15: Int32Array,
    L: number
): void {
    for (let loops = 0; loops < MAX_LOOPS; loops++) {
        // Find smallest distance
        let min_diff_Q15 = NLSF_Q15[0] - NDeltaMin_Q15[0];
        let I = 0;

        for (let i = 1; i <= L - 1; i++) {
            const diff = NLSF_Q15[i] - (NLSF_Q15[i - 1] + NDeltaMin_Q15[i]);
            if (diff < min_diff_Q15) { min_diff_Q15 = diff; I = i; }
        }

        const diff_last = (1 << 15) - (NLSF_Q15[L - 1] + NDeltaMin_Q15[L]);
        if (diff_last < min_diff_Q15) { min_diff_Q15 = diff_last; I = L; }

        if (min_diff_Q15 >= 0) return;

        if (I === 0) {
            NLSF_Q15[0] = NDeltaMin_Q15[0];
        } else if (I === L) {
            NLSF_Q15[L - 1] = (1 << 15) - NDeltaMin_Q15[L];
        } else {
            let min_center = 0;
            for (let k = 0; k < I; k++) min_center += NDeltaMin_Q15[k];
            min_center += NDeltaMin_Q15[I] >> 1;

            let max_center = 1 << 15;
            for (let k = L; k > I; k--) max_center -= NDeltaMin_Q15[k];
            max_center -= NDeltaMin_Q15[I] - (NDeltaMin_Q15[I] >> 1);

            let center = SKP_RSHIFT_ROUND(NLSF_Q15[I - 1] + NLSF_Q15[I], 1);
            center = Math.max(min_center, Math.min(max_center, center));
            NLSF_Q15[I - 1] = center - (NDeltaMin_Q15[I] >> 1);
            NLSF_Q15[I] = NLSF_Q15[I - 1] + NDeltaMin_Q15[I];
        }
    }

    // Fallback: insertion sort + enforce deltas
    insertionSort(NLSF_Q15, L);
    NLSF_Q15[0] = Math.max(NLSF_Q15[0], NDeltaMin_Q15[0]);
    for (let i = 1; i < L; i++) {
        NLSF_Q15[i] = Math.max(NLSF_Q15[i], NLSF_Q15[i - 1] + NDeltaMin_Q15[i]);
    }
    NLSF_Q15[L - 1] = Math.min(NLSF_Q15[L - 1], (1 << 15) - NDeltaMin_Q15[L]);
    for (let i = L - 2; i >= 0; i--) {
        NLSF_Q15[i] = Math.min(NLSF_Q15[i], NLSF_Q15[i + 1] - NDeltaMin_Q15[i + 1]);
    }
}

function insertionSort(arr: Int32Array, len: number): void {
    for (let i = 1; i < len; i++) {
        const val = arr[i];
        let j = i - 1;
        while (j >= 0 && arr[j] > val) {
            arr[j + 1] = arr[j];
            j--;
        }
        arr[j + 1] = val;
    }
}
