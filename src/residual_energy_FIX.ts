import { SKP_Silk_sum_sqr_shift, SKP_Silk_CLZ32, SKP_LSHIFT32, SKP_SMMUL, SKP_max_32, SKP_MUL, SKP_RSHIFT, SKP_SMULWB, SKP_SMLAWB, SKP_ADD_LSHIFT32, SKP_LSHIFT, SKP_abs, SKP_min_int, SKP_max_int } from './macros';
import { SKP_Silk_LPC_analysis_filter } from './lpc_analysis_filter';
import { NB_SUBFR, MAX_LPC_ORDER } from './defines';

export function SKP_Silk_residual_energy_FIX(
    nrgs: Int32Array,
    nrgsQ: Int32Array,
    x: Int16Array,
    x_offset: number,
    a_Q12: Int16Array[],
    gains: Int32Array,
    subfr_length: number,
    LPC_order: number
): void {
    let offset = LPC_order + subfr_length;
    let LPC_res = new Int16Array((subfr_length + LPC_order) * NB_SUBFR); // Sufficient size
    let x_ptr = x_offset;
    
    for (let i = 0; i < 2; i++) {
        let S = new Int16Array(MAX_LPC_ORDER);
        SKP_Silk_LPC_analysis_filter(
            x.subarray(x_ptr), a_Q12[i], S, LPC_res, (NB_SUBFR >> 1) * offset, LPC_order
        );

        let LPC_res_ptr = LPC_order;
        for (let j = 0; j < (NB_SUBFR >> 1); j++) {
            let res_nrg = { val: 0 };
            let res_shift = { val: 0 };
            SKP_Silk_sum_sqr_shift(res_nrg, res_shift, LPC_res.subarray(LPC_res_ptr), subfr_length);
            nrgs[i * (NB_SUBFR >> 1) + j] = res_nrg.val;
            nrgsQ[i * (NB_SUBFR >> 1) + j] = -res_shift.val;
            LPC_res_ptr += offset;
        }
        x_ptr += (NB_SUBFR >> 1) * offset;
    }

    for (let i = 0; i < NB_SUBFR; i++) {
        let lz1 = SKP_Silk_CLZ32(nrgs[i]) - 1;
        let lz2 = SKP_Silk_CLZ32(gains[i]) - 1;
        
        let tmp32 = SKP_LSHIFT32(gains[i], lz2);
        tmp32 = SKP_SMMUL(tmp32, tmp32);

        nrgs[i] = SKP_SMMUL(tmp32, SKP_LSHIFT32(nrgs[i], lz1));
        nrgsQ[i] += lz1 + 2 * lz2 - 64;
    }
}

export function SKP_Silk_residual_energy16_covar_FIX(
    c: Int16Array,
    wXX: Int32Array,
    wXx: Int32Array,
    wxx: number,
    D: number,
    cQ: number
): number {
    let lshifts = 16 - cQ;
    let Qxtra = lshifts;

    let c_max = 0;
    for (let i = 0; i < D; i++) {
        c_max = SKP_max_32(c_max, Math.abs(c[i]));
    }
    Qxtra = SKP_min_int(Qxtra, SKP_Silk_CLZ32(c_max) - 17);

    let w_max = SKP_max_32(wXX[0], wXX[D * D - 1]);
    Qxtra = SKP_min_int(Qxtra, SKP_Silk_CLZ32(SKP_MUL(D, SKP_RSHIFT(SKP_SMULWB(w_max, c_max), 4))) - 5);
    Qxtra = SKP_max_int(Qxtra, 0);

    let cn = new Int32Array(D);
    for (let i = 0; i < D; i++) {
        cn[i] = c[i] << Qxtra;
    }
    lshifts -= Qxtra;

    let tmp = 0;
    for (let i = 0; i < D; i++) {
        tmp = SKP_SMLAWB(tmp, wXx[i], cn[i]);
    }
    let nrg = SKP_RSHIFT(wxx, 1 + lshifts) - tmp;

    let tmp2 = 0;
    for (let i = 0; i < D; i++) {
        tmp = 0;
        let pRow_offset = i * D;
        for (let j = i + 1; j < D; j++) {
            tmp = SKP_SMLAWB(tmp, wXX[pRow_offset + j], cn[j]);
        }
        tmp = SKP_SMLAWB(tmp, SKP_RSHIFT(wXX[pRow_offset + i], 1), cn[i]);
        tmp2 = SKP_SMLAWB(tmp2, tmp, cn[i]);
    }
    nrg = SKP_ADD_LSHIFT32(nrg, tmp2, lshifts);

    if (nrg < 1) {
        nrg = 1;
    } else if (nrg > SKP_RSHIFT(0x7FFFFFFF, lshifts + 2)) {
        nrg = 0x7FFFFFFF >> 1;
    } else {
        nrg = SKP_LSHIFT(nrg, lshifts + 1);
    }
    return nrg;
}
