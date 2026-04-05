import { EncoderState } from './structs';
import * as D from './defines';
import { 
    SKP_DIV32_16 as DIV32_16, SKP_max_32 as max_32, SKP_MUL as MUL, SKP_DIV32 as DIV32, 
    SKP_RSHIFT as RSHIFT, SKP_LSHIFT as LSHIFT, SKP_SUB32 as SUB32, SKP_SMLAWB as SMLAWB, 
    SKP_ADD32 as ADD32, SKP_SMULWB as SMULWB, SKP_SAT16 as SAT16, SKP_RSHIFT_ROUND as RSHIFT_ROUND, 
    SKP_min_int as min_int, SKP_SMLABB as SMLABB, SKP_ADD_POS_SAT32 as ADD_POS_SAT32, 
    SKP_max_int as max_int, SKP_SMULWW as SMULWW
} from './macros';
import { lin2log } from './macros'; 
import { sigm_Q15 } from './macros';
import { SQRT_APPROX } from './macros';

/**
 * Split signal into two decimated bands using first-order allpass filters
 */
const A_fb1_20 = 5394 << 1;
const A_fb1_21 = (20623 << 1) | 0; // wrap-around intentional

export function anaFiltBank1(
    inData: Int16Array,
    inOffset: number,
    S: Int32Array, // State vector [2]
    outL: Int16Array,
    outLOffset: number,
    outH: Int16Array,
    outHOffset: number,
    N: number
): void {
    const N2 = RSHIFT(N, 1);
    for (let k = 0; k < N2; k++) {
        // Convert to Q10
        let in32 = LSHIFT(inData[inOffset + 2 * k], 10);

        // All-pass section for even input sample
        let Y = SUB32(in32, S[0]);
        let X = SMLAWB(Y, Y, A_fb1_21);
        let out_1 = ADD32(S[0], X);
        S[0] = ADD32(in32, X);

        // Convert to Q10
        in32 = LSHIFT(inData[inOffset + 2 * k + 1], 10);

        // All-pass section for odd input sample
        Y = SUB32(in32, S[1]);
        X = SMULWB(Y, A_fb1_20);
        let out_2 = ADD32(S[1], X);
        S[1] = ADD32(in32, X);

        // Add/subtract, convert back to int16 and store to output
        outL[outLOffset + k] = SAT16(RSHIFT_ROUND(ADD32(out_2, out_1), 11));
        outH[outHOffset + k] = SAT16(RSHIFT_ROUND(SUB32(out_2, out_1), 11));
    }
}

/**
 * Initialization of the Silk VAD
 */
export function VAD_Init(psSilk_VAD: any): void {
    // init noise levels mapping approx pink noise
    for (let b = 0; b < D.VAD_N_BANDS; b++) {
        psSilk_VAD.NoiseLevelBias[b] = max_32(DIV32_16(D.VAD_NOISE_LEVELS_BIAS, b + 1), 1);
    }

    for (let b = 0; b < D.VAD_N_BANDS; b++) {
        psSilk_VAD.NL[b] = MUL(100, psSilk_VAD.NoiseLevelBias[b]);
        psSilk_VAD.inv_NL[b] = DIV32(0x7FFFFFFF, psSilk_VAD.NL[b]);
    }
    psSilk_VAD.counter = 15;

    for (let b = 0; b < D.VAD_N_BANDS; b++) {
        psSilk_VAD.NrgRatioSmth_Q8[b] = 100 * 256; // 20 dB SNR
    }
}

const tiltWeights = new Int32Array([30000, 6000, -12000, -12000]);

