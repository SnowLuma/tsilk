import { 
    SKP_SMLAWB as SMLAWB, SKP_SMLABB as SMLABB, 
    SKP_SMULBB as SMULBB, SKP_SMULWB as SMULWB, SKP_SMULWT as SMULWT, 
    SKP_LSHIFT as LSHIFT, SKP_RSHIFT_ROUND as RSHIFT_ROUND, SKP_RSHIFT as RSHIFT, 
    SKP_SAT16, SKP_SUB32, SKP_FIX_CONST
} from './macros';
import { EncoderState, EncoderControl } from './structs';
import { MAX_SHAPE_LPC_ORDER, MAX_FRAME_LENGTH, NB_SUBFR, SIG_TYPE_VOICED } from './defines';

const HARM_SHAPE_FIR_TAPS = 3;
const LTP_MASK = 511;

export function SKP_Silk_warped_LPC_analysis_filter_FIX(
    state: Int32Array,
    res: Int16Array, resOffset: number,
    coef_Q13: Int16Array, coefOffset: number,
    input: Int16Array, inputOffset: number,
    lambda_Q16: number,
    length: number,
    order: number
): void {
    let n, i;
    let acc_Q11, tmp1, tmp2;

    for (n = 0; n < length; n++) {
        let in_val = input[inputOffset + n];
        tmp2 = SMLAWB(state[0], state[1], lambda_Q16);
        state[0] = LSHIFT(in_val, 14);
        
        tmp1 = SMLAWB(state[1], state[2] - tmp2, lambda_Q16);
        state[1] = tmp2;
        acc_Q11 = SMULWB(tmp2, coef_Q13[coefOffset + 0]);
        
        for (i = 2; i < order; i += 2) {
            tmp2 = SMLAWB(state[i], state[i + 1] - tmp1, lambda_Q16);
            state[i] = tmp1;
            acc_Q11 = SMLAWB(acc_Q11, tmp1, coef_Q13[coefOffset + i - 1]);
            
            tmp1 = SMLAWB(state[i + 1], state[i + 2] - tmp2, lambda_Q16);
            state[i + 1] = tmp2;
            acc_Q11 = SMLAWB(acc_Q11, tmp2, coef_Q13[coefOffset + i]);
        }
        state[order] = tmp1;
        acc_Q11 = SMLAWB(acc_Q11, tmp1, coef_Q13[coefOffset + order - 1]);
        res[resOffset + n] = SKP_SAT16(in_val - RSHIFT_ROUND(acc_Q11, 11));
    }
}

export function SKP_Silk_prefilt_FIX(
    P: any, // Prefilter state
    st_res_Q12: Int32Array,
    xw: Int16Array, xwOffset: number,
    HarmShapeFIRPacked_Q12: number,
    Tilt_Q14: number,
    LF_shp_Q14: number,
    lag: number,
    length: number
): void {
    let i, idx, LTP_shp_buf_idx;
    let n_LTP_Q12, n_Tilt_Q10, n_LF_Q10;
    let sLF_MA_shp_Q12, sLF_AR_shp_Q12;
    let LTP_shp_buf = P.sLTP_shp;

    LTP_shp_buf_idx = P.sLTP_shp_buf_idx;
    sLF_AR_shp_Q12 = P.sLF_AR_shp_Q12;
    sLF_MA_shp_Q12 = P.sLF_MA_shp_Q12;

    for(i = 0; i < length; i++) {
        if(lag > 0) {
            idx = lag + LTP_shp_buf_idx;
            n_LTP_Q12 = SMULBB(LTP_shp_buf[(idx - (HARM_SHAPE_FIR_TAPS >> 1) - 1) & LTP_MASK], HarmShapeFIRPacked_Q12);
            n_LTP_Q12 = SMLABB(n_LTP_Q12, LTP_shp_buf[(idx - (HARM_SHAPE_FIR_TAPS >> 1)) & LTP_MASK], HarmShapeFIRPacked_Q12 >> 16);
            n_LTP_Q12 = SMLABB(n_LTP_Q12, LTP_shp_buf[(idx - (HARM_SHAPE_FIR_TAPS >> 1) + 1) & LTP_MASK], HarmShapeFIRPacked_Q12);
        } else {
            n_LTP_Q12 = 0;
        }

        n_Tilt_Q10 = SMULWB(sLF_AR_shp_Q12, Tilt_Q14);
        n_LF_Q10 = SMLAWB(SMULWB(sLF_AR_shp_Q12, LF_shp_Q14 >> 16), sLF_MA_shp_Q12, LF_shp_Q14);

        sLF_AR_shp_Q12 = SKP_SUB32(st_res_Q12[i], LSHIFT(n_Tilt_Q10, 2));
        sLF_MA_shp_Q12 = SKP_SUB32(sLF_AR_shp_Q12, LSHIFT(n_LF_Q10, 2));

        LTP_shp_buf_idx = (LTP_shp_buf_idx - 1) & LTP_MASK;
        LTP_shp_buf[LTP_shp_buf_idx] = SKP_SAT16(RSHIFT_ROUND(sLF_MA_shp_Q12, 12));

        xw[xwOffset + i] = SKP_SAT16(RSHIFT_ROUND(SKP_SUB32(sLF_MA_shp_Q12, n_LTP_Q12), 12));
    }

    P.sLF_AR_shp_Q12 = sLF_AR_shp_Q12;
    P.sLF_MA_shp_Q12 = sLF_MA_shp_Q12;
    P.sLTP_shp_buf_idx = LTP_shp_buf_idx;
}

