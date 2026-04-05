import { NB_SUBFR, LTP_ORDER } from './defines';
import { SKP_SMULBB, SKP_SMLABB_ovflw, SKP_RSHIFT_ROUND, SKP_SMULWB } from './macros';

export function SKP_Silk_LTP_analysis_filter_FIX(
    LTP_res: Int16Array,
    x: Int16Array,
    x_offset: number,
    LTPCoef_Q14: Int16Array,
    pitchL: Int32Array | number[],
    invGains_Q16: Int32Array,
    subfr_length: number,
    pre_length: number
): void {
    let x_ptr = x_offset;
    let LTP_res_ptr = 0;
    let Btmp_Q14 = new Int16Array(LTP_ORDER);
    const center = LTP_ORDER >> 1;

    for (let k = 0; k < NB_SUBFR; k++) {
        let x_lag_ptr = x_ptr - pitchL[k];
        for (let i = 0; i < LTP_ORDER; i++) {
            Btmp_Q14[i] = LTPCoef_Q14[k * LTP_ORDER + i];
        }

        for (let i = 0; i < subfr_length + pre_length; i++) {
            LTP_res[LTP_res_ptr + i] = x[x_ptr + i];
            
            let LTP_est = SKP_SMULBB(x[x_lag_ptr + center], Btmp_Q14[0]);
            for (let j = 1; j < LTP_ORDER; j++) {
                LTP_est = SKP_SMLABB_ovflw(LTP_est, x[x_lag_ptr + center - j], Btmp_Q14[j]);
            }
            LTP_est = SKP_RSHIFT_ROUND(LTP_est, 14);

            let res_val = (x[x_ptr + i] - LTP_est) | 0;
            res_val = res_val > 32767 ? 32767 : (res_val < -32768 ? -32768 : res_val);
            LTP_res[LTP_res_ptr + i] = res_val;

            LTP_res[LTP_res_ptr + i] = SKP_SMULWB(invGains_Q16[k], LTP_res[LTP_res_ptr + i]);

            x_lag_ptr++;
        }

        LTP_res_ptr += subfr_length + pre_length; 
        x_ptr += subfr_length;
    }
}
