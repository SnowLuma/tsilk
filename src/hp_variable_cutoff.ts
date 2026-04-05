import { EncoderState, EncoderControl } from './structs';
import { SIG_TYPE_VOICED } from './defines';
import { 
    SKP_DIV32_16 as DIV32_16, 
    SKP_LSHIFT as LSHIFT, 
    SKP_MUL as MUL, 
    lin2log, 
    SKP_SUB32 as SUB32, 
    SKP_SMULWB as SMULWB, 
    SKP_ADD32 as ADD32, 
    SKP_RSHIFT as RSHIFT, 
    SKP_LIMIT_32 as LIMIT_32, 
    SKP_SMLAWB as SMLAWB, 
    SKP_Silk_log2lin as log2lin, 
    SKP_SMULBB as SMULBB, 
    SKP_SMULWW as SMULWW, 
    biquad_alt,
    SKP_FIX_CONST
} from './macros';

const SKP_RADIANS_CONSTANT_Q19 = 1482;    // 0.45f * 2.0f * 3.14159265359 / 1000
const SKP_LOG2_VARIABLE_HP_MIN_FREQ_Q7 = 809; // log(80) in Q7

const VARIABLE_HP_MAX_DELTA_FREQ_Q7 = SKP_FIX_CONST(0.4, 7);
const VARIABLE_HP_SMTH_COEF1_Q16 = SKP_FIX_CONST(0.1, 16);
const VARIABLE_HP_SMTH_COEF2_Q16 = SKP_FIX_CONST(0.015, 16);
const VARIABLE_HP_QUALITY_BIAS_Q15 = SKP_FIX_CONST(0.6, 15);
const VARIABLE_HP_R_COEF_Q9 = SKP_FIX_CONST(0.92, 9);
const ONE_Q28 = SKP_FIX_CONST(1.0, 28);
const TWO_Q22 = SKP_FIX_CONST(2.0, 22);
const VARIABLE_HP_MIN_FREQ = 80;
const VARIABLE_HP_MAX_FREQ = 150;

export function HP_variable_cutoff_FIX(
    psEnc: EncoderState,
    psEncCtrl: EncoderControl,
    outData: Int16Array,
    inData: Int16Array
): void {
    let pitch_freq_Hz_Q16 = 0;
    let pitch_freq_log_Q7 = 0;
    let delta_freq_Q7 = 0;
    let quality_Q15 = 0;

    if (psEnc.prev_sigtype === SIG_TYPE_VOICED) {
        pitch_freq_Hz_Q16 = DIV32_16(LSHIFT(MUL(psEnc.fs_kHz, 1000), 16), psEnc.prevLag);
        pitch_freq_log_Q7 = lin2log(pitch_freq_Hz_Q16) - (16 << 7);

        quality_Q15 = psEncCtrl.input_quality_bands_Q15[0] | 0;
        
        pitch_freq_log_Q7 = SUB32(pitch_freq_log_Q7, SMULWB(SMULWB(LSHIFT(quality_Q15, 2), quality_Q15), 
            pitch_freq_log_Q7 - SKP_LOG2_VARIABLE_HP_MIN_FREQ_Q7));
        
        pitch_freq_log_Q7 = ADD32(pitch_freq_log_Q7, RSHIFT(VARIABLE_HP_QUALITY_BIAS_Q15 - quality_Q15, 9));

        delta_freq_Q7 = pitch_freq_log_Q7 - RSHIFT(psEnc.variable_HP_smth1_Q15, 8);
        if (delta_freq_Q7 < 0) {
            delta_freq_Q7 = MUL(delta_freq_Q7, 3);
        }

        delta_freq_Q7 = LIMIT_32(delta_freq_Q7, -VARIABLE_HP_MAX_DELTA_FREQ_Q7, VARIABLE_HP_MAX_DELTA_FREQ_Q7);

        psEnc.variable_HP_smth1_Q15 = SMLAWB(psEnc.variable_HP_smth1_Q15, 
            MUL(LSHIFT(psEnc.speech_activity_Q8, 1), delta_freq_Q7), VARIABLE_HP_SMTH_COEF1_Q16);
    }

    psEnc.variable_HP_smth2_Q15 = SMLAWB(psEnc.variable_HP_smth2_Q15, 
        psEnc.variable_HP_smth1_Q15 - psEnc.variable_HP_smth2_Q15, VARIABLE_HP_SMTH_COEF2_Q16);

    psEncCtrl.pitch_freq_low_Hz = log2lin(RSHIFT(psEnc.variable_HP_smth2_Q15, 8));

    psEncCtrl.pitch_freq_low_Hz = LIMIT_32(psEncCtrl.pitch_freq_low_Hz, VARIABLE_HP_MIN_FREQ, VARIABLE_HP_MAX_FREQ);

    let Fc_Q19 = DIV32_16(SMULBB(SKP_RADIANS_CONSTANT_Q19, psEncCtrl.pitch_freq_low_Hz), psEnc.fs_kHz);

    let r_Q28 = ONE_Q28 - MUL(VARIABLE_HP_R_COEF_Q9, Fc_Q19);

    let B_Q28 = new Int32Array(3);
    let A_Q28 = new Int32Array(2);

    B_Q28[0] = r_Q28;
    B_Q28[1] = LSHIFT(-r_Q28, 1);
    B_Q28[2] = r_Q28;

    let r_Q22 = RSHIFT(r_Q28, 6);
    A_Q28[0] = SMULWW(r_Q22, SMULWW(Fc_Q19, Fc_Q19) - TWO_Q22);
    A_Q28[1] = SMULWW(r_Q22, r_Q22);

    if (!psEnc.sCmn) psEnc.sCmn = { In_HP_State: new Int32Array(2) };
    if (!psEnc.sCmn.In_HP_State) psEnc.sCmn.In_HP_State = new Int32Array(2);
    
    biquad_alt(inData, 0, B_Q28, A_Q28, psEnc.sCmn.In_HP_State, outData, 0, psEnc.frame_length);
}