export function prefilter_FIX(
    psEnc: EncoderState,
    psEncCtrl: EncoderControl,
    xw: Int16Array,
    x: Int16Array, xOffset: number
): void {
    let P = psEnc.sPrefilt;
    let j, k, lag;
    let tmp_32;
    let pxOffset = xOffset;
    let pxwOffset = 0;
    let HarmShapeGain_Q12, Tilt_Q14;
    let HarmShapeFIRPacked_Q12, LF_shp_Q14;
    
    let subfr_len = psEnc.subfr_length;
    let x_filt_Q12 = new Int32Array(MAX_FRAME_LENGTH / NB_SUBFR);
    let st_res = new Int16Array((MAX_FRAME_LENGTH / NB_SUBFR) + MAX_SHAPE_LPC_ORDER);

    lag = P.lagPrev;
    for (k = 0; k < NB_SUBFR; k++) {
        if (psEncCtrl.sigtype == SIG_TYPE_VOICED) {
            lag = psEncCtrl.pitchL[k];
        }

        HarmShapeGain_Q12 = SMULWB(psEncCtrl.HarmShapeGain_Q14[k], 16384 - psEncCtrl.HarmBoost_Q14[k]);
        HarmShapeFIRPacked_Q12 = RSHIFT(HarmShapeGain_Q12, 2) | LSHIFT(RSHIFT(HarmShapeGain_Q12, 1), 16);
        Tilt_Q14 = psEncCtrl.Tilt_Q14[k];
        LF_shp_Q14 = psEncCtrl.LF_shp_Q14[k];
        
        SKP_Silk_warped_LPC_analysis_filter_FIX(P.sAR_shp, st_res, 0, psEncCtrl.AR1_Q13, k * MAX_SHAPE_LPC_ORDER, x, pxOffset, psEnc.warping_Q16, subfr_len, psEnc.shapingLPCOrder);

        let B_Q12_0 = RSHIFT_ROUND(psEncCtrl.GainsPre_Q14[k], 2);
        tmp_32 = SMLABB(SKP_FIX_CONST(0.05, 26), psEncCtrl.HarmBoost_Q14[k], HarmShapeGain_Q12);
        tmp_32 = SMLABB(tmp_32, psEncCtrl.coding_quality_Q14, SKP_FIX_CONST(0.1, 12));
        tmp_32 = SMULWB(tmp_32, -psEncCtrl.GainsPre_Q14[k]);
        tmp_32 = RSHIFT_ROUND(tmp_32, 12);
        let B_Q12_1 = SKP_SAT16(tmp_32);

        x_filt_Q12[0] = SMLABB(SMULBB(st_res[0], B_Q12_0), P.sHarmHP, B_Q12_1);
        for (j = 1; j < subfr_len; j++) {
            x_filt_Q12[j] = SMLABB(SMULBB(st_res[j], B_Q12_0), st_res[j - 1], B_Q12_1);
        }
        P.sHarmHP = st_res[subfr_len - 1];

        SKP_Silk_prefilt_FIX(P, x_filt_Q12, xw, pxwOffset, HarmShapeFIRPacked_Q12, Tilt_Q14, LF_shp_Q14, lag, subfr_len);

        pxOffset += subfr_len;
        pxwOffset += subfr_len;
    }

    P.lagPrev = psEncCtrl.pitchL[NB_SUBFR - 1];
}
