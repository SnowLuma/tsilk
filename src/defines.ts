/**
 * SILK v3 Codec Constants and Definitions
 * Ported from SKP_Silk_define.h
 */

// Maximum frames per packet
export const MAX_FRAMES_PER_PACKET = 5;

// Limits on bitrate
export const MIN_TARGET_RATE_BPS = 5000;
export const MAX_TARGET_RATE_BPS = 100000;

// LBRR
export const MAX_LBRR_DELAY = 2;
export const NO_LBRR_THRES = 10;
export const INBAND_FEC_MIN_RATE_BPS = 18000;
export const LBRR_LOSS_THRES = 1;

export const SKP_SILK_NO_LBRR = 0;
export const SKP_SILK_ADD_LBRR_TO_PLUS1 = 1;
export const SKP_SILK_ADD_LBRR_TO_PLUS2 = 2;

// Frame termination indicator defines
export const SKP_SILK_LAST_FRAME = 0;
export const SKP_SILK_MORE_FRAMES = 1;
export const SKP_SILK_LBRR_VER1 = 2;
export const SKP_SILK_LBRR_VER2 = 3;
export const SKP_SILK_EXT_LAYER = 4;

// Signal types
export const SIG_TYPE_VOICED = 0;
export const SIG_TYPE_UNVOICED = 1;

// VAD types
export const NO_VOICE_ACTIVITY = 0;
export const VOICE_ACTIVITY = 1;

// Frame length
export const FRAME_LENGTH_MS = 20;
export const MAX_FS_KHZ = 24;
export const MAX_API_FS_KHZ = 48;
export const MAX_FRAME_LENGTH = FRAME_LENGTH_MS * MAX_FS_KHZ; // 480

// LPC
export const MAX_LPC_ORDER = 16;
export const MAX_SHAPE_LPC_ORDER = 16;
export const MIN_LPC_ORDER = 10;
export const MAX_LPC_STABILIZE_ITERATIONS = 20;

// LTP
export const LTP_ORDER = 5;
export const NB_LTP_CBKS = 3;

// Subframes
export const NB_SUBFR = 4;

// Maximum payload bytes
export const MAX_ARITHM_BYTES = 1024;

// Shell codec
export const SHELL_CODEC_FRAME_LENGTH = 16;
export const MAX_NB_SHELL_BLOCKS = Math.floor(MAX_FRAME_LENGTH / SHELL_CODEC_FRAME_LENGTH);

// Rate levels
export const N_RATE_LEVELS = 10;
export const MAX_PULSES = 18;

// Gain quantization
export const MIN_QGAIN_DB = 6;
export const MAX_QGAIN_DB = 86;
export const N_LEVELS_QGAIN = 64;
export const MAX_DELTA_GAIN_QUANT = 40;
export const MIN_DELTA_GAIN_QUANT = -4;

// Quantization offsets
export const OFFSET_VL_Q10 = 32;
export const OFFSET_VH_Q10 = 100;
export const OFFSET_UVL_Q10 = 100;
export const OFFSET_UVH_Q10 = 256;

// Decoder HP filter
export const DEC_HP_ORDER = 2;

// LTP buffer
export const LTP_BUF_LENGTH = 512;
export const LTP_MASK = LTP_BUF_LENGTH - 1;

export const DECISION_DELAY = 32;
export const NSQ_LPC_BUF_LENGTH = DECISION_DELAY; // max(MAX_LPC_ORDER, DECISION_DELAY)

// NLSF
export const NLSF_MSVQ_MAX_CB_STAGES = 10;

// BWE after loss
export const BWE_AFTER_LOSS_Q16 = 63570;

// CNG
export const CNG_BUF_MASK_MAX = 255;
export const CNG_GAIN_SMTH_Q16 = 4634;
export const CNG_NLSF_SMTH_Q16 = 16348;

// PLC
export const V_PITCH_GAIN_START_MIN_Q14 = 11469;
export const V_PITCH_GAIN_START_MAX_Q14 = 15565;
export const MAX_PITCH_LAG_MS = 18;
export const RAND_BUF_SIZE = 128;
export const RAND_BUF_MASK = RAND_BUF_SIZE - 1;
export const PITCH_DRIFT_FAC_Q16 = 655;
export const BWE_COEF_Q16 = 64880;
export const LOG2_INV_LPC_GAIN_HIGH_THRES = 3;
export const LOG2_INV_LPC_GAIN_LOW_THRES = 8;
export const USE_SINGLE_TAP = 1;