export function VAD_GetNoiseLevels(pX: Int32Array, psSilk_VAD: any): void {
    let min_coef = 0;
    if (psSilk_VAD.counter < 1000) {
        min_coef = DIV32_16(0x7FFF, RSHIFT(psSilk_VAD.counter, 4) + 1);
    }

    for (let k = 0; k < D.VAD_N_BANDS; k++) {
        let nl = psSilk_VAD.NL[k];
        let nrg = ADD_POS_SAT32(pX[k], psSilk_VAD.NoiseLevelBias[k]);
        let inv_nrg = DIV32(0x7FFFFFFF, nrg);
        
        let coef = 0;
        if (nrg > LSHIFT(nl, 3)) {
            coef = D.VAD_NOISE_LEVEL_SMOOTH_COEF_Q16 >> 3;
        } else if (nrg < nl) {
            coef = D.VAD_NOISE_LEVEL_SMOOTH_COEF_Q16;
        } else {
            coef = SMULWB(SMULWW(inv_nrg, nl), D.VAD_NOISE_LEVEL_SMOOTH_COEF_Q16 << 1);
        }
        
        coef = max_int(coef, min_coef);
        
        psSilk_VAD.inv_NL[k] = SMLAWB(psSilk_VAD.inv_NL[k], inv_nrg - psSilk_VAD.inv_NL[k], coef);
        nl = DIV32(0x7FFFFFFF, psSilk_VAD.inv_NL[k]);
        nl = min_int(nl, 0x00FFFFFF);
        psSilk_VAD.NL[k] = nl;
    }
    psSilk_VAD.counter++;
}

