/**
 * NLSF Codebook assembly: builds NLSFCB structs from raw table data
 */
import { NLSFCB, NLSFCBStage } from './nlsf';

export function buildNLSFCB(
    nStages: number,
    stageVectors: number[],
    CDF: Uint16Array,
    CDF_start_offsets: number[],
    CDF_middle_idx: number[],
    ndelta_min_Q15: Int32Array,
    Q15_data: Int16Array,
    Q5_rates: Int16Array,
    LPC_order: number
): NLSFCB {
    const CBStages: NLSFCBStage[] = [];
    let q15offset = 0;
    let q5offset = 0;
    for (let s = 0; s < nStages; s++) {
        const nVec = stageVectors[s];
        const len = nVec * LPC_order;
        CBStages.push({
            nVectors: nVec,
            CB_NLSF_Q15: Q15_data.subarray(q15offset, q15offset + len),
            Rates_Q5: Q5_rates.subarray(q5offset, q5offset + nVec),
        });
        q15offset += len;
        q5offset += nVec;
    }
    return {
        nStages,
        CBStages,
        NDeltaMin_Q15: ndelta_min_Q15,
        CDF,
        CDF_start_offsets,
        CDF_middle_idx,
    };
}