// Range coder error codes
export const RANGE_CODER_WRITE_BEYOND_BUFFER = -1;
export const RANGE_CODER_CDF_OUT_OF_RANGE = -2;
export const RANGE_CODER_NORMALIZATION_FAILED = -3;
export const RANGE_CODER_ZERO_INTERVAL_WIDTH = -4;
export const RANGE_CODER_DECODER_CHECK_FAILED = -5;
export const RANGE_CODER_READ_BEYOND_BUFFER = -6;
export const RANGE_CODER_ILLEGAL_SAMPLING_RATE = -7;
export const RANGE_CODER_DEC_PAYLOAD_TOO_LONG = -8;

// Decoder error codes
export const SKP_SILK_NO_ERROR = 0;
export const SKP_SILK_DEC_INVALID_SAMPLING_FREQUENCY = -10;
export const SKP_SILK_DEC_PAYLOAD_TOO_LARGE = -11;
export const SKP_SILK_DEC_PAYLOAD_ERROR = -12;

// SILK v3 header
export const SILK_V3_HEADER = '#!SILK_V3';
export const SILK_V3_HEADER_TENCENT = '\x02#!SILK_V3';

// Max bytes per frame constant for test program
export const MAX_BYTES_PER_FRAME = 1024;
export const MAX_INPUT_FRAMES = 5;

// Encoder Specific Constants
export const LA_SHAPE_MS = 5;
export const LA_SHAPE_MAX = LA_SHAPE_MS * 24; // 24 is MAX_FS_KHZ
export const LA_PITCH_MS = 2;
export const LA_PITCH_MAX = LA_PITCH_MS * 24;
export const SPEECH_ACTIVITY_DTX_THRES = 0.1;
export const NO_SPEECH_FRAMES_BEFORE_DTX = 5;
export const MAX_CONSECUTIVE_DTX = 20;

export const SKP_SILK_ENC_PAYLOAD_BUF_TOO_SHORT = -1;
export const SKP_SILK_ENC_INTERNAL_ERROR = -2;

// VAD Constants
export const VAD_N_BANDS = 4;
export const VAD_INTERNAL_SUBFRAMES_LOG2 = 2;
export const VAD_INTERNAL_SUBFRAMES = (1 << VAD_INTERNAL_SUBFRAMES_LOG2);
export const VAD_NOISE_LEVEL_SMOOTH_COEF_Q16 = 1024;
export const VAD_NOISE_LEVELS_BIAS = 50;
export const VAD_NEGATIVE_OFFSET_Q5 = 128;
export const VAD_SNR_FACTOR_Q16 = 45000;
export const VAD_SNR_SMOOTH_COEF_Q18 = 4096;
export const WB_DETECT_ACTIVE_SPEECH_LEVEL_THRES = 0.7;

// Pitch analysis constants
export const FIND_PITCH_LPC_WIN_MS = (20 + (LA_PITCH_MS << 1)); // 24
export const FIND_PITCH_LPC_WIN_MAX = FIND_PITCH_LPC_WIN_MS * 24; // 576
export const MAX_FIND_PITCH_LPC_ORDER = 16;
export const MAX_ORDER_LPC = 24;
export const MAX_MATRIX_SIZE = MAX_LPC_ORDER;

export const FIND_PITCH_WHITE_NOISE_FRACTION = 66; // 1e-3f in Q16
export const FIND_PITCH_BANDWITH_EXPANSION = 64881; // SKP_FIX_CONST(0.99f, 16)
export const FIND_PITCH_CORRELATION_THRESHOLD_HC_MODE = 45875; // 0.7f
export const FIND_PITCH_CORRELATION_THRESHOLD_MC_MODE = 49152; // 0.75f
export const FIND_PITCH_CORRELATION_THRESHOLD_LC_MODE = 52428; // 0.8f

export const SHAPE_LPC_WIN_MAX = 480;