export function VAD_GetSA_Q8(
    psSilk_VAD: any,
    pSA_Q8: { val: number },
    pSNR_dB_Q7: { val: number },
    pQuality_Q15: Int32Array,
    pTilt_Q15: { val: number },
    pIn: Int16Array,
    framelength: number
): number {
    let X = [
        new Int16Array(D.MAX_FRAME_LENGTH / 2),
        new Int16Array(D.MAX_FRAME_LENGTH / 2),
        new Int16Array(D.MAX_FRAME_LENGTH / 2),
        new Int16Array(D.MAX_FRAME_LENGTH / 2)
    ];
    let Xnrg = new Int32Array(D.VAD_N_BANDS);
    let NrgToNoiseRatio_Q8 = new Int32Array(D.VAD_N_BANDS);
    let ret = 0;

    // Filter and Decimate
    let scratch = new Int32Array(3 * D.MAX_FRAME_LENGTH / 2);
    anaFiltBank1(pIn, 0, psSilk_VAD.AnaState, X[0], 0, X[3], 0, framelength);
    anaFiltBank1(X[0], 0, psSilk_VAD.AnaState1, X[0], 0, X[2], 0, RSHIFT(framelength, 1));
    anaFiltBank1(X[0], 0, psSilk_VAD.AnaState2, X[0], 0, X[1], 0, RSHIFT(framelength, 2));

    // HP filter on lowest band
    let dec_framelength = RSHIFT(framelength, 3);
    X[0][dec_framelength - 1] = RSHIFT(X[0][dec_framelength - 1], 1);
    let HPstateTmp = X[0][dec_framelength - 1];
    for (let i = dec_framelength - 1; i > 0; i--) {
        X[0][i - 1] = RSHIFT(X[0][i - 1], 1);
        X[0][i] -= X[0][i - 1];
    }
    X[0][0] -= psSilk_VAD.HPstate;
    psSilk_VAD.HPstate = HPstateTmp;

    // Calculate the energy in each band
    for (let b = 0; b < D.VAD_N_BANDS; b++) {
        dec_framelength = RSHIFT(framelength, min_int(D.VAD_N_BANDS - b, D.VAD_N_BANDS - 1));
        let dec_subfr = RSHIFT(dec_framelength, D.VAD_INTERNAL_SUBFRAMES_LOG2);
        let dec_offset = 0;
        
        Xnrg[b] = psSilk_VAD.XnrgSubfr[b];
        let sumSquared = 0;
        for (let s = 0; s < D.VAD_INTERNAL_SUBFRAMES; s++) {
            sumSquared = 0;
            for (let i = 0; i < dec_subfr; i++) {
                let x_tmp = RSHIFT(X[b][i + dec_offset], 3);
                sumSquared = SMLABB(sumSquared, x_tmp, x_tmp);
            }
            if (s < D.VAD_INTERNAL_SUBFRAMES - 1) {
                Xnrg[b] = ADD_POS_SAT32(Xnrg[b], sumSquared);
            } else {
                Xnrg[b] = ADD_POS_SAT32(Xnrg[b], RSHIFT(sumSquared, 1));
            }
            dec_offset += dec_subfr;
        }
        psSilk_VAD.XnrgSubfr[b] = sumSquared;
    }

    VAD_GetNoiseLevels(Xnrg, psSilk_VAD);

    let sumSquared = 0;
    let input_tilt = 0;
    for (let b = 0; b < D.VAD_N_BANDS; b++) {
        let speech_nrg = Xnrg[b] - psSilk_VAD.NL[b];
        if (speech_nrg > 0) {
            if ((Xnrg[b] & 0xFF800000) === 0) {
                NrgToNoiseRatio_Q8[b] = DIV32(LSHIFT(Xnrg[b], 8), psSilk_VAD.NL[b] + 1);
            } else {
                NrgToNoiseRatio_Q8[b] = DIV32(Xnrg[b], RSHIFT(psSilk_VAD.NL[b], 8) + 1);
            }
            let SNR_Q7 = lin2log(NrgToNoiseRatio_Q8[b]) - 8 * 128;
            sumSquared = SMLABB(sumSquared, SNR_Q7, SNR_Q7);
            
            if (speech_nrg < (1 << 20)) {
                SNR_Q7 = SMULWB(LSHIFT(SQRT_APPROX(speech_nrg), 6), SNR_Q7);
            }
            input_tilt = SMLAWB(input_tilt, tiltWeights[b], SNR_Q7);
        } else {
            NrgToNoiseRatio_Q8[b] = 256;
        }
    }

    sumSquared = DIV32_16(sumSquared, D.VAD_N_BANDS);
    pSNR_dB_Q7.val = 3 * SQRT_APPROX(sumSquared);

    let SA_Q15 = sigm_Q15(SMULWB(D.VAD_SNR_FACTOR_Q16, pSNR_dB_Q7.val) - D.VAD_NEGATIVE_OFFSET_Q5);
    pTilt_Q15.val = LSHIFT(sigm_Q15(input_tilt) - 16384, 1);

    let speech_nrg2 = 0;
    for (let b = 0; b < D.VAD_N_BANDS; b++) {
        speech_nrg2 += (b + 1) * RSHIFT(Xnrg[b] - psSilk_VAD.NL[b], 4);
    }
    
    if (speech_nrg2 <= 0) {
        SA_Q15 = RSHIFT(SA_Q15, 1);
    } else if (speech_nrg2 < 32768) {
        speech_nrg2 = SQRT_APPROX(LSHIFT(speech_nrg2, 15));
        SA_Q15 = SMULWB(32768 + speech_nrg2, SA_Q15);
    }

    pSA_Q8.val = min_int(RSHIFT(SA_Q15, 7), 255);

    let smooth_coef_Q16 = SMULWB(D.VAD_SNR_SMOOTH_COEF_Q18, SMULWB(SA_Q15, SA_Q15));
    for (let b = 0; b < D.VAD_N_BANDS; b++) {
        psSilk_VAD.NrgRatioSmth_Q8[b] = SMLAWB(psSilk_VAD.NrgRatioSmth_Q8[b], 
            NrgToNoiseRatio_Q8[b] - psSilk_VAD.NrgRatioSmth_Q8[b], smooth_coef_Q16);
        let SNR_Q7 = 3 * (lin2log(psSilk_VAD.NrgRatioSmth_Q8[b]) - 8 * 128);
        pQuality_Q15[b] = sigm_Q15(RSHIFT(SNR_Q7 - 16 * 128, 4));
    }

    return ret;
}
