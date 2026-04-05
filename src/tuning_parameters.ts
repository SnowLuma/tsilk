// Pitch estimator
export const FIND_PITCH_WHITE_NOISE_FRACTION: number = 1e-3;
export const FIND_PITCH_BANDWITH_EXPANSION: number = 0.99;
export const FIND_PITCH_CORRELATION_THRESHOLD_HC_MODE = 0.7;
export const FIND_PITCH_CORRELATION_THRESHOLD_MC_MODE = 0.75;
export const FIND_PITCH_CORRELATION_THRESHOLD_LC_MODE = 0.8;

// Linear prediction
export const FIND_LPC_COND_FAC = 2.5e-5;
export const FIND_LPC_CHIRP = 0.99995;

// LTP analysis defines
export const FIND_LTP_COND_FAC = 1e-5;
export const LTP_DAMPING = 0.01;
export const LTP_SMOOTHING = 0.1;

// LTP quantization settings
export const MU_LTP_QUANT_NB = 0.03;
export const MU_LTP_QUANT_MB = 0.025;
export const MU_LTP_QUANT_WB = 0.02;
export const MU_LTP_QUANT_SWB = 0.016;

// High pass filtering
export const VARIABLE_HP_SMTH_COEF1 = 0.1;
export const VARIABLE_HP_SMTH_COEF2 = 0.015;
export const VARIABLE_HP_MIN_FREQ = 80.0;
export const VARIABLE_HP_MAX_FREQ = 150.0;
export const VARIABLE_HP_MAX_DELTA_FREQ = 0.4;

// Various
export const WB_DETECT_ACTIVE_SPEECH_LEVEL_THRES = 0.7;        
export const SPEECH_ACTIVITY_DTX_THRES = 0.1;
export const LBRR_SPEECH_ACTIVITY_THRES = 0.5;        

// Perceptual parameters
export const BG_SNR_DECR_dB = 4.0;
export const HARM_SNR_INCR_dB = 2.0;
export const SPARSE_SNR_INCR_dB = 2.0;
export const SPARSENESS_THRESHOLD_QNT_OFFSET = 0.75;
export const WARPING_MULTIPLIER = 0.015;
export const SHAPE_WHITE_NOISE_FRACTION = 1e-5; 
export const BANDWIDTH_EXPANSION = 0.95;
export const LOW_RATE_BANDWIDTH_EXPANSION_DELTA = 0.01;
export const DE_ESSER_COEF_SWB_dB = 2.0;
export const DE_ESSER_COEF_WB_dB = 1.0;
export const LOW_RATE_HARMONIC_BOOST = 0.1;
export const LOW_INPUT_QUALITY_HARMONIC_BOOST = 0.1;
export const HARMONIC_SHAPING = 0.3;
export const HIGH_RATE_OR_LOW_QUALITY_HARMONIC_SHAPING = 0.2;
export const HP_NOISE_COEF = 0.3;
export const HARM_HP_NOISE_COEF = 0.35;
export const INPUT_TILT = 0.05;
export const HIGH_RATE_INPUT_TILT = 0.1;
export const LOW_FREQ_SHAPING = 3.0;
export const LOW_QUALITY_LOW_FREQ_SHAPING_DECR = 0.5;
export const NOISE_FLOOR_dB = 4.0;
export const RELATIVE_MIN_GAIN_dB = -50.0;
export const GAIN_SMOOTHING_COEF = 1e-3;
export const SUBFR_SMTH_COEF = 0.4;

// R/D tradeoff parameters
export const LAMBDA_OFFSET = 1.2;
export const LAMBDA_SPEECH_ACT = -0.3;
export const LAMBDA_DELAYED_DECISIONS = -0.05;
export const LAMBDA_INPUT_QUALITY = -0.2;
export const LAMBDA_CODING_QUALITY = -0.1;
export const LAMBDA_QUANT_OFFSET = 1.5;
